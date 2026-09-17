import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { futureTestIso, venomousCreateInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { attendanceRepository } from "@/repositories/attendance.repository";
import { payoutRepository } from "@/repositories/payout.repository";
import { attendanceService } from "@/services/attendance.service";
import { managementHubService } from "@/services/management-hub.service";
import { payoutService } from "@/services/payout.service";
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
const createdAccessIds: string[] = [];
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
    else if (table === "BoosterQualification") await orm.BoosterQualification.where({ id }).delete();
    else if (table === "RunAttendance") await orm.RunAttendance.where({ id }).delete();
    else if (table === "RunSettlement") await orm.RunSettlement.where({ id }).delete();
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
  const existing = await orm.BoosterQualification.where({ userId, difficulty: "HEROIC" }).first();
  if (existing) {
    createdAccessIds.push(String((existing as { id: string }).id));
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  createdAccessIds.push(id);
  await orm.BoosterQualification.create({
    id,
    userId,
    difficulty: "HEROIC",
    status: "APPROVED",
    notes: "Handoff test grant",
    grantedAt: now,
    grantedById: ids.admin,
    revokedAt: null,
    revokedById: null,
    createdAt: now,
    updatedAt: now,
  });
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
  const settlement = await orm.RunSettlement.where({ runId }).first();
  if (settlement) {
    const settlementId = (settlement as { id: string }).id;
    const entries = await orm.RunPayoutEntry.where({ settlementId }).select("id").all();
    for (const entry of entries) {
      await orm.RunPayoutEntry.where({ id: (entry as { id: string }).id }).delete();
    }
    await deleteIfPresent("RunSettlement", settlementId);
  }
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
    const access = await orm.BoosterQualification.where({ userId }).select("id").all();
    for (const row of access) {
      await deleteIfPresent("BoosterQualification", (row as { id: string }).id);
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
    primaryRole: "DPS",
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
  for (const id of createdAccessIds) {
    await deleteIfPresent("BoosterQualification", id);
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
    role: "DPS",
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

    const completedDraftId = await inProgressWithTwoBoosters("Handoff batch C");
    await markAllPresent(completedDraftId);
    await runService.completeRun(lead, completedDraftId);
    await payoutService.prepareSettlement(lead, completedDraftId, { totalGold: 1000 });

    const completedFinalId = await inProgressWithTwoBoosters("Handoff batch D");
    await markAllPresent(completedFinalId);
    await runService.completeRun(lead, completedFinalId);
    const prepared = await payoutService.prepareSettlement(lead, completedFinalId, { totalGold: 1000 });
    await payoutService.finalizeSettlement(lead, prepared.id);

    const summary = await attendanceRepository.summarizeByRunIds([
      unmarkedId,
      markedId,
      completedDraftId,
      completedFinalId,
    ]);
    const settlements = await payoutRepository.listStatusByRunIds([
      unmarkedId,
      markedId,
      completedDraftId,
      completedFinalId,
    ]);
    expect(summary.get(unmarkedId)?.unmarkedCount).toBe(2);
    expect(summary.get(markedId)?.unmarkedCount).toBe(0);
    expect(settlements.get(completedDraftId)).toBe("DRAFT");
    expect(settlements.get(completedFinalId)).toBe("FINALIZED");

    const page = await runService.getManagedRunsPage(lead, {});
    const byId = Object.fromEntries(page.runs.map((run) => [run.id, run]));
    expect(byId[unmarkedId]!.nextAction.kind).toBe("ATTENDANCE");
    expect(byId[markedId]!.nextAction.kind).toBe("COMPLETE");
    expect(byId[completedDraftId]!.nextAction.kind).toBe("REVIEW_PAYOUT");
    expect(byId[completedFinalId]!.nextAction.kind).toBe("VIEW_PAYOUT");

    const asAdmin = await runService.getManagedRunsPage(admin, {});
    const adminFinal = asAdmin.runs.find((run) => run.id === completedFinalId);
    expect(adminFinal!.nextAction.kind).toBe("MARK_PAID");
  }, 120_000);

  it("management hub attention metrics use the same projection", async () => {
    const needsAttendanceId = await inProgressWithTwoBoosters("Handoff hub unmarked");
    const readyId = await inProgressWithTwoBoosters("Handoff hub ready");
    await markAllPresent(readyId);
    const settleId = await inProgressWithTwoBoosters("Handoff hub settle");
    await markAllPresent(settleId);
    await runService.completeRun(lead, settleId);

    const overview = await managementHubService.getOverview(lead);
    const runsCard = overview.cards.find((card) => card.id === "runs");
    expect(runsCard).toBeTruthy();
    const byLabel = Object.fromEntries(runsCard!.metrics.map((metric) => [metric.label, Number(metric.value)]));
    expect(byLabel["Needs attendance"]).toBeGreaterThanOrEqual(1);
    expect(byLabel["Ready to complete"]).toBeGreaterThanOrEqual(1);
    expect(byLabel["Needs settlement"]).toBeGreaterThanOrEqual(1);

    // Keep fixtures referenced for cleanup clarity.
    expect(needsAttendanceId).toBeTruthy();
  }, 120_000);

  it("RAID_LEAD cannot mark paid; ADMIN can", async () => {
    const runId = await inProgressWithTwoBoosters("Handoff auth paid");
    await markAllPresent(runId);
    await runService.completeRun(lead, runId);
    const draft = await payoutService.prepareSettlement(lead, runId, { totalGold: 500 });
    await payoutService.finalizeSettlement(lead, draft.id);
    await expectDomainCode(payoutService.markPaid(lead, draft.id), "PAYOUT_ADMIN_REQUIRED");
    await payoutService.markPaid(admin, draft.id);

    const page = await runService.getManagedRunsPage(lead, {});
    const row = page.runs.find((run) => run.id === runId);
    expect(row!.settlementStage).toBe("PAID");
    expect(row!.attention).toBe("SETTLED");
    expect(row!.nextAction.kind).toBe("VIEW_PAYOUT");
  }, 60_000);
});
