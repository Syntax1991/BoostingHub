import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canManageUsers } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { pgPool } from "@/lib/pg-pool";
import { db, orm } from "@/lib/prisma";
import type { AccountRole, AccountStatus } from "@/models/enums";
import { userRepository } from "@/repositories/user.repository";
import { boostingRoleService } from "@/services/boosting-role.service";
import { ownerBootstrapService } from "@/services/owner-bootstrap.service";
import { runTemplateService } from "@/services/run-template.service";
import { userManagementService } from "@/services/user-management.service";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows, waitForLockWaiter } from "@/test/db-fixtures";
import { expectDomainError } from "@/test/domain-error";

/**
 * Protected Platform Owner: OWNER inherits every Admin capability, is never
 * assignable or changeable through generic role management (not even by the
 * OWNER), counts as Admin-level authority for the last-admin rule, and is
 * created only by the one-time bootstrap — at most one, enforced by the
 * database's partial unique index.
 */
type SuiteUser = "adminA" | "adminB" | "lead" | "user" | "disabledAdmin" | "owner";
const SUITE_USERS: ReadonlyArray<{ key: SuiteUser; name: string; role: AccountRole; status: AccountStatus }> = [
  { key: "adminA", name: "PO Admin A", role: "ADMIN", status: "ACTIVE" },
  { key: "adminB", name: "PO Admin B", role: "ADMIN", status: "ACTIVE" },
  { key: "lead", name: "PO Raid Lead", role: "RAID_LEAD", status: "ACTIVE" },
  { key: "user", name: "PO User", role: "USER", status: "ACTIVE" },
  { key: "disabledAdmin", name: "PO Disabled Admin", role: "ADMIN", status: "DISABLED" },
  { key: "owner", name: "PO Owner Candidate", role: "ADMIN", status: "ACTIVE" },
];
const ids = {} as Record<SuiteUser, string>;
const created = { userIds: [] as string[] };

async function setUser(id: string, accountRole: AccountRole, accountStatus: AccountStatus = "ACTIVE") {
  await orm.User.where({ id }).update({ accountRole, accountStatus, updatedAt: new Date().toISOString() });
}

async function roleOf(id: string): Promise<AccountRole> {
  const row = (await orm.User.where({ id }).first()) as { accountRole: AccountRole } | null;
  return row!.accountRole;
}

async function ownerIds(): Promise<string[]> {
  return ((await orm.User.where({ accountRole: "OWNER" }).select("id").all()) as Array<{ id: string }>).map((row) => row.id);
}

/** Bootstrap audit events written for this suite's users. */
async function bootstrapEventCount(): Promise<number> {
  let count = 0;
  for (const userId of created.userIds) {
    count += (await orm.ActivityEvent.where({ userId, type: "PLATFORM_OWNER_BOOTSTRAPPED" }).all()).length;
  }
  return count;
}

/**
 * The last-admin rule counts every ACTIVE admin-level account in the database,
 * so a test that needs to control that set parks the foreign ones (seeded
 * admins) as RAID_LEAD and afterEach restores them.
 */
let parked: Array<{ id: string; role: AccountRole }> = [];
async function parkForeignAdminLevel() {
  const rows = (await orm.User.where((user) => user.accountRole.in(["ADMIN", "OWNER"])).select("id", "accountRole").all()) as Array<{
    id: string;
    accountRole: AccountRole;
  }>;
  for (const row of rows) {
    if (created.userIds.includes(row.id)) continue;
    parked.push({ id: row.id, role: row.accountRole });
    await orm.User.where({ id: row.id }).update({ accountRole: "RAID_LEAD", updatedAt: new Date().toISOString() });
  }
}
async function restoreParked() {
  // Restore ADMINs first, the (at most one) OWNER last, after ours were reset.
  for (const entry of [...parked].sort((a, b) => (a.role === "OWNER" ? 1 : 0) - (b.role === "OWNER" ? 1 : 0))) {
    await orm.User.where({ id: entry.id }).update({ accountRole: entry.role, updatedAt: new Date().toISOString() });
  }
  parked = [];
}

async function resetOwnUsers() {
  // Demote any OWNER we created first so the single-owner index never blocks a reset.
  for (const id of created.userIds) {
    await orm.User.where({ id, accountRole: "OWNER" }).update({ accountRole: "ADMIN", updatedAt: new Date().toISOString() });
  }
  for (const { key, role, status } of SUITE_USERS) await setUser(ids[key], role, status);
  for (const userId of created.userIds) await orm.ActivityEvent.where({ userId }).deleteAll();
}

