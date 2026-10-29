import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import {
  applyRangeAssignment,
  bossesInRange,
  bossExceptionsPayload,
  bossPlanIsDirty,
  evaluateLiveBossPlan,
  nextBossRange,
  resetSlotBosses,
  slotCharacterChoices,
} from "@/components/manage/roster-boss-plan-editor";
import { describeSlotBossPlan, type RosterBossException } from "@/lib/roster-boss-plan";
import { diffBossPlans } from "@/lib/roster-diff";
import { TIDEBOUND_GROTTO_RAID_ID, VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import type { AccountRole, CharacterRole, WowClass } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { queryReservationConflicts } from "@/repositories/signup.repository";
import { rosterBuilderService } from "@/services/roster-builder.service";
import { rosterService } from "@/services/roster.service";
import { signupService } from "@/services/signup.service";
import { lockoutService } from "@/services/lockout.service";
import { runService } from "@/services/run.service";
import { attendanceService } from "@/services/attendance.service";
import { attendanceRepository } from "@/repositories/attendance.repository";
import { discordSyncService, rosterBossPlanRenderKey } from "@/services/discord-sync.service";
import { runPreflightService } from "@/services/run-preflight.service";
import { runConsumableAuditRepository } from "@/repositories/run-consumable-audit.repository";
import { buildRosterEmbed } from "@/discord-bot/embeds/roster-embed";
import { renderRunStartMessageText } from "@/discord-bot/messages/run-start-message";

const ids = {
  lead: "dddddddd-dddd-4ddd-8ddd-bex000000001",
  userA: "dddddddd-dddd-4ddd-8ddd-bex000000002",
  userB: "dddddddd-dddd-4ddd-8ddd-bex000000003",
  userC: "dddddddd-dddd-4ddd-8ddd-bex000000004",
  run: "dddddddd-dddd-4ddd-8ddd-bexr00000001",
  charA: "dddddddd-dddd-4ddd-8ddd-bexc00000001",
  charAlt: "dddddddd-dddd-4ddd-8ddd-bexc00000002",
  charB: "dddddddd-dddd-4ddd-8ddd-bexc00000003",
  charC: "dddddddd-dddd-4ddd-8ddd-bexc00000004",
  signupA: "dddddddd-dddd-4ddd-8ddd-bexs00000001",
  signupAlt: "dddddddd-dddd-4ddd-8ddd-bexs00000002",
  signupB: "dddddddd-dddd-4ddd-8ddd-bexs00000003",
  signupC: "dddddddd-dddd-4ddd-8ddd-bexs00000004",
};

const START = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

function asUser(id: string, accountRole: AccountRole): AuthenticatedUser {
  return { id, name: id, email: `${id}@bex.local`, image: null, discordUserId: null, discordUsername: null, accountRole, accountStatus: "ACTIVE" };
}

const lead = asUser(ids.lead, "RAID_LEAD");

async function createUser(id: string, accountRole: AccountRole) {
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name: id,
    email: `${id}@bex.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    isBooster: true,
    isLootbuddy: false,
    createdAt: now,
    updatedAt: now,
  });
}

async function createCharacter(id: string, userId: string, name: string, wowClass: WowClass, spec: string, role: CharacterRole) {
  const now = new Date().toISOString();
  await orm.Character.create({
    id,
    userId,
    name,
    realm: "Antonidas",
    region: "EU",
    normalizedName: name.toLowerCase(),
    normalizedRealm: "antonidas",
    wowClass,
    specialization: spec,
    primaryRole: role,
    itemLevel: 330,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function createSignup(id: string, userId: string, characterId: string, roles: CharacterRole[]) {
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id,
    runId: ids.run,
    userId,
    characterId,
    participationType: "BOOSTER",
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    createdAt: now,
    updatedAt: now,
  });
  for (const role of roles) {
    await orm.RunSignupRole.create({ id: crypto.randomUUID(), signupId: id, role, createdAt: now });
  }
}

async function cleanup() {
  // Attendance references roster entries: remove it (and the start snapshot) first.
  await orm.RunAttendance.where({ runId: ids.run }).deleteAndCount().catch(() => {});
  await orm.RunStartSnapshot.where({ runId: ids.run }).deleteAndCount().catch(() => {});
  const roster = (await orm.RunRoster.where({ runId: ids.run }).first()) as { id: string } | null;
  if (roster) {
    await orm.RunRosterBossException.where({ rosterId: roster.id }).deleteAndCount().catch(() => {});
    await orm.RunRosterEntry.where({ rosterId: roster.id }).deleteAndCount().catch(() => {});
    await orm.RunRoster.where({ id: roster.id }).deleteAndCount().catch(() => {});
  }
  for (const signupId of [ids.signupA, ids.signupAlt, ids.signupB, ids.signupC]) {
    await orm.UserNotification.where({ signupId }).deleteAndCount().catch(() => {});
    await orm.RunSignupRole.where({ signupId }).deleteAndCount().catch(() => {});
    await orm.RunSignup.where({ id: signupId }).deleteAndCount().catch(() => {});
  }
  await orm.UserNotification.where({ runId: ids.run }).deleteAndCount().catch(() => {});
  await orm.RunDomainEvent.where({ runId: ids.run }).deleteAndCount().catch(() => {});
  await orm.RunRaidContent.where({ runId: ids.run }).deleteAndCount().catch(() => {});
  await orm.Run.where({ id: ids.run }).deleteAndCount().catch(() => {});
  await orm.RunAttendance.where({ runId: ids.run }).deleteAndCount().catch(() => {});
  await orm.RunStartSnapshot.where({ runId: ids.run }).deleteAndCount().catch(() => {});
  for (const id of [ids.charA, ids.charAlt, ids.charB, ids.charC]) {
    await orm.CharacterRaidLockout.where({ characterId: id }).deleteAndCount().catch(() => {});
    await orm.Character.where({ id }).deleteAndCount().catch(() => {});
  }
  for (const id of [ids.lead, ids.userA, ids.userB, ids.userC]) {
    await orm.ActivityEvent.where({ userId: id }).deleteAndCount().catch(() => {});
    await orm.UserNotification.where({ userId: id }).deleteAndCount().catch(() => {});
    await orm.User.where({ id }).deleteAndCount().catch(() => {});
  }
}

/** Venom 6/8 + Tide 1/1 (a Bundle). */
async function contentIds() {
  const rows = (await orm.RunRaidContent.where({ runId: ids.run }).all()) as Array<{ id: string; raidId: string }>;
  return {
    venom: rows.find((row) => row.raidId === VENOMOUS_ABYSS_RAID_ID)!.id,
    tide: rows.find((row) => row.raidId === TIDEBOUND_GROTTO_RAID_ID)?.id ?? null,
  };
}

async function bossIds(raidId: string): Promise<string[]> {
  const rows = (await orm.RaidBoss.where({ raidId }).all()) as Array<{ id: string; sortOrder: number }>;
  return rows.sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.id);
}

let venomBosses: string[] = [];
let tideBosses: string[] = [];

async function venomException(boss: number, role: CharacterRole, play: string | null = null): Promise<RosterBossException> {
  const contents = await contentIds();
  return { slotSignupId: ids.signupA, runRaidContentId: contents.venom, raidBossId: venomBosses[boss - 1]!, playSignupId: play, role };
}

async function version() {
  return (await rosterRepository.findByRunId(ids.run))!.version;
}

async function saveDefault(bossExceptions?: RosterBossException[]) {
  await rosterService.saveDraftSelection(lead, {
    runId: ids.run,
    version: await version(),
    selections: [
      { signupId: ids.signupA, selectedRole: "HEALER" },
      { signupId: ids.signupB, selectedRole: "RANGED_DPS" },
    ],
    bossExceptions,
  });
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  venomBosses = await bossIds(VENOMOUS_ABYSS_RAID_ID);
  tideBosses = await bossIds(TIDEBOUND_GROTTO_RAID_ID);
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
  const now = new Date().toISOString();
  await createUser(ids.lead, "RAID_LEAD");
  await createUser(ids.userA, "USER");
  await createUser(ids.userB, "USER");
  await createCharacter(ids.charA, ids.userA, "Bexsham", "SHAMAN", "Restoration", "HEALER");
  await createCharacter(ids.charAlt, ids.userA, "Bexpriest", "PRIEST", "Holy", "HEALER");
  await createCharacter(ids.charB, ids.userB, "Bexmage", "MAGE", "Fire", "RANGED_DPS");
  await orm.Run.create({
    id: ids.run,
    title: "BEX Run",
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    scheduledStartAt: START,
    status: "OPEN",
    signupsOpen: true,
    desiredTankCount: 0,
    desiredHealerCount: 1,
    desiredDpsCount: 1,
    desiredLootbuddyCount: 0,
    raidLeadId: ids.lead,
    notes: null,
    createdAt: now,
    updatedAt: now,
  });
  await orm.RunRaidContent.create({ id: crypto.randomUUID(), runId: ids.run, raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 6, createdAt: now });
  await orm.RunRaidContent.create({ id: crypto.randomUUID(), runId: ids.run, raidId: TIDEBOUND_GROTTO_RAID_ID, sortOrder: 2, plannedBossCount: 1, createdAt: now });
  await createSignup(ids.signupA, ids.userA, ids.charA, ["HEALER", "RANGED_DPS"]);
  await createSignup(ids.signupAlt, ids.userA, ids.charAlt, ["HEALER"]);
  await createSignup(ids.signupB, ids.userB, ids.charB, ["RANGED_DPS"]);
  await rosterRepository.ensure(ids.run);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await cleanup();
});

describe("boss exceptions — feature switch off (production default)", () => {
  it("a Run without exceptions behaves exactly as before: save, publish, clean, no new warnings", async () => {
    await saveDefault();
    const view = await rosterService.getRosterManagementView(lead, ids.run);
    expect(view.bossPlan).toMatchObject({ enabled: false, draft: [], published: [] });
    expect(view.bossPlan.bosses.map((boss) => boss.raidBossId)).toEqual([...venomBosses.slice(0, 6), tideBosses[0]]);
    expect(view.validation.warnings).toEqual([]);
    await rosterService.publishRoster(lead, { runId: ids.run, version: view.roster.version, acknowledgeWarnings: false });
    const after = await rosterService.getRosterManagementView(lead, ids.run);
    expect(after.roster.hasUnpublishedChanges).toBe(false);
    expect(await orm.RunRosterBossException.where({ rosterId: after.roster.id }).all()).toEqual([]);
  });

  it("refuses boss exception input; an empty set is accepted as 'none'", async () => {
    await expect(saveDefault([await venomException(5, "RANGED_DPS")])).rejects.toMatchObject({ code: "INVALID_ROSTER_SELECTION" });
    await saveDefault([]);
    expect((await rosterRepository.findByRunId(ids.run))!.bossExceptions).toEqual({ draft: [], published: [] });
  });
});

describe("boss exceptions — feature switch on", () => {
  beforeEach(() => {
    vi.stubEnv("ROSTER_BOSS_EXCEPTIONS_ENABLED", "true");
  });

  it("persists a role change and an alternate Character as DRAFT; per-boss warnings show, Bundle bosses named per content", async () => {
    const contents = await contentIds();
    await saveDefault([
      await venomException(5, "RANGED_DPS"),
      await venomException(6, "RANGED_DPS"),
      { slotSignupId: ids.signupA, runRaidContentId: contents.tide!, raidBossId: tideBosses[0]!, playSignupId: ids.signupAlt, role: "HEALER" },
    ]);
    const roster = (await rosterRepository.findByRunId(ids.run))!;
    expect(roster.bossExceptions.published).toEqual([]);
    expect(roster.bossExceptions.draft).toHaveLength(3);
    const view = await rosterService.getRosterManagementView(lead, ids.run);
    expect(view.validation.warnings.map((row) => row.message)).toEqual(
      expect.arrayContaining(["Venom 5–6: 0 of 1 Healer.", "Venom 5–6: 2 of 1 DPS."]),
    );
    expect(view.validation.canPublish).toBe(true);
  });

  it("drops rows that only restate the default", async () => {
    await saveDefault([await venomException(3, "HEALER"), await venomException(4, "HEALER", ids.signupA)]);
    expect((await rosterRepository.findByRunId(ids.run))!.bossExceptions.draft).toEqual([]);
  });

  it("refuses: unplanned boss (6/8 → boss 7), another player's Character, a role not offered", async () => {
    await expect(saveDefault([await venomException(7, "RANGED_DPS")])).rejects.toMatchObject({ code: "INVALID_ROSTER_SELECTION" });
    await expect(saveDefault([await venomException(5, "RANGED_DPS", ids.signupB)])).rejects.toMatchObject({
      code: "INVALID_ROSTER_SELECTION",
    });
    await expect(saveDefault([await venomException(5, "RANGED_DPS", ids.signupAlt)])).rejects.toMatchObject({
      code: "INVALID_ROSTER_SELECTION",
    });
    expect((await rosterRepository.findByRunId(ids.run))!.bossExceptions.draft).toEqual([]);
  });

  it("Publish copies DRAFT → PUBLISHED (warnings need the usual acknowledgement); changes after that are unpublished", async () => {
    await saveDefault([await venomException(6, "RANGED_DPS")]);
    await expect(
      rosterService.publishRoster(lead, { runId: ids.run, version: await version(), acknowledgeWarnings: false }),
    ).rejects.toMatchObject({ code: "ROSTER_VALIDATION_FAILED" });
    await rosterService.publishRoster(lead, { runId: ids.run, version: await version(), acknowledgeWarnings: true });
    let roster = (await rosterRepository.findByRunId(ids.run))!;
    expect(roster.bossExceptions.published).toEqual(roster.bossExceptions.draft);
    expect((await rosterService.getRosterManagementView(lead, ids.run)).roster.hasUnpublishedChanges).toBe(false);

    await saveDefault([await venomException(5, "RANGED_DPS"), await venomException(6, "RANGED_DPS")]);
    expect((await rosterService.getRosterManagementView(lead, ids.run)).roster.hasUnpublishedChanges).toBe(true);

    // Update Roster with an explicit empty plan clears both stages.
    await rosterService.updateRoster(lead, {
      runId: ids.run,
      version: await version(),
      selections: [
        { signupId: ids.signupA, selectedRole: "HEALER" },
        { signupId: ids.signupB, selectedRole: "RANGED_DPS" },
      ],
      acknowledgeWarnings: true,
      bossExceptions: [],
    });
    roster = (await rosterRepository.findByRunId(ids.run))!;
    expect(roster.bossExceptions).toEqual({ draft: [], published: [] });
  });

  it("Edit Published seed copies the PUBLISHED exceptions into the draft", async () => {
    await saveDefault([await venomException(6, "RANGED_DPS")]);
    await rosterService.publishRoster(lead, { runId: ids.run, version: await version(), acknowledgeWarnings: true });
    const roster = (await rosterRepository.findByRunId(ids.run))!;
    // Simulate a legacy published roster whose draft was never seeded.
    await orm.RunRosterEntry.where({ rosterId: roster.id }).deleteAndCount();
    await orm.RunRosterBossException.where({ rosterId: roster.id, stage: "DRAFT" }).deleteAndCount();
    await orm.RunRoster.where({ id: roster.id }).update({ version: 1 });
    await rosterService.preparePublishedRosterForEditing(lead, { runId: ids.run, version: 1 });
    const seeded = (await rosterRepository.findByRunId(ids.run))!;
    expect(seeded.bossExceptions.draft).toEqual(seeded.bossExceptions.published);
    expect(seeded.bossExceptions.draft).toHaveLength(1);
  });

  it("a slot that leaves the draft loses its draft exceptions", async () => {
    await saveDefault([await venomException(6, "RANGED_DPS")]);
    await rosterService.saveDraftSelection(lead, {
      runId: ids.run,
      version: await version(),
      selections: [{ signupId: ids.signupB, selectedRole: "RANGED_DPS" }],
    });
    expect((await rosterRepository.findByRunId(ids.run))!.bossExceptions.draft).toEqual([]);
  });

  it("the alternate Character is reserved for overlapping Runs; withdrawing it removes its exceptions", async () => {
    await saveDefault([await venomException(6, "HEALER", ids.signupAlt)]);
    const conflicts = await queryReservationConflicts(orm, {
      characterIds: [ids.charAlt],
      scheduledStartAt: new Date(new Date(START).getTime() + 60 * 60 * 1000).toISOString(),
      excludeRunId: "dddddddd-dddd-4ddd-8ddd-bexr0000ffff",
    });
    expect(conflicts.map((row) => row.runId)).toEqual([ids.run]);

    await signupService.withdrawSignup(asUser(ids.userA, "USER"), ids.signupAlt);
    expect((await rosterRepository.findByRunId(ids.run))!.bossExceptions.draft).toEqual([]);
    expect(
      await queryReservationConflicts(orm, {
        characterIds: [ids.charAlt],
        scheduledStartAt: START,
        excludeRunId: "dddddddd-dddd-4ddd-8ddd-bexr0000ffff",
      }),
    ).toEqual([]);
  });

  it("an alternate withdrawn after validation (race) is refused inside the write transaction", async () => {
    await saveDefault();
    const roster = (await rosterRepository.findByRunId(ids.run))!;
    // The service validated the plan while the alternate was still PENDING;
    // the withdrawal commits before the draft write (its cleanup found no row).
    await orm.RunSignup.where({ id: ids.signupAlt }).update({ status: "WITHDRAWN" });
    await expect(
      rosterRepository.replaceSelectedSignupIds(
        roster.id,
        roster.version,
        [
          { signupId: ids.signupA, selectedRole: "HEALER" },
          { signupId: ids.signupB, selectedRole: "RANGED_DPS" },
        ],
        { bossExceptions: [await venomException(6, "HEALER", ids.signupAlt)] },
      ),
    ).rejects.toMatchObject({ code: "SIGNUP_WITHDRAWN" });
    const after = (await rosterRepository.findByRunId(ids.run))!;
    expect(after.bossExceptions.draft).toEqual([]);
    expect(after.version).toBe(roster.version);
  });

  it("withdrawing the alternate after Publish drops only the DRAFT rows: Update needed, published plan kept until Update", async () => {
    await saveDefault([await venomException(6, "HEALER", ids.signupAlt)]);
    await rosterService.publishRoster(lead, { runId: ids.run, version: await version(), acknowledgeWarnings: true });
    const before = (await rosterRepository.findByRunId(ids.run))!;
    expect(before.bossExceptions.published).toHaveLength(1);
    // The alternate is part of the plan: Publish does not mark it NOT_SELECTED.
    expect(((await orm.RunSignup.where({ id: ids.signupAlt }).first()) as { status: string }).status).toBe("PENDING");

    await signupService.withdrawSignup(asUser(ids.userA, "USER"), ids.signupAlt);
    let roster = (await rosterRepository.findByRunId(ids.run))!;
    expect(roster.bossExceptions.draft).toEqual([]);
    expect(roster.bossExceptions.published).toEqual(before.bossExceptions.published);
    // The roster was locked and bumped although the alternate held no roster entry.
    expect(roster.version).toBeGreaterThan(before.version);
    expect((await rosterService.getRosterManagementView(lead, ids.run)).roster.hasUnpublishedChanges).toBe(true);

    await rosterService.updateRoster(lead, {
      runId: ids.run,
      version: roster.version,
      selections: [
        { signupId: ids.signupA, selectedRole: "HEALER" },
        { signupId: ids.signupB, selectedRole: "RANGED_DPS" },
      ],
      acknowledgeWarnings: true,
    });
    roster = (await rosterRepository.findByRunId(ids.run))!;
    expect(roster.bossExceptions).toEqual({ draft: [], published: [] });
    expect((await rosterService.getRosterManagementView(lead, ids.run)).roster.hasUnpublishedChanges).toBe(false);
  });

  it("Auto Build Apply / Fill gaps never touch existing picks or their exceptions, nor propose the alternate", async () => {
    await orm.Run.where({ id: ids.run }).update({ desiredHealerCount: 2, desiredDpsCount: 2 });
    await createUser(ids.userC, "USER");
    await createCharacter(ids.charC, ids.userC, "Bexhunter", "HUNTER", "Marksmanship", "RANGED_DPS");
    await createSignup(ids.signupC, ids.userC, ids.charC, ["RANGED_DPS"]);
    await saveDefault([await venomException(5, "HEALER", ids.signupAlt), await venomException(6, "RANGED_DPS")]);
    const before = (await rosterRepository.findByRunId(ids.run))!;

    // Fill gaps on the editor draft: the open Healer slot is not offered to the alternate (same player).
    const fill = await rosterBuilderService.proposeRoster(lead, ids.run, {
      baseSelections: [
        { signupId: ids.signupA, selectedRole: "HEALER" },
        { signupId: ids.signupB, selectedRole: "RANGED_DPS" },
      ],
    });
    expect(fill.applySelections.map((row) => row.signupId)).toEqual([ids.signupC]);

    const proposal = await rosterBuilderService.proposeRoster(lead, ids.run);
    expect(proposal.applySelections).toEqual([{ signupId: ids.signupC, selectedRole: "RANGED_DPS" }]);
    await rosterBuilderService.applyRosterProposal(lead, {
      runId: ids.run,
      expectedVersion: proposal.rosterVersion,
      selections: proposal.applySelections,
    });
    const after = (await rosterRepository.findByRunId(ids.run))!;
    expect(after.selections).toEqual(
      expect.arrayContaining([
        { signupId: ids.signupA, selectedRole: "HEALER" },
        { signupId: ids.signupB, selectedRole: "RANGED_DPS" },
        { signupId: ids.signupC, selectedRole: "RANGED_DPS" },
      ]),
    );
    expect(after.bossExceptions.draft).toEqual(before.bossExceptions.draft);
  });

  it("Edit Run: fewer planned bosses keep still-planned exceptions; a removed raid drops its own", async () => {
    const contents = await contentIds();
    await saveDefault([
      await venomException(3, "RANGED_DPS"),
      await venomException(5, "RANGED_DPS"),
      { slotSignupId: ids.signupA, runRaidContentId: contents.tide!, raidBossId: tideBosses[0]!, playSignupId: null, role: "RANGED_DPS" },
    ]);
    await runRepository.updatePreStartAtomic(ids.run, {}, { contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 4 }] });
    const after = await contentIds();
    expect(after.tide).toBeNull();
    const draft = (await rosterRepository.findByRunId(ids.run))!.bossExceptions.draft;
    expect(draft).toEqual([
      { slotSignupId: ids.signupA, runRaidContentId: after.venom, raidBossId: venomBosses[2], playSignupId: null, role: "RANGED_DPS" },
    ]);
    expect(after.venom).not.toBe(contents.venom);
  });

  it("Start Run is refused while boss exceptions are unpublished, like any other roster change", async () => {
    await saveDefault([await venomException(6, "RANGED_DPS")]);
    await rosterService.publishRoster(lead, { runId: ids.run, version: await version(), acknowledgeWarnings: true });
    await saveDefault([await venomException(5, "RANGED_DPS")]);
    await expect(runService.startRun(lead, { runId: ids.run })).rejects.toMatchObject({ code: "ROSTER_UNPUBLISHED_CHANGES" });
  });

  it("boss-exact lockout warning: the alternate Character already killed that boss this reset", async () => {
    await orm.CharacterRaidLockout.create({
      id: crypto.randomUUID(),
      characterId: ids.charAlt,
      raidId: VENOMOUS_ABYSS_RAID_ID,
      difficulty: "HEROIC",
      resetIdentifier: lockoutService.getResetIdentifierForRun("EU", START),
      bossesDefeated: 1,
      isComplete: false,
      killedBossIds: JSON.stringify([venomBosses[5]]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await saveDefault([await venomException(5, "HEALER", ids.signupAlt), await venomException(6, "HEALER", ids.signupAlt)]);
    const view = await rosterService.getRosterManagementView(lead, ids.run);
    expect(view.validation.warnings.map((row) => row.message)).toEqual(["Venom 6: Bexpriest-Antonidas is already saved."]);
  });
});

/**
 * Roster Builder flows (PR B): the client helpers build the payload and the
 * live warnings from the very view the Roster tab renders; the server must
 * accept, store and judge them the same way.
 */
describe("boss plan — Roster Builder flows (feature switch on)", () => {
  beforeEach(() => {
    vi.stubEnv("ROSTER_BOSS_EXCEPTIONS_ENABLED", "true");
  });

  type View = Awaited<ReturnType<typeof rosterService.getRosterManagementView>>;
  const view = () => rosterService.getRosterManagementView(lead, ids.run);
  const editorSignups = (data: View) => data.boosters.concat(data.groups.lootbuddies);
  const stagedOf = (data: View) =>
    new Map(editorSignups(data).filter((signup) => signup.draftSelected).map((signup) => [signup.id, signup.selectedRole]));
  const payloadOf = (data: View, exceptions: RosterBossException[]) =>
    bossExceptionsPayload({ exceptions, staged: stagedOf(data), signups: editorSignups(data), bosses: data.bossPlan.bosses });
  const liveOf = (data: View, payload: RosterBossException[]) =>
    evaluateLiveBossPlan({
      bosses: data.bossPlan.bosses,
      payload,
      staged: stagedOf(data),
      signups: editorSignups(data),
      externalRoles: [],
      targets: { tanks: data.run.desiredTankCount, healers: data.run.desiredHealerCount, dps: data.run.desiredDpsCount },
      lootType: data.run.lootType,
    });
  const bossWarnings = (data: View) =>
    data.validation.warnings.filter((row) => row.code.startsWith("BOSS_")).map((row) => row.message);
  const selections = [
    { signupId: ids.signupA, selectedRole: "HEALER" as const },
    { signupId: ids.signupB, selectedRole: "RANGED_DPS" as const },
  ];
  const save = async (data: View, bossExceptions?: RosterBossException[]) =>
    rosterService.saveDraftSelection(lead, { runId: ids.run, version: data.roster.version, selections, bossExceptions });

  it("Boss 1–6 on the alternate Character (Bundle: Tide stays default): saved as staged, described per content, warnings match the server", async () => {
    await orm.CharacterRaidLockout.create({
      id: crypto.randomUUID(),
      characterId: ids.charAlt,
      raidId: VENOMOUS_ABYSS_RAID_ID,
      difficulty: "HEROIC",
      resetIdentifier: lockoutService.getResetIdentifierForRun("EU", START),
      bossesDefeated: 1,
      isComplete: false,
      killedBossIds: JSON.stringify([venomBosses[1]]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await saveDefault();
    let data = await view();
    const bosses = data.bossPlan.bosses;
    expect(bosses).toHaveLength(7);
    const range = bossesInRange(bosses, nextBossRange(nextBossRange(null, bosses[0]!.key), bosses[5]!.key));
    const slot = data.boosters.find((signup) => signup.id === ids.signupA)!;
    const choices = slotCharacterChoices(slot, editorSignups(data), new Set(stagedOf(data).keys()));
    expect(choices.map((choice) => choice.playSignupId)).toEqual([null, ids.signupAlt]);
    const payload = payloadOf(
      data,
      applyRangeAssignment({
        exceptions: [],
        slotSignupId: ids.signupA,
        slotRole: "HEALER",
        range,
        assignment: { playSignupId: ids.signupAlt, role: "HEALER" },
      }),
    );
    const live = liveOf(data, payload);

    await save(data, payload);
    data = await view();
    expect(data.bossPlan.draft).toEqual(payload);
    expect(bossPlanIsDirty(payloadOf(data, data.bossPlan.draft), data.bossPlan.draft)).toBe(false);
    expect(
      describeSlotBossPlan({
        exceptions: data.bossPlan.draft,
        bosses: data.bossPlan.bosses,
        characterLabelBySignupId: new Map([[ids.signupAlt, "Bexpriest-Antonidas"]]),
      }),
    ).toBe("Venom 1–6: Bexpriest-Antonidas · Healer");
    expect(live.warnings.map((warning) => warning.message)).toEqual(["Venom 2: Bexpriest-Antonidas is already saved."]);
    expect(bossWarnings(data)).toEqual(live.warnings.map((warning) => warning.message));
  });

  it("role switch on one boss: the per-boss Healer warning shows live and on the server; Save is not blocked", async () => {
    await saveDefault();
    let data = await view();
    const payload = payloadOf(
      data,
      applyRangeAssignment({
        exceptions: [],
        slotSignupId: ids.signupA,
        slotRole: "HEALER",
        range: [data.bossPlan.bosses[2]!],
        assignment: { playSignupId: null, role: "RANGED_DPS" },
      }),
    );
    const expected = ["Venom 3: 0 of 1 Healer.", "Venom 3: 2 of 1 DPS."];
    expect(liveOf(data, payload).warnings.map((warning) => warning.message)).toEqual(expected);
    await save(data, payload);
    data = await view();
    expect(bossWarnings(data)).toEqual(expected);
    expect(data.validation.canPublish).toBe(true);
  });

  it("reset: Save without the field keeps the plan; Save with the slot reset clears it", async () => {
    await saveDefault([await venomException(5, "RANGED_DPS")]);
    let data = await view();
    await save(data);
    data = await view();
    expect(data.bossPlan.draft).toHaveLength(1);
    await save(data, payloadOf(data, resetSlotBosses(data.bossPlan.draft, ids.signupA)));
    data = await view();
    expect(data.bossPlan.draft).toEqual([]);
  });

  it("Publish → change → Update: the diff shows the boss plan change, Update accepts the staged set, nothing unpublished afterwards", async () => {
    await saveDefault([await venomException(6, "HEALER", ids.signupAlt)]);
    await rosterService.publishRoster(lead, { runId: ids.run, version: await version(), acknowledgeWarnings: true });
    let data = await view();
    expect(data.roster.hasUnpublishedChanges).toBe(false);
    const bosses = data.bossPlan.bosses;
    const payload = payloadOf(
      data,
      applyRangeAssignment({
        exceptions: data.bossPlan.draft,
        slotSignupId: ids.signupA,
        slotRole: "HEALER",
        range: bosses.slice(4, 6),
        assignment: { playSignupId: ids.signupAlt, role: "HEALER" },
      }),
    );
    const member = {
      signupId: ids.signupA,
      userId: ids.userA,
      participationType: "BOOSTER" as const,
      role: "HEALER" as const,
      label: "Bexsham-Antonidas",
    };
    expect(
      diffBossPlans({
        published: data.bossPlan.published,
        draft: payload,
        members: new Map([[ids.signupA, member]]),
        publishedSlotIds: new Set([ids.signupA, ids.signupB]),
        bosses,
        characterLabelBySignupId: new Map([[ids.signupAlt, "Bexpriest-Antonidas"]]),
      }),
    ).toEqual([
      {
        kind: "BOSS_PLAN_CHANGED",
        member,
        before: "Venom 6: Bexpriest-Antonidas · Healer",
        after: "Venom 5–6: Bexpriest-Antonidas · Healer",
      },
    ]);
    await rosterService.updateRoster(lead, {
      runId: ids.run,
      version: data.roster.version,
      selections,
      acknowledgeWarnings: true,
      bossExceptions: payload,
    });
    data = await view();
    expect(data.bossPlan.published).toEqual(payload);
    expect(data.bossPlan.draft).toEqual(payload);
    expect(data.roster.hasUnpublishedChanges).toBe(false);
  });

  it("stale editor: a second Save on the old version is ROSTER_ALREADY_CHANGED and keeps the first plan", async () => {
    await saveDefault();
    const stale = await view();
    await save(stale, [await venomException(5, "RANGED_DPS")]);
    await expect(save(stale, [await venomException(6, "RANGED_DPS")])).rejects.toMatchObject({ code: "ROSTER_ALREADY_CHANGED" });
    expect((await view()).bossPlan.draft.map((row) => row.raidBossId)).toEqual([venomBosses[4]]);
  });

  it("alternate withdrawn while the editor was open: Save refuses with a named message; after Refresh the payload no longer carries it", async () => {
    await saveDefault();
    const open = await view();
    await signupService.withdrawSignup(asUser(ids.userA, "USER"), ids.signupAlt);
    const fresh = await view();
    await expect(save(fresh, [await venomException(6, "HEALER", ids.signupAlt)])).rejects.toMatchObject({
      code: "INVALID_ROSTER_SELECTION",
      message: expect.stringContaining("was withdrawn"),
    });
    expect(open.boosters.some((signup) => signup.id === ids.signupAlt)).toBe(true);
    expect(fresh.boosters.some((signup) => signup.id === ids.signupAlt)).toBe(false);
    expect(payloadOf(fresh, [await venomException(6, "HEALER", ids.signupAlt)])).toEqual([]);
  });

  it("Edit Run that re-binds exceptions bumps the roster version, so the open editor refreshes instead of sending old content ids", async () => {
    await saveDefault([await venomException(3, "RANGED_DPS")]);
    const open = await view();
    await runRepository.updatePreStartAtomic(ids.run, {}, {
      contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 6 }],
    });
    const after = await view();
    expect(after.roster.version).toBe(open.roster.version + 1);
    expect(after.bossPlan.draft).toHaveLength(1);
    expect(after.bossPlan.draft[0]!.runRaidContentId).not.toBe(open.bossPlan.draft[0]!.runRaidContentId);
    await expect(save(open, open.bossPlan.draft)).rejects.toMatchObject({ code: "ROSTER_ALREADY_CHANGED" });
    await save(after, after.bossPlan.draft);
    expect((await view()).bossPlan.draft).toEqual(after.bossPlan.draft);
  });

  it("Edit Run without boss exceptions leaves the roster version alone", async () => {
    await saveDefault();
    const before = await version();
    await runRepository.updatePreStartAtomic(ids.run, {}, {
      contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 5 }],
    });
    expect(await version()).toBe(before);
  });
});

/**
 * PR C — Discord, DMs, Start, consumables audit, replacements and the
 * feature-switch rollback, on the same fixture (Venom 6/8 + Tide 1/1 Bundle;
 * userA: Bexsham slot + Bexpriest alternate; userB: Bexmage).
 */
describe("boss plan — Discord, DMs, Start, audit, replacement, rollback", () => {
  beforeEach(() => {
    vi.stubEnv("ROSTER_BOSS_EXCEPTIONS_ENABLED", "true");
  });

  const selections = [
    { signupId: ids.signupA, selectedRole: "HEALER" as const },
    { signupId: ids.signupB, selectedRole: "RANGED_DPS" as const },
  ];
  async function altOn(...bosses: number[]) {
    return Promise.all(bosses.map((boss) => venomException(boss, "HEALER", ids.signupAlt)));
  }
  async function tideDps(): Promise<RosterBossException> {
    const contents = await contentIds();
    return { slotSignupId: ids.signupA, runRaidContentId: contents.tide!, raidBossId: tideBosses[0]!, playSignupId: null, role: "RANGED_DPS" };
  }
  async function publish() {
    await rosterService.publishRoster(lead, { runId: ids.run, version: await version(), acknowledgeWarnings: true });
  }
  async function update(bossExceptions?: RosterBossException[]) {
    await rosterService.updateRoster(lead, {
      runId: ids.run,
      version: await version(),
      selections,
      acknowledgeWarnings: true,
      bossExceptions,
    });
  }
  const bossPlanRows = async () =>
    ((await orm.UserNotification.where({ runId: ids.run, type: "ROSTER_SELECTED" }).all()) as Array<{
      signupId: string;
      sourceKey: string;
      message: string;
    }>).filter((row) => row.sourceKey.startsWith("roster-boss-plan:"));

  it("Discord Roster message: draft plan before Publish, published plan after; grouped ranges, Bundle content names", async () => {
    await saveDefault([...(await altOn(5, 6)), await tideDps()]);
    const draft = (await discordSyncService.getRosterEmbedData(ids.run))!;
    expect(draft.publishedAt).toBeNull();
    expect(draft.bossPlan!.map((line) => [line.member.characterName, line.plan])).toEqual([
      ["Bexsham", "Venom 5–6: Bexpriest-Antonidas · Healer; Tide 1: Ranged DPS"],
    ]);
    await publish();
    const published = (await discordSyncService.getRosterEmbedData(ids.run))!;
    expect(published.bossPlan).toEqual(draft.bossPlan);
    const embed = buildRosterEmbed(published).toJSON();
    expect(embed.fields!.find((field) => field.name === "📋 Boss plan")!.value).toBe(
      "Bexsham-Antonidas — Venom 5–6: Bexpriest-Antonidas · Healer; Tide 1: Ranged DPS",
    );
    expect(rosterBossPlanRenderKey((await runRepository.findById(ids.run))!)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("a Run without exceptions: no Boss plan anywhere, render key empty, no boss plan notices", async () => {
    await saveDefault();
    await publish();
    const data = (await discordSyncService.getRosterEmbedData(ids.run))!;
    expect(data.bossPlan).toEqual([]);
    expect(JSON.stringify(buildRosterEmbed(data).toJSON())).not.toContain("Boss plan");
    expect(rosterBossPlanRenderKey((await runRepository.findById(ids.run))!)).toBe("");
    expect(await bossPlanRows()).toEqual([]);
  });

  it("DMs: only the player whose published plan changed hears Boss Plan Update, once per change, never when unchanged", async () => {
    await saveDefault();
    await publish();
    expect(await bossPlanRows()).toEqual([]);

    await update(await altOn(5, 6));
    let rows = await bossPlanRows();
    expect(rows.map((row) => row.signupId)).toEqual([ids.signupA]);
    expect(rows[0]!.message).toBe("Your boss assignments for BEX Run changed: Venom 5–6: Bexpriest-Antonidas · Healer.");

    await update(await altOn(5, 6)); // same plan again: nobody is told
    expect(await bossPlanRows()).toHaveLength(1);

    await update([]); // back to the default roster
    rows = await bossPlanRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.message)).toContain("You now play every boss of BEX Run as rostered.");
    // The Bexmage slot never changed, so its player is never told.
    expect(rows.every((row) => row.signupId === ids.signupA)).toBe(true);
  });

  it("DMs: a player newly selected together with a plan gets the selected notice only (no extra Boss Plan Update)", async () => {
    await rosterService.saveDraftSelection(lead, {
      runId: ids.run,
      version: await version(),
      selections: [{ signupId: ids.signupB, selectedRole: "RANGED_DPS" }],
    });
    await publish();
    await update(await altOn(5));
    expect(await bossPlanRows()).toEqual([]);
    const selected = (await orm.UserNotification.where({
      runId: ids.run,
      signupId: ids.signupA,
      type: "ROSTER_SELECTED",
    }).all()) as Array<{ sourceKey: string }>;
    expect(selected.map((row) => row.sourceKey.split(":")[0])).toEqual(["roster-selected"]);
  });

  it("Start checks: an alternate that became inactive after Publish shows as a Boss plan item in the preflight", async () => {
    await saveDefault(await altOn(5, 6));
    await publish();
    await orm.Character.where({ id: ids.charAlt }).update({ isActive: false });
    const preflight = await runPreflightService.evaluate(lead, ids.run);
    const bossPlan = preflight.checks.filter((check) => check.label === "Boss plan");
    // One item per affected boss (Venom 5 and 6), each naming the alternate and why.
    expect(bossPlan).toHaveLength(2);
    expect(bossPlan.every((check) => check.summary.includes("Bexpriest-Antonidas is inactive"))).toBe(true);
    expect(preflight.overall).not.toBe("READY");
  });

  it("Final Setup, audit participants and replacement after Start: the replaced slot's published plan leaves with it", async () => {
    await createUser(ids.userC, "USER");
    await createCharacter(ids.charC, ids.userC, "Bexhunter", "HUNTER", "Marksmanship", "RANGED_DPS");
    await createSignup(ids.signupC, ids.userC, ids.charC, ["HEALER", "RANGED_DPS"]);
    await saveDefault(await altOn(5, 6));
    await publish();
    await runService.startRun(lead, { runId: ids.run });

    const start = (await discordSyncService.getRunStartEmbedData(ids.run))!;
    expect(start.bossPlan).toEqual([{ discordUserId: null, userName: ids.userA, plan: "Venom 5–6: Bexpriest-Antonidas · Healer" }]);
    expect(renderRunStartMessageText(start)).toContain(`📋 **Boss plan**\n@${ids.userA} · Venom 5–6: Bexpriest-Antonidas · Healer`);

    const venom = (await contentIds()).venom;
    // The audit covers attended players only.
    await orm.RunAttendance.where({ runId: ids.run }).updateAll({ status: "PRESENT" });
    const participants = await runConsumableAuditRepository.listParticipants(ids.run);
    const sham = participants.find((row) => row.source === "ATTENDANCE" && row.characterName === "Bexsham");
    expect(sham?.source === "ATTENDANCE" ? sham.bossCharacters : null).toEqual([
      {
        characterName: "Bexpriest",
        characterRealm: "Antonidas",
        characterRegion: "EU",
        warcraftLogsId: null,
        bosses: [
          { raidContentId: venom, wclEncounterIds: expect.any(Array) },
          { raidContentId: venom, wclEncounterIds: expect.any(Array) },
        ],
      },
    ]);
    const mage = participants.find((row) => row.source === "ATTENDANCE" && row.characterName === "Bexmage");
    expect(mage?.source === "ATTENDANCE" ? mage.bossCharacters : "missing").toBeUndefined();

    const shamRow = (await attendanceRepository.listByRunId(ids.run)).find((row) => row.signupId === ids.signupA)!;
    await attendanceService.replaceParticipant(lead, {
      attendanceId: shamRow.id,
      replacement: { kind: "signup", signupId: ids.signupC },
    });

    expect((await rosterRepository.findByRunId(ids.run))!.bossExceptions).toEqual({ draft: [], published: [] });
    const after = (await discordSyncService.getRunStartEmbedData(ids.run))!;
    expect(after.bossPlan).toEqual([]);
    expect(renderRunStartMessageText(after)).not.toContain("Boss plan");
    expect((await discordSyncService.getRosterEmbedData(ids.run))!.bossPlan).toEqual([]);
    const afterParticipants = await runConsumableAuditRepository.listParticipants(ids.run);
    expect(afterParticipants.some((row) => row.source === "ATTENDANCE" && (row.bossCharacters?.length ?? 0) > 0)).toBe(false);
  });

  it("rollback: switching the feature off with stored exceptions makes them inert everywhere; on again restores them", async () => {
    await saveDefault(await altOn(5, 6));
    await publish();
    await saveDefault(await altOn(6)); // an unpublished plan change
    const stored = (await rosterRepository.findByRunId(ids.run))!.bossExceptions;
    expect(stored.published).toHaveLength(2);
    expect(stored.draft).toHaveLength(1);

    vi.stubEnv("ROSTER_BOSS_EXCEPTIONS_ENABLED", "false");
    const view = await rosterService.getRosterManagementView(lead, ids.run);
    expect(view.bossPlan).toMatchObject({ enabled: false, draft: [], published: [] });
    expect(view.roster.hasUnpublishedChanges).toBe(false);
    expect(view.validation.warnings.filter((row) => row.code.startsWith("BOSS_"))).toEqual([]);
    expect((await discordSyncService.getRosterEmbedData(ids.run))!.bossPlan).toEqual([]);
    expect(rosterBossPlanRenderKey((await runRepository.findById(ids.run))!)).toBe("");
    // The alternate is no longer reserved by this Run.
    expect(
      await queryReservationConflicts(orm, {
        characterIds: [ids.charAlt],
        scheduledStartAt: START,
        excludeRunId: "dddddddd-dddd-4ddd-8ddd-bexr0000ffff",
      }),
    ).toEqual([]);
    // Normal roster actions keep working: Update (no boss input, no new boss plan notice) and Start.
    const noticesBefore = (await bossPlanRows()).length;
    await update();
    expect(await bossPlanRows()).toHaveLength(noticesBefore);
    await runService.startRun(lead, { runId: ids.run });
    expect((await discordSyncService.getRunStartEmbedData(ids.run))!.bossPlan).toEqual([]);
    // Rows stay stored — switching back on shows them again.
    expect((await rosterRepository.findByRunId(ids.run))!.bossExceptions.published.length).toBeGreaterThan(0);
    vi.stubEnv("ROSTER_BOSS_EXCEPTIONS_ENABLED", "true");
    expect((await discordSyncService.getRunStartEmbedData(ids.run))!.bossPlan!.length).toBeGreaterThan(0);
  });
});
