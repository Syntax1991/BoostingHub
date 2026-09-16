import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { venomousCreateInput, venomousUpdateInput } from "@/lib/test-run-input";
import { runRepository } from "@/repositories/run.repository";
import { CROSS_RUN_RESERVATION_MIN_GAP_MS } from "@/repositories/signup.repository";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import { characterAvailabilityService } from "@/services/character-availability.service";
import { characterService } from "@/services/character.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";

const ids = {
  owner: "bbbbbbbb-bbbb-4bbb-8bbb-sci000000001",
  lead: "bbbbbbbb-bbbb-4bbb-8bbb-sci000000002",
  admin: "bbbbbbbb-bbbb-4bbb-8bbb-sci000000003",
};

const createdCharacterIds: string[] = [];
const createdBlockIds: string[] = [];
const createdRunIds: string[] = [];

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@sci.boostting.local`,
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

async function ensureUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@sci.boostting.local`,
    emailVerified: false,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).catch(() => {});
}

async function createOpenRun(
  lead: AuthenticatedUser,
  scheduledStartAt: string,
  targets: { tanks?: number; healers?: number; dps?: number } = {},
) {
  const run = await runService.createRun(
    lead,
    venomousCreateInput({
      scheduledStartAt,
      desiredTankCount: targets.tanks ?? 0,
      desiredHealerCount: targets.healers ?? 0,
      desiredDpsCount: targets.dps ?? 0,
    }),
  );
  createdRunIds.push(run.id);
  await runService.openRun(lead, run.id);
  return run;
}

async function cleanupRun(runId: string) {
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) {
    const rosterId = (roster as { id: string }).id;
    await orm.RunRosterEntry.where({ rosterId }).delete().catch(() => {});
    await orm.RunRoster.where({ id: rosterId }).delete().catch(() => {});
  }
  const signups = (await orm.RunSignup.where({ runId }).all()) as Array<{ id: string }>;
  for (const signup of signups) {
    await orm.RunSignupRole.where({ signupId: signup.id }).delete().catch(() => {});
  }
  await orm.RunSignup.where({ runId }).delete().catch(() => {});
  await orm.RunRaidContent.where({ runId }).delete().catch(() => {});
  await orm.Run.where({ id: runId }).delete().catch(() => {});
}

beforeAll(async () => {
  await ensureUser(ids.owner, "SCI Owner", "USER");
  await ensureUser(ids.lead, "SCI Lead", "RAID_LEAD");
  await ensureUser(ids.admin, "SCI Admin", "ADMIN");
});

afterAll(async () => {
  for (const id of createdBlockIds) {
    await orm.CharacterAvailabilityBlock.where({ id }).delete().catch(() => {});
  }
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const id of createdCharacterIds) {
    await orm.CharacterAvailabilityBlock.where({ characterId: id }).delete().catch(() => {});
    await orm.Character.where({ id }).delete().catch(() => {});
  }
  await orm.BoosterQualification.where({ userId: ids.owner }).delete().catch(() => {});
});