/** Make `ids.owner` the OWNER through the real bootstrap. */
async function bootstrapOwner() {
  await ownerBootstrapService.bootstrap({ userId: ids.owner });
  return testActor(ids.owner, "OWNER");
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  // A foreign OWNER (e.g. from a manual dev bootstrap) would make every bootstrap test meaningless.
  expect(await ownerIds()).toEqual([]);
  for (const { key, name, role, status } of SUITE_USERS) {
    ids[key] = await createTestUser({ name, accountRole: role, accountStatus: status });
    created.userIds.push(ids[key]);
  }
});

beforeEach(resetOwnUsers);

afterEach(async () => {
  await resetOwnUsers();
  await restoreParked();
});

afterAll(async () => {
  await restoreParked();
  await deleteCreatedRows(created);
});

const adminA = () => testActor(ids.adminA, "ADMIN");
const adminB = () => testActor(ids.adminB, "ADMIN");

describe("generic role management never touches ownership", () => {
  it("ADMIN cannot change the OWNER to any role", async () => {
    await bootstrapOwner();
    for (const nextRole of ["ADMIN", "RAID_LEAD", "USER"] as const) {
      await expectDomainError(
        userManagementService.changeAccountRole(adminA(), { targetUserId: ids.owner, nextRole }),
        "OWNER_ROLE_PROTECTED",
      );
    }
    expect(await roleOf(ids.owner)).toBe("OWNER");
  });

  it("ADMIN cannot assign OWNER to anyone (a crafted nextRole=OWNER is refused server-side)", async () => {
    for (const targetUserId of [ids.adminB, ids.lead, ids.user]) {
      await expectDomainError(
        userManagementService.changeAccountRole(adminA(), { targetUserId, nextRole: "OWNER" }),
        "OWNER_ASSIGNMENT_REQUIRES_BOOTSTRAP",
      );
    }
    expect(await ownerIds()).toEqual([]);
  });

  it("the OWNER cannot remove or hand over ownership through changeAccountRole", async () => {
    const owner = await bootstrapOwner();
    for (const nextRole of ["ADMIN", "RAID_LEAD", "USER"] as const) {
      await expectDomainError(
        userManagementService.changeAccountRole(owner, { targetUserId: ids.owner, nextRole }),
        "OWNER_ROLE_PROTECTED",
      );
    }
    await expectDomainError(
      userManagementService.changeAccountRole(owner, { targetUserId: ids.adminA, nextRole: "OWNER" }),
      "OWNER_ASSIGNMENT_REQUIRES_BOOTSTRAP",
    );
    expect(await ownerIds()).toEqual([ids.owner]);
  });

  it("the repository write refuses an OWNER target on the locked row even if a caller skipped the service checks", async () => {
    await bootstrapOwner();
    await expectDomainError(
      userRepository.changeAccountRoleAtomic({ targetUserId: ids.owner, nextRole: "USER" }),
      "OWNER_ROLE_PROTECTED",
    );
    await expectDomainError(
      userRepository.changeAccountRoleAtomic({ targetUserId: ids.user, nextRole: "OWNER" }),
      "OWNER_ASSIGNMENT_REQUIRES_BOOTSTRAP",
    );
    expect(await roleOf(ids.owner)).toBe("OWNER");
    expect(await roleOf(ids.user)).toBe("USER");
  });

  it("the OWNER manages ADMIN, RAID_LEAD and USER accounts normally", async () => {
    const owner = await bootstrapOwner();
    await userManagementService.changeAccountRole(owner, { targetUserId: ids.adminA, nextRole: "RAID_LEAD" });
    await userManagementService.changeAccountRole(owner, { targetUserId: ids.lead, nextRole: "USER" });
    await userManagementService.changeAccountRole(owner, { targetUserId: ids.user, nextRole: "ADMIN" });
    await userManagementService.changeAccountRole(owner, { targetUserId: ids.adminB, nextRole: "USER" });
    expect(await roleOf(ids.adminA)).toBe("RAID_LEAD");
    expect(await roleOf(ids.lead)).toBe("USER");
    expect(await roleOf(ids.user)).toBe("ADMIN");
    expect(await roleOf(ids.adminB)).toBe("USER");
    const audit = (await orm.ActivityEvent.where({ userId: ids.owner, type: "ACCOUNT_ROLE_CHANGED" }).all()) as unknown[];
    expect(audit).toHaveLength(4);
  });

  it("existing ADMIN transitions still work (USER→RAID_LEAD→ADMIN→USER)", async () => {
    await userManagementService.changeAccountRole(adminA(), { targetUserId: ids.user, nextRole: "RAID_LEAD" });
    await userManagementService.changeAccountRole(adminA(), { targetUserId: ids.user, nextRole: "ADMIN" });
    await userManagementService.changeAccountRole(adminA(), { targetUserId: ids.user, nextRole: "USER" });
    expect(await roleOf(ids.user)).toBe("USER");
    await expectDomainError(
      userManagementService.changeAccountRole(adminA(), { targetUserId: ids.user, nextRole: "USER" }),
      "ROLE_ALREADY_ASSIGNED",
    );
  });
});

