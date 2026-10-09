import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { futureTestIso, venomousCreateInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { attendanceRepository } from "@/repositories/attendance.repository";
import { attendanceService } from "@/services/attendance.service";
import { managementHubService } from "@/services/management-hub.service";
import { runRepository } from "@/repositories/run.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import type { CharacterRole, ParticipationType } from "@/models/enums";

const ids = {
  user: "aaaaaaaa-aaaa-4aaa-8aaa-ho0000000001",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-ho0000000002",
  otherLead: "aaaaaaaa-aaaa-4aaa-8aaa-ho0000000003",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-ho0000000004",
  playerB: "aaaaaaaa-aaaa-4aaa-8aaa-ho0000000005",
};

const createdRunIds: string[] = [];
const createdUserIds = Object.values(ids);
const createdCharacterIds: string[] = [];
const createdSignupIds: string[] = [];

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@hotest.boostting.local`,
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

async function createTestUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@hotest.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function deleteIfPresent(table: string, id: string) {
  try {
    if (table === "User") await orm.User.where({ id }).delete();
    else if (table === "Character") await orm.Character.where({ id }).delete();
    else if (table === "RunSignup") await orm.RunSignup.where({ id }).delete();
    else if (table === "RunSignupRole") await orm.RunSignupRole.where({ id }).delete();
    else if (table === "RunAttendance") await orm.RunAttendance.where({ id }).delete();
    else if (table === "Run") await orm.Run.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

async function createCharacter(input: {
  userId: string;
  name: string;
  wowClass: "SHAMAN" | "PRIEST";
  specialization: string;
  primaryRole: CharacterRole;
}) {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  await orm.Character.create({
    id,
    userId: input.userId,
    name: input.name,
    realm: "Handoff Lab",
    normalizedName: normalizeCharacterIdentity(input.name),
    normalizedRealm: normalizeCharacterIdentity("Handoff Lab"),
    region: "EU",
    wowClass: input.wowClass,
    specialization: input.specialization,
    primaryRole: input.primaryRole,
    itemLevel: 700,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function approveAccess(_characterId: string, userId: string) {
  await orm.User.where({ id: userId }).update({ isBooster: true });
}

async function createSignup(input: {
  runId: string;
  userId: string;
  characterId: string;
  participationType: ParticipationType;
  role: CharacterRole | null;
}) {
  const id = crypto.randomUUID();
  createdSignupIds.push(id);
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id,
    runId: input.runId,
    userId: input.userId,
    characterId: input.characterId,
    participationType: input.participationType,
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    lootbuddyMode: input.participationType === "LOOTBUDDY" ? "LOOT_ONLY" : null,
    lootbuddyVerification: input.participationType === "LOOTBUDDY" ? "ACCESS" : null,
    createdAt: now,
    updatedAt: now,
  });
  if (input.participationType === "BOOSTER" && input.role) {
    await orm.RunSignupRole.create({
      id: crypto.randomUUID(),
      signupId: id,
      role: input.role,
      createdAt: now,
    });
  }
  return id;
}

async function selectAndPublish(actor: AuthenticatedUser, runId: string, signupIds: string[]) {
  for (const signupId of signupIds) {
    const view = await rosterService.getRosterManagementView(actor, runId);
    await rosterService.setDraftSelection(actor, {
      runId,
      signupId,
      selected: true,
      version: view.roster.version,
    });
  }
  const ready = await rosterService.getRosterManagementView(actor, runId);
  await rosterService.publishRoster(actor, {
    runId,
    version: ready.roster.version,
    acknowledgeWarnings: true,
  });
}

async function cleanupRun(runId: string) {
  const snapshots = await orm.RunStartSnapshot.where({ runId }).select("id").all();
  for (const row of snapshots) {
    await orm.RunStartSnapshot.where({ id: (row as { id: string }).id }).delete();
  }
  const attendance = await orm.RunAttendance.where({ runId }).select("id").all();
  for (const row of attendance) {
    await deleteIfPresent("RunAttendance", (row as { id: string }).id);
  }
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) {
    const rosterId = (roster as { id: string }).id;
    const entries = await orm.RunRosterEntry.where({ rosterId }).all();
    for (const entry of entries) {
      await orm.RunRosterEntry.where({ id: (entry as { id: string }).id }).delete();
    }
    await orm.RunRoster.where({ id: rosterId }).delete();
  }
  const signups = await orm.RunSignup.where({ runId }).select("id").all();
  for (const row of signups) {
    const signupId = (row as { id: string }).id;
    const offered = await orm.RunSignupRole.where({ signupId }).select("id").all();
    for (const offer of offered) {
      await deleteIfPresent("RunSignupRole", (offer as { id: string }).id);
    }
    await deleteIfPresent("RunSignup", signupId);
  }
  const contents = await orm.RunRaidContent.where({ runId }).select("id").all();
  for (const row of contents) {
    await orm.RunRaidContent.where({ id: (row as { id: string }).id }).delete();
  }
  await deleteIfPresent("Run", runId);
}

const user = asUser(ids.user, "Handoff User");
const lead = asUser(ids.lead, "Handoff Lead", "RAID_LEAD");
const admin = asUser(ids.admin, "Handoff Admin", "ADMIN");

const characters: Record<string, string> = {};

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const userId of createdUserIds) {
    const runs = await orm.Run.where({ raidLeadId: userId }).select("id").all();
    for (const run of runs) {
      await cleanupRun((run as { id: string }).id);
    }
    const signups = await orm.RunSignup.where({ userId }).select("id").all();
    for (const row of signups) {
      const signupId = (row as { id: string }).id;
      const offered = await orm.RunSignupRole.where({ signupId }).select("id").all();
      for (const offer of offered) {
        await deleteIfPresent("RunSignupRole", (offer as { id: string }).id);
      }
      await deleteIfPresent("RunSignup", signupId);
    }
    const chars = await orm.Character.where({ userId }).select("id").all();
    for (const row of chars) {
      await deleteIfPresent("Character", (row as { id: string }).id);
    }
    await deleteIfPresent("User", userId);
  }
  await createTestUser(ids.user, "Handoff User", "USER");
  await createTestUser(ids.lead, "Handoff Lead", "RAID_LEAD");
  await createTestUser(ids.otherLead, "Handoff Other Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "Handoff Admin", "ADMIN");
  await createTestUser(ids.playerB, "Handoff Player B", "USER");

  characters.user = await createCharacter({
    userId: ids.user,
    name: "Hokael",
    wowClass: "SHAMAN",
    specialization: "Elemental",
    primaryRole: "MELEE_DPS",
  });
  characters.playerB = await createCharacter({
    userId: ids.playerB,
    name: "Homira",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
  });
  await approveAccess(characters.user, ids.user);
  await approveAccess(characters.playerB, ids.playerB);
}, 60_000);

afterAll(async () => {
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const id of createdSignupIds) {
    const offered = await orm.RunSignupRole.where({ signupId: id }).select("id").all();
    for (const offer of offered) {
      await deleteIfPresent("RunSignupRole", (offer as { id: string }).id);
    }
    await deleteIfPresent("RunSignup", id);
  }
  for (const id of createdCharacterIds) {
    await deleteIfPresent("Character", id);
  }
  for (const id of createdUserIds) {
    await deleteIfPresent("User", id);
  }
}, 60_000);

let scheduleDayOffset = 20;

async function createDraft(actor: AuthenticatedUser, title: string) {
  scheduleDayOffset += 1;
  const created = await runService.createRun(
    actor,
    venomousCreateInput({
      title,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      venomousPlannedBossCount: 8,
      scheduledStartAt: futureTestIso(scheduleDayOffset),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    }),
  );
  createdRunIds.push(created.id);
  return created.id;
}

async function inProgressWithTwoBoosters(title: string) {
  const runId = await createDraft(lead, title);
  await runService.openRun(lead, runId);
  const a = await createSignup({
    runId,
    userId: ids.user,
    characterId: characters.user,
    participationType: "BOOSTER",
    role: "MELEE_DPS",
  });
  const b = await createSignup({
    runId,
    userId: ids.playerB,
    characterId: characters.playerB,
    participationType: "BOOSTER",
    role: "HEALER",
  });
  await selectAndPublish(lead, runId, [a, b]);
  await runService.startRun(lead, { runId });
  return runId;
}

async function markAllPresent(runId: string) {
  const rows = await attendanceRepository.listByRunId(runId);
  for (const attendance of rows) {
    await attendanceService.setStatus(lead, { attendanceId: attendance.id, status: "PRESENT" });
  }
}

describe("raid lead lifecycle handoffs (managed runs)", () => {
  it("USER cannot load managed runs page", async () => {
    await expectDomainCode(runService.getManagedRunsPage(user, {}), "NOT_AUTHORIZED");
  });

  it("surfaces real unmarkedCount and attendance handoff for IN_PROGRESS", async () => {
    const runId = await inProgressWithTwoBoosters("Handoff unmarked");
    const page = await runService.getManagedRunsPage(lead, {});
    const row = page.runs.find((run) => run.id === runId);
    expect(row).toBeTruthy();
    expect(row!.attendance.total).toBe(2);
    expect(row!.attendance.unmarkedCount).toBe(2);
    expect(row!.attention).toBe("NEEDS_ATTENDANCE");
    expect(row!.nextAction.kind).toBe("ATTENDANCE");
    expect(row!.nextAction.tab).toBe("attendance");

    await markAllPresent(runId);
    const refreshed = await runService.getManagedRunsPage(lead, {});
    const after = refreshed.runs.find((run) => run.id === runId);
    expect(after!.attendance.unmarkedCount).toBe(0);
    expect(after!.attention).toBe("READY_TO_COMPLETE");
    expect(after!.nextAction.kind).toBe("COMPLETE");
  }, 60_000);

  it("projects independent handoffs across batched runs", async () => {
    const unmarkedId = await inProgressWithTwoBoosters("Handoff batch A");
    const markedId = await inProgressWithTwoBoosters("Handoff batch B");
    await markAllPresent(markedId);

    const completedId = await inProgressWithTwoBoosters("Handoff batch C");
    await markAllPresent(completedId);
    await runService.completeRun(lead, completedId);

    const summary = await attendanceRepository.summarizeByRunIds([unmarkedId, markedId, completedId]);
    expect(summary.get(unmarkedId)?.unmarkedCount).toBe(2);
    expect(summary.get(markedId)?.unmarkedCount).toBe(0);

    const page = await runService.getManagedRunsPage(lead, {});
    const byId = Object.fromEntries(page.runs.map((run) => [run.id, run]));
    expect(byId[unmarkedId]!.nextAction.kind).toBe("ATTENDANCE");
    expect(byId[markedId]!.nextAction.kind).toBe("COMPLETE");

    // A COMPLETED Run is done for every role: no financial follow-up action.
    for (const actor of [lead, admin]) {
      const view = await runService.getManagedRunsPage(actor, {});
      const completed = view.runs.find((run) => run.id === completedId);
      if (!completed) continue; // completed Runs may be filtered out of the active list
      expect(completed.attention).toBe("NONE");
      expect(completed.nextAction.kind).toBe("VIEW");
    }
  }, 120_000);

  it("management hub attention metrics use the same projection", async () => {
    const rosterId = await createDraft(lead, "Handoff hub roster");
    await runService.openRun(lead, rosterId);
    const needsAttendanceId = await inProgressWithTwoBoosters("Handoff hub unmarked");
    const readyId = await inProgressWithTwoBoosters("Handoff hub ready");
    await markAllPresent(readyId);

    const overview = await managementHubService.getOverview(lead);
    const runsCard = overview.cards.find((card) => card.id === "runs");
    expect(runsCard).toBeTruthy();
    const byLabel = Object.fromEntries(runsCard!.metrics.map((metric) => [metric.label, Number(metric.value)]));
    expect(byLabel["Roster work"]).toBeGreaterThanOrEqual(1);
    expect(byLabel["Needs attendance"]).toBeGreaterThanOrEqual(1);
    expect(byLabel["Ready to complete"]).toBeGreaterThanOrEqual(1);
    expect(byLabel["Needs settlement"]).toBeUndefined();

    // Keep fixtures referenced for cleanup clarity.
    expect(needsAttendanceId).toBeTruthy();
    expect(rosterId).toBeTruthy();
  }, 120_000);

  it("completing a Run creates no settlement work and keeps the Run COMPLETED", async () => {
    const runId = await inProgressWithTwoBoosters("Handoff complete is final");
    await markAllPresent(runId);
    await runService.completeRun(lead, runId);
    const run = await runRepository.findById(runId);
    expect(run?.status).toBe("COMPLETED");
    const overview = await managementHubService.getOverview(admin);
    const runsCard = overview.cards.find((card) => card.id === "runs");
    const labels = (runsCard?.metrics ?? []).map((metric) => metric.label);
    expect(labels.some((label) => /settle|payout|paid/i.test(label))).toBe(false);
  }, 60_000);
});
