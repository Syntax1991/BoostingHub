import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import type { RosterBossException } from "@/lib/roster-boss-plan";
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