describe("last Admin-level account", () => {
  it("without an OWNER the last active ADMIN stays protected (a DISABLED admin does not count)", async () => {
    await parkForeignAdminLevel();
    await setUser(ids.adminB, "RAID_LEAD");
    await setUser(ids.owner, "RAID_LEAD");
    // adminA is now the only ACTIVE admin-level account; disabledAdmin is ADMIN but DISABLED.
    await expectDomainError(
      userManagementService.changeAccountRole(adminA(), { targetUserId: ids.adminA, nextRole: "USER" }),
      "LAST_ADMIN_REQUIRED",
    );
    expect(await roleOf(ids.adminA)).toBe("ADMIN");
  });

  it("an active OWNER counts as Admin-level: the last literal ADMIN may be demoted", async () => {
    await parkForeignAdminLevel();
    const owner = await bootstrapOwner();
    await setUser(ids.adminB, "RAID_LEAD");
    await userManagementService.changeAccountRole(owner, { targetUserId: ids.adminA, nextRole: "USER" });
    expect(await roleOf(ids.adminA)).toBe("USER");
    expect(await ownerIds()).toEqual([ids.owner]);
  });

  it("two admins demoting each other at the same time can never leave zero Admin-level accounts", async () => {
    await parkForeignAdminLevel();
    await setUser(ids.owner, "RAID_LEAD");
    // Exactly two ACTIVE admin-level accounts remain: adminA and adminB.
    const results = await Promise.allSettled([
      userManagementService.changeAccountRole(adminA(), { targetUserId: ids.adminB, nextRole: "USER" }),
      userManagementService.changeAccountRole(adminB(), { targetUserId: ids.adminA, nextRole: "USER" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(isDomainError(rejected.reason) && rejected.reason.code).toBe("LAST_ADMIN_REQUIRED");
    const roles = [await roleOf(ids.adminA), await roleOf(ids.adminB)];
    expect(roles.filter((role) => role === "ADMIN")).toHaveLength(1);
  });

  it("deterministic: a demotion queued behind an uncommitted demotion re-counts after it and is refused", async () => {
    await parkForeignAdminLevel();
    await setUser(ids.owner, "RAID_LEAD");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockHeld = new Promise<void>((resolve) => (locked = resolve));
    // Holds only adminB's row: the second demotion (of adminA) can queue behind it only by
    // locking every admin-level row before it counts them.
    const first = db.transaction(async (tx) => {
      await tx.orm.public.User.where({ id: ids.adminB }).update({ accountRole: "USER", updatedAt: new Date().toISOString() });
      locked();
      await gate;
    });
    await lockHeld;
    const second = userManagementService.changeAccountRole(adminB(), { targetUserId: ids.adminA, nextRole: "USER" });
    await waitForLockWaiter();
    release();
    await first;
    await expectDomainError(second, "LAST_ADMIN_REQUIRED");
    expect(await roleOf(ids.adminA)).toBe("ADMIN");
  });
});

describe("owner bootstrap", () => {
  it("a valid ACTIVE ADMIN becomes OWNER, with a durable audit event", async () => {
    const result = await ownerBootstrapService.bootstrap({ userId: ids.owner });
    expect(result).toEqual({ userId: ids.owner, name: "PO Owner Candidate", previousRole: "ADMIN", nextRole: "OWNER" });
    expect(await ownerIds()).toEqual([ids.owner]);
    const events = (await orm.ActivityEvent.where({ userId: ids.owner, type: "PLATFORM_OWNER_BOOTSTRAPPED" }).all()) as Array<{
      message: string;
    }>;
    expect(events).toHaveLength(1);
    expect(events[0]!.message).toContain(`targetUserId=${ids.owner}`);
    expect(events[0]!.message).toContain("previousRole=ADMIN");
    expect(events[0]!.message).toContain("newRole=OWNER");
    expect(events[0]!.message).toContain("PO Owner Candidate");
  });

  it("existing sessions gain OWNER authority through the normal fresh database reload", async () => {
    await bootstrapOwner();
    const fresh = await userRepository.findAuthenticatedById(ids.owner);
    expect(fresh?.accountRole).toBe("OWNER");
    expect(canManageUsers(fresh!.accountRole)).toBe(true);
  });

  it("rejects a malformed id, a nonexistent user, an inactive user and non-ADMIN targets", async () => {
    await expectDomainError(ownerBootstrapService.bootstrap({ userId: "not-a-uuid" }), "OWNER_BOOTSTRAP_TARGET_INVALID");
    await expectDomainError(ownerBootstrapService.bootstrap({ userId: crypto.randomUUID() }), "USER_NOT_FOUND");
    await expectDomainError(ownerBootstrapService.bootstrap({ userId: ids.disabledAdmin }), "OWNER_BOOTSTRAP_TARGET_INVALID");
    await expectDomainError(ownerBootstrapService.bootstrap({ userId: ids.lead }), "OWNER_BOOTSTRAP_TARGET_INVALID");
    await expectDomainError(ownerBootstrapService.bootstrap({ userId: ids.user }), "OWNER_BOOTSTRAP_TARGET_INVALID");
    expect(await ownerIds()).toEqual([]);
    expect(await bootstrapEventCount()).toBe(0);
  });

  it("a second bootstrap fails safely — for another admin and for the same user", async () => {
    await bootstrapOwner();
    await expectDomainError(ownerBootstrapService.bootstrap({ userId: ids.adminA }), "OWNER_ALREADY_EXISTS");
    await expectDomainError(ownerBootstrapService.bootstrap({ userId: ids.owner }), "OWNER_ALREADY_EXISTS");
    expect(await ownerIds()).toEqual([ids.owner]);
    expect(await roleOf(ids.adminA)).toBe("ADMIN");
    expect(await bootstrapEventCount()).toBe(1);
  });

  it("concurrent bootstraps for two admins produce exactly one OWNER", async () => {
    const results = await Promise.allSettled([
      ownerBootstrapService.bootstrap({ userId: ids.adminA }),
      ownerBootstrapService.bootstrap({ userId: ids.adminB }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(isDomainError(rejected.reason) && rejected.reason.code).toBe("OWNER_ALREADY_EXISTS");
    expect(await ownerIds()).toHaveLength(1);
  });

  it("deterministic race: a bootstrap that passed the 'no owner yet' read is stopped by the single-owner index", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let written!: () => void;
    const ownerWritten = new Promise<void>((resolve) => (written = resolve));
    // An uncommitted OWNER write: invisible to the second bootstrap's read, but it holds the index entry.
    const first = db.transaction(async (tx) => {
      const txOrm = tx.orm.public;
      await txOrm.User.where({ id: ids.adminA }).update({ accountRole: "OWNER", updatedAt: new Date().toISOString() });
      written();
      await gate;
    });
    await ownerWritten;
    const second = ownerBootstrapService.bootstrap({ userId: ids.adminB });
    await waitForLockWaiter();
    release();
    await first;
    await expectDomainError(second, "OWNER_ALREADY_EXISTS");
    expect(await ownerIds()).toEqual([ids.adminA]);
    expect(await roleOf(ids.adminB)).toBe("ADMIN");
  });

  it("the database itself refuses a second OWNER row", async () => {
    await bootstrapOwner();
    await expect(pgPool.query(`UPDATE "user" SET "accountRole" = 'OWNER' WHERE id = $1`, [ids.adminA])).rejects.toMatchObject({
      code: "23505",
      constraint: expect.stringMatching(/^user_single_owner/),
    });
    expect(await ownerIds()).toEqual([ids.owner]);
  });
});

describe("OWNER keeps every Admin feature", () => {
  it("user directory, Boosting Roles, Templates and Raid Lead eligibility", async () => {
    const owner = await bootstrapOwner();
    const users = await userManagementService.listUsers(owner, { role: "OWNER" });
    expect(users.map((row) => row.id)).toEqual([ids.owner]);
    await expect(userManagementService.getUserDetail(owner, ids.adminA)).resolves.toMatchObject({ user: { id: ids.adminA } });
    // OWNER manages Boosting Roles like ADMIN; granting an already-held role is a no-op.
    await boostingRoleService.setRole(owner, { userId: ids.adminA, role: "LOOTBUDDY", enabled: true });
    await expect(
      boostingRoleService.setRole(owner, { userId: ids.adminA, role: "LOOTBUDDY", enabled: false }),
    ).resolves.toMatchObject({ changed: true, roles: { isLootbuddy: false } });
    await expect(runTemplateService.listAll(owner)).resolves.toEqual(expect.any(Array));
    const leads = await userRepository.listEligibleRaidLeads();
    expect(leads.find((lead) => lead.id === ids.owner)).toMatchObject({ accountRole: "OWNER" });
    expect(leads.some((lead) => lead.id === ids.disabledAdmin)).toBe(false);
  });

  it("nobody below Admin can reach role management", async () => {
    for (const caller of [testActor(ids.lead, "RAID_LEAD"), testActor(ids.user, "USER")]) {
      await expectDomainError(
        userManagementService.changeAccountRole(caller, { targetUserId: ids.adminB, nextRole: "USER" }),
        "USER_MANAGEMENT_FORBIDDEN",
      );
    }
    expect(await roleOf(ids.adminB)).toBe("ADMIN");
  });
});
