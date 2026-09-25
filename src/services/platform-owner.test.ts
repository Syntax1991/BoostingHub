import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canManageUsers, type AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { db, orm } from "@/lib/prisma";
import type { AccountRole, AccountStatus } from "@/models/enums";
import { userRepository } from "@/repositories/user.repository";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import { ownerBootstrapService } from "@/services/owner-bootstrap.service";
import { runTemplateService } from "@/services/run-template.service";
import { userManagementService } from "@/services/user-management.service";

/**
 * Protected Platform Owner: OWNER inherits every Admin capability, is never
 * assignable or changeable through generic role management (not even by the
 * OWNER), counts as Admin-level authority for the last-admin rule, and is
 * created only by the one-time bootstrap — at most one, enforced by the
 * database's partial unique index.
 *
 * Ids are valid hex UUIDs because the bootstrap validates the exact User id.
 */
const ids = {
  adminA: "b0000000-0000-4000-8000-00000000a001",
  adminB: "b0000000-0000-4000-8000-00000000a002",
  lead: "b0000000-0000-4000-8000-00000000a003",
  user: "b0000000-0000-4000-8000-00000000a004",
  disabledAdmin: "b0000000-0000-4000-8000-00000000a005",
  owner: "b0000000-0000-4000-8000-00000000a006",
  missing: "b0000000-0000-4000-8000-00000000afff",
};
const ownIds = Object.values(ids).filter((id) => id !== ids.missing);