describe("schedule conflict integrity", () => {
  const owner = asUser(ids.owner, "SCI Owner");
  const lead = asUser(ids.lead, "SCI Lead", "RAID_LEAD");
  const admin = asUser(ids.admin, "SCI Admin", "ADMIN");

  it("keeps signup/roster after availability is added, surfaces conflict, and blocks publish until resolved", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Scisyn",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 640,
    });
    createdCharacterIds.push(character.id);
    await orm.Character.where({ id: character.id }).update({ warcraftLogsId: "11223344" });
    await boosterQualificationService.grant(admin, { userId: ids.owner, difficulty: "HEROIC" }).catch(() => {});

    const run = await createOpenRun(lead, "2026-11-10T18:00:00.000Z", { healers: 1 });
    await signupService.createBoosterSignup(owner, {
      runId: run.id,
      characterId: character.id,
      role: "HEALER",
      isBackup: false,
    });

    const before = await rosterService.getRosterManagementView(lead, run.id);
    const candidate = before.boosters.find((row) => row.character?.id === character.id);
    expect(candidate?.scheduleConflicts).toEqual([]);
    expect(candidate?.character?.warcraftLogsId).toBe("11223344");

    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: before.roster.version,
      selections: [{ signupId: candidate!.id, selectedRole: "HEALER" }],
    });

    const selectedView = await rosterService.getRosterManagementView(lead, run.id);
    const selected = selectedView.boosters.find((row) => row.character?.id === character.id);
    expect(selected?.draftSelected).toBe(true);
    expect(selected?.selectedRole).toBe("HEALER");
    expect(selected?.scheduleConflicts).toEqual([]);

    const block = await characterAvailabilityService.createBlock(owner, character.id, {
      startsAt: "2026-11-10T17:00:00.000Z",
      endsAt: "2026-11-10T20:00:00.000Z",
      reason: "External boost",
    });
    createdBlockIds.push(block.id);

    const conflicted = await rosterService.getRosterManagementView(lead, run.id);
    const conflictedRow = conflicted.boosters.find((row) => row.character?.id === character.id);
    expect(conflictedRow?.draftSelected).toBe(true);
    expect(conflictedRow?.selectedRole).toBe("HEALER");
    expect(conflictedRow?.character?.warcraftLogsId).toBe("11223344");
    expect(conflictedRow?.scheduleConflicts.map((row) => row.source)).toEqual(["MANUAL_AVAILABILITY"]);
    expect(conflictedRow?.scheduleConflicts[0]?.message).toContain("External availability:");
    expect(conflictedRow?.scheduleConflicts[0]?.message).toContain("External boost");

    const myRuns = await signupService.getMyRuns(owner);
    const mine = [...myRuns.pending, ...myRuns.selected].find((row) => row.runId === run.id);
    expect(mine).toBeTruthy();
    expect(mine?.scheduleConflicts?.length).toBeGreaterThan(0);

    await expectDomainCode(
      rosterService.publishRoster(lead, {
        runId: run.id,
        version: conflicted.roster.version,
        acknowledgeWarnings: true,
      }),
      "ROSTER_HAS_SCHEDULE_CONFLICTS",
    );

    await characterAvailabilityService.deleteBlock(owner, block.id);
    const clearedBlockIds = createdBlockIds.filter((id) => id !== block.id);
    createdBlockIds.length = 0;
    createdBlockIds.push(...clearedBlockIds);

    const cleared = await rosterService.getRosterManagementView(lead, run.id);
    const clearedRow = cleared.boosters.find((row) => row.character?.id === character.id);
    expect(clearedRow?.draftSelected).toBe(true);
    expect(clearedRow?.selectedRole).toBe("HEALER");
    expect(clearedRow?.scheduleConflicts).toEqual([]);

    await rosterService.publishRoster(lead, {
      runId: run.id,
      version: cleared.roster.version,
      acknowledgeWarnings: true,
    });
  });

  it("rejects new roster selection while conflicted and allows it after resolve", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Scipick",
      realm: "Kazzak",
      region: "EU",
      wowClass: "PRIEST",
      specialization: "Holy",
      itemLevel: 630,
    });
    createdCharacterIds.push(character.id);
    await boosterQualificationService.grant(admin, { userId: ids.owner, difficulty: "HEROIC" }).catch(() => {});

    const block = await characterAvailabilityService.createBlock(owner, character.id, {
      startsAt: "2026-11-11T17:00:00.000Z",
      endsAt: "2026-11-11T21:00:00.000Z",
      reason: "Busy",
    });
    createdBlockIds.push(block.id);

    const run = await createOpenRun(lead, "2026-11-11T16:00:00.000Z", { healers: 1 });
    await signupService.createBoosterSignup(owner, {
      runId: run.id,
      characterId: character.id,
      role: "HEALER",
      isBackup: false,
    });

    const loaded = await runRepository.findById(run.id);
    await runService.updateRun(
      lead,
      venomousUpdateInput(run.id, loaded!, { scheduledStartAt: "2026-11-11T18:00:00.000Z" }),
    );

    const view = await rosterService.getRosterManagementView(lead, run.id);
    const row = view.boosters.find((item) => item.character?.id === character.id);
    expect(row?.draftSelected).toBe(false);
    expect(row?.scheduleConflicts.length).toBe(1);

    await expectDomainCode(
      rosterService.saveDraftSelection(lead, {
        runId: run.id,
        version: view.roster.version,
        selections: [{ signupId: row!.id, selectedRole: "HEALER" }],
      }),
      "CHARACTER_SCHEDULE_CONFLICT",
    );

    await characterAvailabilityService.deleteBlock(owner, block.id);
    const remaining = createdBlockIds.filter((id) => id !== block.id);
    createdBlockIds.length = 0;
    createdBlockIds.push(...remaining);

    const again = await rosterService.getRosterManagementView(lead, run.id);
    const againRow = again.boosters.find((item) => item.character?.id === character.id);
    expect(againRow?.scheduleConflicts).toEqual([]);
    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: again.roster.version,
      selections: [{ signupId: againRow!.id, selectedRole: "HEALER" }],
    });
  });

  it("re-evaluates conflicts when Run scheduledStartAt moves across an availability window", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Scitime",
      realm: "Draenor",
      region: "EU",
      wowClass: "MAGE",
      specialization: "Frost",
      itemLevel: 620,
    });
    createdCharacterIds.push(character.id);
    await boosterQualificationService.grant(admin, { userId: ids.owner, difficulty: "HEROIC" }).catch(() => {});

    const block = await characterAvailabilityService.createBlock(owner, character.id, {
      startsAt: "2026-11-12T19:00:00.000Z",
      endsAt: "2026-11-12T22:00:00.000Z",
      reason: "External boost",
    });
    createdBlockIds.push(block.id);

    const run = await createOpenRun(lead, "2026-11-12T17:00:00.000Z", { dps: 1 });
    await signupService.createBoosterSignup(owner, {
      runId: run.id,
      characterId: character.id,
      role: "DPS",
      isBackup: false,
    });
    let view = await rosterService.getRosterManagementView(lead, run.id);
    let row = view.boosters.find((item) => item.character?.id === character.id);
    expect(row?.scheduleConflicts).toEqual([]);
    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: view.roster.version,
      selections: [{ signupId: row!.id, selectedRole: "DPS" }],
    });

    const loaded = await runRepository.findById(run.id);
    await runService.updateRun(
      lead,
      venomousUpdateInput(run.id, loaded!, { scheduledStartAt: "2026-11-12T20:00:00.000Z" }),
    );

    view = await rosterService.getRosterManagementView(lead, run.id);
    row = view.boosters.find((item) => item.character?.id === character.id);
    expect(row?.draftSelected).toBe(true);
    expect(row?.selectedRole).toBe("DPS");
    expect(row?.scheduleConflicts.map((c) => c.source)).toEqual(["MANUAL_AVAILABILITY"]);
    await expectDomainCode(
      rosterService.publishRoster(lead, {
        runId: run.id,
        version: view.roster.version,
        acknowledgeWarnings: true,
      }),
      "ROSTER_HAS_SCHEDULE_CONFLICTS",
    );

    const loadedAgain = await runRepository.findById(run.id);
    await runService.updateRun(
      lead,
      venomousUpdateInput(run.id, loadedAgain!, { scheduledStartAt: "2026-11-12T22:00:00.000Z" }),
    );
    view = await rosterService.getRosterManagementView(lead, run.id);
    row = view.boosters.find((item) => item.character?.id === character.id);
    expect(row?.scheduleConflicts).toEqual([]);
  });

  it("surfaces reservation conflicts after a cross-run time edit and clears at exactly 2h", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Scires",
      realm: "Silvermoon",
      region: "EU",
      wowClass: "WARLOCK",
      specialization: "Affliction",
      itemLevel: 625,
    });
    createdCharacterIds.push(character.id);
    await boosterQualificationService.grant(admin, { userId: ids.owner, difficulty: "HEROIC" }).catch(() => {});

    const runA = await createOpenRun(lead, "2026-11-13T17:00:00.000Z", { dps: 1 });
    const runB = await createOpenRun(lead, "2026-11-13T20:00:00.000Z", { dps: 1 });
    expect(CROSS_RUN_RESERVATION_MIN_GAP_MS).toBe(2 * 60 * 60 * 1000);

    await signupService.createBoosterSignup(owner, {
      runId: runA.id,
      characterId: character.id,
      role: "DPS",
      isBackup: false,
    });
    const viewA = await rosterService.getRosterManagementView(lead, runA.id);
    const signupA = viewA.boosters.find((item) => item.character?.id === character.id)!;
    await rosterService.saveDraftSelection(lead, {
      runId: runA.id,
      version: viewA.roster.version,
      selections: [{ signupId: signupA.id, selectedRole: "DPS" }],
    });

    await signupService.createBoosterSignup(owner, {
      runId: runB.id,
      characterId: character.id,
      role: "DPS",
      isBackup: false,
    });
    let viewB = await rosterService.getRosterManagementView(lead, runB.id);
    const signupB = viewB.boosters.find((item) => item.character?.id === character.id)!;
    expect(signupB.scheduleConflicts).toEqual([]);
    await rosterService.saveDraftSelection(lead, {
      runId: runB.id,
      version: viewB.roster.version,
      selections: [{ signupId: signupB.id, selectedRole: "DPS" }],
    });

    const loadedB = await runRepository.findById(runB.id);
    await runService.updateRun(
      lead,
      venomousUpdateInput(runB.id, loadedB!, { scheduledStartAt: "2026-11-13T18:30:00.000Z" }),
    );
    viewB = await rosterService.getRosterManagementView(lead, runB.id);
    const conflictedB = viewB.boosters.find((item) => item.character?.id === character.id)!;
    expect(conflictedB.draftSelected).toBe(true);
    expect(conflictedB.scheduleConflicts.some((c) => c.source === "RUN_RESERVATION")).toBe(true);
    await expectDomainCode(
      rosterService.publishRoster(lead, {
        runId: runB.id,
        version: viewB.roster.version,
        acknowledgeWarnings: true,
      }),
      "ROSTER_HAS_SCHEDULE_CONFLICTS",
    );

    const loadedExact = await runRepository.findById(runB.id);
    await runService.updateRun(
      lead,
      venomousUpdateInput(runB.id, loadedExact!, {
        scheduledStartAt: new Date(
          Date.parse("2026-11-13T17:00:00.000Z") + CROSS_RUN_RESERVATION_MIN_GAP_MS,
        ).toISOString(),
      }),
    );
    viewB = await rosterService.getRosterManagementView(lead, runB.id);
    const clearedB = viewB.boosters.find((item) => item.character?.id === character.id)!;
    expect(clearedB.scheduleConflicts.filter((c) => c.source === "RUN_RESERVATION")).toEqual([]);
  });

  it("projects both reservation and manual conflicts without duplicating per raid content", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Sciboth",
      realm: "Outland",
      region: "EU",
      wowClass: "DRUID",
      specialization: "Restoration",
      itemLevel: 635,
    });
    createdCharacterIds.push(character.id);
    await boosterQualificationService.grant(admin, { userId: ids.owner, difficulty: "HEROIC" }).catch(() => {});

    const runA = await createOpenRun(lead, "2026-11-14T18:00:00.000Z", { healers: 1 });
    await signupService.createBoosterSignup(owner, {
      runId: runA.id,
      characterId: character.id,
      role: "HEALER",
      isBackup: false,
    });
    const viewA = await rosterService.getRosterManagementView(lead, runA.id);
    const signupA = viewA.boosters.find((item) => item.character?.id === character.id)!;
    await rosterService.saveDraftSelection(lead, {
      runId: runA.id,
      version: viewA.roster.version,
      selections: [{ signupId: signupA.id, selectedRole: "HEALER" }],
    });

    const runC = await createOpenRun(lead, "2026-11-14T22:00:00.000Z", { healers: 1 });
    await signupService.createBoosterSignup(owner, {
      runId: runC.id,
      characterId: character.id,
      role: "HEALER",
      isBackup: false,
    });
    const block = await characterAvailabilityService.createBlock(owner, character.id, {
      startsAt: "2026-11-14T21:30:00.000Z",
      endsAt: "2026-11-14T23:00:00.000Z",
      reason: "External boost",
    });
    createdBlockIds.push(block.id);

    const loadedC = await runRepository.findById(runC.id);
    await runService.updateRun(
      lead,
      venomousUpdateInput(runC.id, loadedC!, { scheduledStartAt: "2026-11-14T19:30:00.000Z" }),
    );
    await characterAvailabilityService.updateBlock(owner, block.id, {
      startsAt: "2026-11-14T19:00:00.000Z",
      endsAt: "2026-11-14T21:00:00.000Z",
      reason: "External boost",
    });

    const viewC = await rosterService.getRosterManagementView(lead, runC.id);
    const row = viewC.boosters.find((item) => item.character?.id === character.id)!;
    expect(row.scheduleConflicts.map((c) => c.source)).toEqual([
      "RUN_RESERVATION",
      "MANUAL_AVAILABILITY",
    ]);
    expect(row.scheduleConflicts).toHaveLength(2);
  });
});
