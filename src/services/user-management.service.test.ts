import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import type { AccountRole, RunStatus } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { userRepository } from "@/repositories/user.repository";
import { userManagementService } from "@/services/user-management.service";

const raidId = WOW_RAID_CATALOG[0].id;

const ids = {
  user: "aaaaaaaa-aaaa-4aaa-8aaa-um0000000001",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-um0000000002",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-um0000000003",
  adminTwo: "aaaaaaaa-aaaa-4aaa-8aaa-um0000000004",
  target: "aaaaaaaa-aaaa-4aaa-8aaa-um0000000005",
  runActive: "aaaaaaaa-aaaa-4aaa-8aaa-umr000000001",
  runCompleted: "aaaaaaaa-aaaa-4aaa-8aaa-umr000000002",
  runCancelled: "aaaaaaaa-aaaa-4aaa-8aaa-umr000000003",
};

const createdUserIds = [ids.user, ids.lead, ids.admin, ids.adminTwo, ids.target];
const createdRunIds = [ids.runActive, ids.runCompleted, ids.runCancelled];
const createdActivityIds: string[] = [];

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@umtest.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function expectDomainCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected domain error ${code}`);
  } catch (error) {
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

async function createTestUser(id: string, name: string, accountRole: AccountRole) {
  await orm.User.create({
    id,
    name,
    email: `${id}@umtest.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function deleteIfPresent(table: "User" | "Run" | "ActivityEvent", id: string) {
  try {
    if (table === "User") await orm.User.where({ id }).delete();
    else if (table === "Run") await orm.Run.where({ id }).delete();
    else await orm.ActivityEvent.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

async function setRole(userId: string, accountRole: AccountRole) {
  await orm.User.where({ id: userId }).update({
    accountRole,
    updatedAt: new Date().toISOString(),
  });
}

async function createRun(input: {
  id: string;
  title: string;
  raidLeadId: string;
  status: RunStatus;
}) {
  const now = new Date().toISOString();
  await orm.Run.create({
    id: input.id,
    title: input.title,
    raidId,
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    scheduledStartAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    status: input.status,
    signupsOpen: input.status === "OPEN",
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    plannedBossCount: 8,
    raidLeadId: input.raidLeadId,
    notes: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function cleanupDomain() {
  for (const runId of createdRunIds) {
    await deleteIfPresent("Run", runId);
  }
  for (const userId of createdUserIds) {
    const activities = await orm.ActivityEvent.where({ userId }).all();
    for (const row of activities) {
      await deleteIfPresent("ActivityEvent", String(row.id));
      createdActivityIds.push(String(row.id));
    }
    const leadRuns = await orm.Run.where({ raidLeadId: userId }).select("id").all();
    for (const run of leadRuns) {
      await deleteIfPresent("Run", String((run as { id: string }).id));
    }
    await deleteIfPresent("User", userId);
  }
  createdActivityIds.length = 0;
}

const user = asUser(ids.user, "UM User");
const lead = asUser(ids.lead, "UM Lead", "RAID_LEAD");
const admin = asUser(ids.admin, "UM Admin", "ADMIN");

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanupDomain();
  await createTestUser(ids.user, "UM User", "USER");
  await createTestUser(ids.lead, "UM Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "UM Admin", "ADMIN");
  await createTestUser(ids.adminTwo, "UM Admin Two", "ADMIN");
  await createTestUser(ids.target, "UM Target", "USER");
});

afterAll(async () => {
  await cleanupDomain();
});

beforeEach(async () => {
  for (const runId of createdRunIds) {
    await deleteIfPresent("Run", runId);
  }
  for (const userId of createdUserIds) {
    const activities = await orm.ActivityEvent.where({ userId }).all();
    for (const row of activities) {
      await deleteIfPresent("ActivityEvent", String(row.id));
    }
  }
  await setRole(ids.user, "USER");
  await setRole(ids.lead, "RAID_LEAD");
  await setRole(ids.admin, "ADMIN");
  await setRole(ids.adminTwo, "ADMIN");
  await setRole(ids.target, "USER");
});

describe("userManagementService authorization", () => {
  it("blocks USER and RAID_LEAD from list, detail, and role changes", async () => {
    await expectDomainCode(userManagementService.listUsers(user), "USER_MANAGEMENT_FORBIDDEN");
    await expectDomainCode(userManagementService.listUsers(lead), "USER_MANAGEMENT_FORBIDDEN");
    await expectDomainCode(userManagementService.getUserDetail(user, ids.target), "USER_MANAGEMENT_FORBIDDEN");
    await expectDomainCode(userManagementService.getUserDetail(lead, ids.target), "USER_MANAGEMENT_FORBIDDEN");
    await expectDomainCode(
      userManagementService.changeAccountRole(user, { targetUserId: ids.target, nextRole: "RAID_LEAD" }),
      "USER_MANAGEMENT_FORBIDDEN",
    );
    await expectDomainCode(
      userManagementService.changeAccountRole(lead, { targetUserId: ids.target, nextRole: "RAID_LEAD" }),
      "USER_MANAGEMENT_FORBIDDEN",
    );
  });

  it("lets ADMIN list users and load detail", async () => {
    const listed = await userManagementService.listUsers(admin, { query: "UM Target" });
    expect(listed.some((row) => row.id === ids.target)).toBe(true);
    const detail = await userManagementService.getUserDetail(admin, ids.target);
    expect(detail.user.id).toBe(ids.target);
    expect(detail.user.accountRole).toBe("USER");
  });
});

describe("userManagementService role transitions", () => {
  it("supports USER→RAID_LEAD, RAID_LEAD→ADMIN, and ADMIN→USER when another admin remains", async () => {
    const toLead = await userManagementService.changeAccountRole(admin, {
      targetUserId: ids.target,
      nextRole: "RAID_LEAD",
    });
    expect(toLead.previousRole).toBe("USER");
    expect(toLead.nextRole).toBe("RAID_LEAD");

    const toAdmin = await userManagementService.changeAccountRole(admin, {
      targetUserId: ids.target,
      nextRole: "ADMIN",
    });
    expect(toAdmin.previousRole).toBe("RAID_LEAD");
    expect(toAdmin.nextRole).toBe("ADMIN");

    const toUser = await userManagementService.changeAccountRole(admin, {
      targetUserId: ids.target,
      nextRole: "USER",
    });
    expect(toUser.previousRole).toBe("ADMIN");
    expect(toUser.nextRole).toBe("USER");
  });

  it("rejects assigning the same role", async () => {
    await expectDomainCode(
      userManagementService.changeAccountRole(admin, { targetUserId: ids.target, nextRole: "USER" }),
      "ROLE_ALREADY_ASSIGNED",
    );
  });

  it("rejects invalid account roles", async () => {
    await expectDomainCode(
      userManagementService.changeAccountRole(admin, {
        targetUserId: ids.target,
        nextRole: "BOOSTER",
      }),
      "INVALID_ACCOUNT_ROLE",
    );
    await expectDomainCode(
      userManagementService.changeAccountRole(admin, {
        targetUserId: ids.target,
        nextRole: "not-a-role",
      }),
      "INVALID_ACCOUNT_ROLE",
    );
  });

  it("blocks demoting the last remaining admin", async () => {
    const otherAdmins = await orm.User.where({ accountRole: "ADMIN" }).select("id").all();
    const parked: Array<{ id: string; previous: AccountRole }> = [];
    try {
      for (const row of otherAdmins) {
        const id = String((row as { id: string }).id);
        if (id === ids.admin) continue;
        parked.push({ id, previous: "ADMIN" });
        await setRole(id, "RAID_LEAD");
      }
      await expectDomainCode(
        userManagementService.changeAccountRole(admin, { targetUserId: ids.admin, nextRole: "USER" }),
        "LAST_ADMIN_REQUIRED",
      );
    } finally {
      for (const entry of parked) {
        await setRole(entry.id, entry.previous);
      }
    }
  });
});

describe("userManagementService active run safety", () => {
  it("blocks demotion to USER while a non-terminal run is assigned", async () => {
    await createRun({
      id: ids.runActive,
      title: "UM Active Lead Run",
      raidLeadId: ids.lead,
      status: "OPEN",
    });
    await expectDomainCode(
      userManagementService.changeAccountRole(admin, { targetUserId: ids.lead, nextRole: "USER" }),
      "ROLE_CHANGE_BLOCKED_BY_ACTIVE_RUNS",
    );
  });

  it("allows demotion when only COMPLETED or CANCELLED runs remain", async () => {
    await createRun({
      id: ids.runCompleted,
      title: "UM Completed Lead Run",
      raidLeadId: ids.lead,
      status: "COMPLETED",
    });
    await createRun({
      id: ids.runCancelled,
      title: "UM Cancelled Lead Run",
      raidLeadId: ids.lead,
      status: "CANCELLED",
    });
    const result = await userManagementService.changeAccountRole(admin, {
      targetUserId: ids.lead,
      nextRole: "USER",
    });
    expect(result.nextRole).toBe("USER");
  });
});

describe("userManagementService audit and session freshness", () => {
  it("writes ACCOUNT_ROLE_CHANGED with actor id and targetUserId marker", async () => {
    await userManagementService.changeAccountRole(admin, {
      targetUserId: ids.target,
      nextRole: "RAID_LEAD",
    });
    const events = await orm.ActivityEvent.where({ userId: ids.admin, type: "ACCOUNT_ROLE_CHANGED" }).all();
    const match = events.find((row) => String((row as { message: string }).message).includes(`targetUserId=${ids.target}`));
    expect(match).toBeTruthy();
    expect(String((match as { type: string }).type)).toBe("ACCOUNT_ROLE_CHANGED");
    expect(String((match as { userId: string }).userId)).toBe(ids.admin);
  });

  it("reloads the new role from the database via findAuthenticatedById", async () => {
    await userManagementService.changeAccountRole(admin, {
      targetUserId: ids.target,
      nextRole: "RAID_LEAD",
    });
    const fresh = await userRepository.findAuthenticatedById(ids.target);
    expect(fresh?.accountRole).toBe("RAID_LEAD");
  });
});
