import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { anyContentRunInput } from "@tests/fixtures/test-run-input";
import type { AccountRole, RunStatus } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { userRepository } from "@/repositories/user.repository";
import { runService } from "@/services/run.service";
import { userManagementService } from "@/services/user-management.service";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows } from "@tests/fixtures/db-fixtures";
import { expectDomainError } from "@tests/helpers/domain-error";
import { CURRENT_WEEK_RUN_START, HOUR_MS, RAID_WEEK_TEST_CLOCK, freezeSystemTime, restoreSystemTime } from "@tests/fixtures/time";

const created = { runIds: [] as string[], userIds: [] as string[] };
let user: AuthenticatedUser;
let admin: AuthenticatedUser;
/** Fresh per test, since tests change their roles: a USER and a RAID_LEAD. */
let targetId = "";
let lead: AuthenticatedUser;

async function setRole(userId: string, accountRole: AccountRole) {
  await orm.User.where({ id: userId }).update({ accountRole, updatedAt: new Date().toISOString() });
}

/** A Run led by the per-test Raid Lead, moved straight to `status`. */
async function leadRun(status: RunStatus) {
  const scheduledStartAt = new Date(Date.parse(CURRENT_WEEK_RUN_START) + created.runIds.length * 3 * HOUR_MS).toISOString();
  const run = await runService.createRun(lead, anyContentRunInput({ scheduledStartAt }));
  created.runIds.push(run.id);
  await orm.Run.where({ id: run.id }).update({ status, signupsOpen: status === "OPEN" });
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  freezeSystemTime(RAID_WEEK_TEST_CLOCK, { advance: true });
  await raidRepository.ensureReferenceRaids();
  const userId = await createTestUser({ name: "UM User" });
  const adminId = await createTestUser({ name: "UM Admin", accountRole: "ADMIN" });
  // A second admin, so demoting an admin is not blocked by the last-admin rule.
  const adminTwoId = await createTestUser({ name: "UM Admin Two", accountRole: "ADMIN" });
  created.userIds.push(userId, adminId, adminTwoId);
  user = testActor(userId);
  admin = testActor(adminId, "ADMIN");
});

beforeEach(async () => {
  targetId = await createTestUser({ name: "UM Target" });
  const leadId = await createTestUser({ name: "UM Lead", accountRole: "RAID_LEAD" });
  created.userIds.push(targetId, leadId);
  lead = testActor(leadId, "RAID_LEAD");
});

afterAll(async () => {
  try {
    await deleteCreatedRows(created);
  } finally {
    restoreSystemTime();
  }
});

describe("userManagementService authorization", () => {
  it("blocks USER and RAID_LEAD from list, detail, and role changes", async () => {
    for (const actor of [user, lead]) {
      await expectDomainError(userManagementService.listUsers(actor), "USER_MANAGEMENT_FORBIDDEN");
      await expectDomainError(userManagementService.getUserDetail(actor, targetId), "USER_MANAGEMENT_FORBIDDEN");
      await expectDomainError(
        userManagementService.changeAccountRole(actor, { targetUserId: targetId, nextRole: "RAID_LEAD" }),
        "USER_MANAGEMENT_FORBIDDEN",
      );
    }
    expect((await userRepository.findAuthenticatedById(targetId))?.accountRole).toBe("USER");
  });

  it("lets ADMIN list users and load detail", async () => {
    const listed = await userManagementService.listUsers(admin, { query: "UM Target" });
    expect(listed.some((row) => row.id === targetId)).toBe(true);
    const detail = await userManagementService.getUserDetail(admin, targetId);
    expect(detail.user).toMatchObject({ id: targetId, accountRole: "USER" });
  });
});

describe("userManagementService role transitions", () => {
  it("supports USER→RAID_LEAD, RAID_LEAD→ADMIN, and ADMIN→USER when another admin remains", async () => {
    const change = (nextRole: AccountRole) => userManagementService.changeAccountRole(admin, { targetUserId: targetId, nextRole });
    expect(await change("RAID_LEAD")).toMatchObject({ previousRole: "USER", nextRole: "RAID_LEAD" });
    expect(await change("ADMIN")).toMatchObject({ previousRole: "RAID_LEAD", nextRole: "ADMIN" });
    expect(await change("USER")).toMatchObject({ previousRole: "ADMIN", nextRole: "USER" });
  });

  it("rejects assigning the same role", async () => {
    await expectDomainError(
      userManagementService.changeAccountRole(admin, { targetUserId: targetId, nextRole: "USER" }),
      "ROLE_ALREADY_ASSIGNED",
    );
  });

  it("rejects invalid account roles", async () => {
    for (const nextRole of ["BOOSTER", "not-a-role"]) {
      await expectDomainError(
        userManagementService.changeAccountRole(admin, { targetUserId: targetId, nextRole }),
        "INVALID_ACCOUNT_ROLE",
      );
    }
  });

  it("blocks demoting the last remaining admin", async () => {
    // The rule counts admins community-wide, so every other admin in the test database is
    // demoted for the duration of this test and restored afterwards.
    const otherAdminIds = ((await orm.User.where({ accountRole: "ADMIN" }).select("id").all()) as Array<{ id: string }>)
      .map((row) => row.id)
      .filter((id) => id !== admin.id);
    try {
      for (const id of otherAdminIds) await setRole(id, "RAID_LEAD");
      await expectDomainError(
        userManagementService.changeAccountRole(admin, { targetUserId: admin.id, nextRole: "USER" }),
        "LAST_ADMIN_REQUIRED",
      );
    } finally {
      for (const id of otherAdminIds) await setRole(id, "ADMIN");
    }
    expect((await userRepository.findAuthenticatedById(admin.id))?.accountRole).toBe("ADMIN");
  });
});

describe("userManagementService active run safety", () => {
  it("blocks demotion to USER while a non-terminal run is assigned", async () => {
    await leadRun("OPEN");
    await expectDomainError(
      userManagementService.changeAccountRole(admin, { targetUserId: lead.id, nextRole: "USER" }),
      "ROLE_CHANGE_BLOCKED_BY_ACTIVE_RUNS",
    );
  });

  it("allows demotion when only COMPLETED or CANCELLED runs remain", async () => {
    await leadRun("COMPLETED");
    await leadRun("CANCELLED");
    const result = await userManagementService.changeAccountRole(admin, { targetUserId: lead.id, nextRole: "USER" });
    expect(result.nextRole).toBe("USER");
  });
});

describe("userManagementService audit and session freshness", () => {
  it("writes ACCOUNT_ROLE_CHANGED with actor id and targetUserId marker", async () => {
    await userManagementService.changeAccountRole(admin, { targetUserId: targetId, nextRole: "RAID_LEAD" });
    const events = (await orm.ActivityEvent.where({ userId: admin.id, type: "ACCOUNT_ROLE_CHANGED" }).all()) as Array<{
      message: string;
    }>;
    expect(events.filter((row) => row.message.includes(`targetUserId=${targetId}`))).toHaveLength(1);
  });

  it("reloads the new role from the database via findAuthenticatedById", async () => {
    await userManagementService.changeAccountRole(admin, { targetUserId: targetId, nextRole: "RAID_LEAD" });
    expect((await userRepository.findAuthenticatedById(targetId))?.accountRole).toBe("RAID_LEAD");
  });
});