function asUser(id: string, accountRole: AccountRole): AuthenticatedUser {
  return {
    id,
    name: `PO ${id.slice(-4)}`,
    email: null,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function expectDomainCode(promise: Promise<unknown>, code: string) {
  let caught: unknown = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(isDomainError(caught) ? caught.code : caught).toBe(code);
}

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

/** Every ACTIVE admin-level account outside this file, parked as RAID_LEAD so a test controls the whole set. */
let parked: Array<{ id: string; role: AccountRole }> = [];
async function parkForeignAdminLevel() {
  const rows = (await orm.User.where((user) => user.accountRole.in(["ADMIN", "OWNER"])).select("id", "accountRole").all()) as Array<{
    id: string;
    accountRole: AccountRole;
  }>;
  for (const row of rows) {
    if (ownIds.includes(row.id)) continue;
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
  for (const id of ownIds) {
    await orm.User.where({ id, accountRole: "OWNER" }).update({ accountRole: "ADMIN", updatedAt: new Date().toISOString() });
  }
  await setUser(ids.adminA, "ADMIN");
  await setUser(ids.adminB, "ADMIN");
  await setUser(ids.lead, "RAID_LEAD");
  await setUser(ids.user, "USER");
  await setUser(ids.disabledAdmin, "ADMIN", "DISABLED");
  await setUser(ids.owner, "ADMIN");
  for (const id of ownIds) {
    await orm.ActivityEvent.where({ userId: id }).deleteAll();
  }
}

/** Make `ids.owner` the OWNER through the real bootstrap. */
async function bootstrapOwner() {
  await ownerBootstrapService.bootstrap({ userId: ids.owner });
  return asUser(ids.owner, "OWNER");
}

async function cleanup() {
  for (const id of ownIds) {
    await orm.ActivityEvent.where({ userId: id }).deleteAll();
    await orm.User.where({ id }).deleteAll();
  }
}

beforeAll(async () => {
  await cleanup();
  // A foreign OWNER (e.g. from a manual dev bootstrap) would make every bootstrap test meaningless.
  expect(await ownerIds()).toEqual([]);
  const now = new Date().toISOString();
  for (const [id, role, status] of [
    [ids.adminA, "ADMIN", "ACTIVE"],
    [ids.adminB, "ADMIN", "ACTIVE"],
    [ids.lead, "RAID_LEAD", "ACTIVE"],
    [ids.user, "USER", "ACTIVE"],
    [ids.disabledAdmin, "ADMIN", "DISABLED"],
    [ids.owner, "ADMIN", "ACTIVE"],
  ] as const) {
    await orm.User.create({
      id,
      name: `PO ${id.slice(-4)}`,
      email: `${id}@po.boostting.local`,
      emailVerified: true,
      accountRole: role,
      accountStatus: status,
      createdAt: now,
      updatedAt: now,
    });
  }
});

beforeEach(resetOwnUsers);

afterEach(async () => {
  await resetOwnUsers();
  await restoreParked();
});

afterAll(async () => {
  await restoreParked();
  await cleanup();
});

const adminA = asUser(ids.adminA, "ADMIN");
const adminB = asUser(ids.adminB, "ADMIN");

describe("generic role management never touches ownership", () => {
  it("ADMIN cannot change the OWNER to any role", async () => {
    await bootstrapOwner();
    for (const nextRole of ["ADMIN", "RAID_LEAD", "USER"] as const) {
      await expectDomainCode(
        userManagementService.changeAccountRole(adminA, { targetUserId: ids.owner, nextRole }),
        "OWNER_ROLE_PROTECTED",
      );
    }
    expect(await roleOf(ids.owner)).toBe("OWNER");
  });

  it("ADMIN cannot assign OWNER to anyone (a crafted nextRole=OWNER is refused server-side)", async () => {
    for (const targetUserId of [ids.adminB, ids.lead, ids.user]) {
      await expectDomainCode(
        userManagementService.changeAccountRole(adminA, { targetUserId, nextRole: "OWNER" }),
        "OWNER_ASSIGNMENT_REQUIRES_BOOTSTRAP",
      );
    }
    expect(await ownerIds()).toEqual([]);
  });

  it("the OWNER cannot remove or hand over ownership through changeAccountRole", async () => {
    const owner = await bootstrapOwner();
    for (const nextRole of ["ADMIN", "RAID_LEAD", "USER"] as const) {
      await expectDomainCode(
        userManagementService.changeAccountRole(owner, { targetUserId: ids.owner, nextRole }),
        "OWNER_ROLE_PROTECTED",
      );
    }
    await expectDomainCode(
      userManagementService.changeAccountRole(owner, { targetUserId: ids.adminA, nextRole: "OWNER" }),
      "OWNER_ASSIGNMENT_REQUIRES_BOOTSTRAP",
    );
    expect(await ownerIds()).toEqual([ids.owner]);
  });

  it("the repository write refuses an OWNER target on the locked row even if a caller skipped the service checks", async () => {
    await bootstrapOwner();
    await expectDomainCode(
      userRepository.changeAccountRoleAtomic({ targetUserId: ids.owner, nextRole: "USER" }),
      "OWNER_ROLE_PROTECTED",
    );
    await expectDomainCode(
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
    await userManagementService.changeAccountRole(adminA, { targetUserId: ids.user, nextRole: "RAID_LEAD" });
    await userManagementService.changeAccountRole(adminA, { targetUserId: ids.user, nextRole: "ADMIN" });
    await userManagementService.changeAccountRole(adminA, { targetUserId: ids.user, nextRole: "USER" });
    expect(await roleOf(ids.user)).toBe("USER");
    await expectDomainCode(
      userManagementService.changeAccountRole(adminA, { targetUserId: ids.user, nextRole: "USER" }),
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
    await expectDomainCode(
      userManagementService.changeAccountRole(adminA, { targetUserId: ids.adminA, nextRole: "USER" }),
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
      userManagementService.changeAccountRole(adminA, { targetUserId: ids.adminB, nextRole: "USER" }),
      userManagementService.changeAccountRole(adminB, { targetUserId: ids.adminA, nextRole: "USER" }),
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
    const first = db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: typeof orm }).public ?? (tx.orm as unknown as typeof orm)) as typeof orm;
      const now = new Date().toISOString();
      await txOrm.User.where((user) => user.accountRole.in(["ADMIN", "OWNER"])).update({ updatedAt: now });
      await txOrm.User.where({ id: ids.adminB }).update({ accountRole: "USER", updatedAt: now });
      locked();
      await gate;
    });
    await lockHeld;
    const second = userManagementService.changeAccountRole(adminB, { targetUserId: ids.adminA, nextRole: "USER" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await first;
    await expectDomainCode(second, "LAST_ADMIN_REQUIRED");
    expect(await roleOf(ids.adminA)).toBe("ADMIN");
  });
});

describe("owner bootstrap", () => {
  it("a valid ACTIVE ADMIN becomes OWNER, with a durable audit event", async () => {
    const result = await ownerBootstrapService.bootstrap({ userId: ids.owner });
    expect(result).toEqual({ userId: ids.owner, name: "PO a006", previousRole: "ADMIN", nextRole: "OWNER" });
    expect(await ownerIds()).toEqual([ids.owner]);
    const events = (await orm.ActivityEvent.where({ userId: ids.owner, type: "PLATFORM_OWNER_BOOTSTRAPPED" }).all()) as Array<{
      message: string;
    }>;
    expect(events).toHaveLength(1);
    expect(events[0]!.message).toContain(`targetUserId=${ids.owner}`);
    expect(events[0]!.message).toContain("previousRole=ADMIN");
    expect(events[0]!.message).toContain("newRole=OWNER");
    expect(events[0]!.message).toContain("PO a006");
  });

  it("existing sessions gain OWNER authority through the normal fresh database reload", async () => {
    await bootstrapOwner();
    const fresh = await userRepository.findAuthenticatedById(ids.owner);
    expect(fresh?.accountRole).toBe("OWNER");
    expect(canManageUsers(fresh!.accountRole)).toBe(true);
  });

  it("rejects a malformed id, a nonexistent user, an inactive user and non-ADMIN targets", async () => {
    await expectDomainCode(ownerBootstrapService.bootstrap({ userId: "not-a-uuid" }), "OWNER_BOOTSTRAP_TARGET_INVALID");
    await expectDomainCode(ownerBootstrapService.bootstrap({ userId: ids.missing }), "USER_NOT_FOUND");
    await expectDomainCode(ownerBootstrapService.bootstrap({ userId: ids.disabledAdmin }), "OWNER_BOOTSTRAP_TARGET_INVALID");
    await expectDomainCode(ownerBootstrapService.bootstrap({ userId: ids.lead }), "OWNER_BOOTSTRAP_TARGET_INVALID");
    await expectDomainCode(ownerBootstrapService.bootstrap({ userId: ids.user }), "OWNER_BOOTSTRAP_TARGET_INVALID");
    expect(await ownerIds()).toEqual([]);
    expect(await orm.ActivityEvent.where({ type: "PLATFORM_OWNER_BOOTSTRAPPED" }).all()).toHaveLength(0);
  });

  it("a second bootstrap fails safely — for another admin and for the same user", async () => {
    await bootstrapOwner();
    await expectDomainCode(ownerBootstrapService.bootstrap({ userId: ids.adminA }), "OWNER_ALREADY_EXISTS");
    await expectDomainCode(ownerBootstrapService.bootstrap({ userId: ids.owner }), "OWNER_ALREADY_EXISTS");
    expect(await ownerIds()).toEqual([ids.owner]);
    expect(await roleOf(ids.adminA)).toBe("ADMIN");
    expect(await orm.ActivityEvent.where({ type: "PLATFORM_OWNER_BOOTSTRAPPED" }).all()).toHaveLength(1);
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
      const txOrm = ((tx.orm as { public?: typeof orm }).public ?? (tx.orm as unknown as typeof orm)) as typeof orm;
      await txOrm.User.where({ id: ids.adminA }).update({ accountRole: "OWNER", updatedAt: new Date().toISOString() });
      written();
      await gate;
    });
    await ownerWritten;
    const second = ownerBootstrapService.bootstrap({ userId: ids.adminB });
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await first;
    await expectDomainCode(second, "OWNER_ALREADY_EXISTS");
    expect(await ownerIds()).toEqual([ids.adminA]);
    expect(await roleOf(ids.adminB)).toBe("ADMIN");
  });

  it("the database itself refuses a second OWNER row", async () => {
    await bootstrapOwner();
    let caught: unknown = null;
    try {
      await orm.User.where({ id: ids.adminA }).update({ accountRole: "OWNER", updatedAt: new Date().toISOString() });
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    expect(await ownerIds()).toEqual([ids.owner]);
  });
});

describe("OWNER keeps every Admin feature", () => {
  it("user directory, Booster Access, Templates and Raid Lead eligibility", async () => {
    const owner = await bootstrapOwner();
    const users = await userManagementService.listUsers(owner, { role: "OWNER" });
    expect(users.map((row) => row.id)).toEqual([ids.owner]);
    await expect(userManagementService.getUserDetail(owner, ids.adminA)).resolves.toMatchObject({ user: { id: ids.adminA } });
    await expect(boosterQualificationService.listAdminQualifications(owner)).resolves.toBeInstanceOf(Array);
    await expect(runTemplateService.listAll(owner)).resolves.toBeDefined();
    const leads = await userRepository.listEligibleRaidLeads();
    expect(leads.find((lead) => lead.id === ids.owner)).toMatchObject({ accountRole: "OWNER" });
    expect(leads.some((lead) => lead.id === ids.disabledAdmin)).toBe(false);
  });

  it("a RAID_LEAD still cannot manage users, and nobody below Admin can reach role management", async () => {
    await expectDomainCode(
      userManagementService.changeAccountRole(asUser(ids.lead, "RAID_LEAD"), { targetUserId: ids.user, nextRole: "RAID_LEAD" }),
      "USER_MANAGEMENT_FORBIDDEN",
    );
  });
});
