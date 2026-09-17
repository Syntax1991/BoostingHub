import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { venomousCreateInput, venomousUpdateInput } from "@/lib/test-run-input";
import { runRepository } from "@/repositories/run.repository";
import { characterAvailabilityRepository } from "@/repositories/character-availability.repository";
import { CROSS_RUN_RESERVATION_MIN_GAP_MS } from "@/repositories/signup.repository";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import { characterAvailabilityCheckService } from "@/services/character-availability-check.service";
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

  it("ignores deprecated CharacterAvailabilityBlock rows for roster, My Runs, and availability check", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Scisyn",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 640,
    });
    createdCharacterIds.push(character.id);
    await boosterQualificationService.grant(admin, { userId: ids.owner, difficulty: "HEROIC" }).catch(() => {});

    const run = await createOpenRun(lead, "2026-11-10T18:00:00.000Z", { healers: 1 });
    await signupService.createBoosterSignup(owner, {
      runId: run.id,
      characterId: character.id,
      role: "HEALER",
      isBackup: false,
    });

    const before = await rosterService.getRosterManagementView(lead, run.id);
    const candidate = before.boosters.find((row) => row.character?.id === character.id)!;
    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: before.roster.version,
      selections: [{ signupId: candidate.id, selectedRole: "HEALER" }],
    });

    const block = await characterAvailabilityRepository.create({
      characterId: character.id,
      startsAt: "2026-11-10T17:00:00.000Z",
      endsAt: "2026-11-10T20:00:00.000Z",
      reason: "External boost",
    });
    createdBlockIds.push(block.id);

    const conflicted = await rosterService.getRosterManagementView(lead, run.id);
    const conflictedRow = conflicted.boosters.find((row) => row.character?.id === character.id);
    expect(conflictedRow?.draftSelected).toBe(true);
    expect(conflictedRow?.scheduleConflicts).toEqual([]);

    const myRuns = await signupService.getMyRuns(owner);
    const mine = [...myRuns.pending, ...myRuns.selected].find((row) => row.runId === run.id);
    expect(mine?.scheduleConflicts).toEqual([]);

    // Character is draft-selected on this Run, so Availability Check at that start is COMMITTED
    // from the BoostingHub reservation — never from the deprecated manual block.
    const check = await characterAvailabilityCheckService.checkOwnerCharacters(
      owner,
      "2026-11-10T18:00:00.000Z",
    );
    const row = check.characters.find((item) => item.characterId === character.id);
    expect(row?.status).toBe("COMMITTED");
    expect(row?.conflicts.every((conflict) => conflict.runId === run.id)).toBe(true);

    await rosterService.publishRoster(lead, {
      runId: run.id,
      version: conflicted.roster.version,
      acknowledgeWarnings: true,
    });
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
});
