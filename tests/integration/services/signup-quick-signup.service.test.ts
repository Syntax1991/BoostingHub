import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@tests/fixtures/test-run-input";
import { lockoutService } from "@/services/lockout.service";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import {
  formatQuickSignupBoostersMessage,
  signupService,
} from "@/services/signup.service";
import { testActor } from "@tests/fixtures/actors";
import {
  assertIsolatedTestDatabase,
  createTestCharacter,
  createTestUser,
  deleteCreatedRows,
} from "@tests/fixtures/db-fixtures";
import { freezeSystemTime, RAID_WEEK_TEST_CLOCK, restoreSystemTime } from "@tests/fixtures/time";
import { expectDomainError } from "@tests/helpers/domain-error";

const created = { runIds: [] as string[], characterIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;
let target: AuthenticatedUser;
let otherLead: AuthenticatedUser;

async function createUser(name: string, accountRole: AuthenticatedUser["accountRole"], isBooster = false) {
  const id = await createTestUser({ name, accountRole, isBooster });
  created.userIds.push(id);
  return testActor(id, accountRole, { name });
}

async function createCharacter(
  userId: string,
  name: string,
  options: {
    wowClass?: "HUNTER" | "PALADIN" | "MAGE" | "DRUID" | "PRIEST";
    specialization?: string | null;
    primaryRole?: "TANK" | "HEALER" | "MELEE_DPS" | "RANGED_DPS";
    isActive?: boolean;
  } = {},
) {
  const wowClass = options.wowClass ?? "HUNTER";
  const id = await createTestCharacter({
    userId,
    name,
    realm: "Quick Lab",
    wowClass,
    specialization: options.specialization === undefined ? "Beast Mastery" : options.specialization,
    primaryRole: options.primaryRole ?? (wowClass === "PALADIN" ? "HEALER" : "RANGED_DPS"),
    isActive: options.isActive ?? true,
  });
  created.characterIds.push(id);
  return id;
}

function futureIso(days = 12) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function activeBoosters(runId: string, userId: string) {
  const rows = await signupRepository.listByRunAndUser(runId, userId);
  return rows.filter((row) => row.participationType === "BOOSTER" && row.status !== "WITHDRAWN");
}

/** Clear draft roster picks then withdraw Booster offers so reservation state cannot leak across cases. */
async function clearBoosterOffers(actor: AuthenticatedUser, leadActor: AuthenticatedUser, runId: string) {
  try {
    const view = await rosterService.getRosterManagementView(leadActor, runId);
    await rosterService.saveDraftSelection(leadActor, {
      runId,
      version: view.roster.version,
      selections: [],
    });
  } catch {
    // Run may lack a roster yet.
  }
  const rows = await signupRepository.listByRunAndUser(runId, actor.id);
  for (const row of rows) {
    if (row.participationType !== "BOOSTER" || row.status === "WITHDRAWN") continue;
    if (row.status === "SELECTED") {
      await orm.RunSignup.where({ id: row.id }).update({ status: "PENDING", publishedRole: null });
    }
  }
  await signupService.setCharacterOffers(actor, { runId, offers: [] });
}

let hunterA = "";
let hunterB = "";
let hunterC = "";
let holyPaladin = "";
let noSpecMage = "";
let unavailableHunter = "";
let mainRunId = "";
let communityRunId = "";
let mythicRunId = "";

beforeAll(() => freezeSystemTime(RAID_WEEK_TEST_CLOCK, { advance: true }));
afterAll(() => restoreSystemTime());

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  lead = await createUser("QS Lead", "RAID_LEAD");
  target = await createUser("QS Target", "USER", true);
  otherLead = await createUser("QS Other Lead", "RAID_LEAD");

  hunterA = await createCharacter(target.id, "Qshuntera");
  hunterB = await createCharacter(target.id, "Qshunterb");
  hunterC = await createCharacter(target.id, "Qshunterc");
  holyPaladin = await createCharacter(target.id, "Qsholypala", {
    wowClass: "PALADIN",
    specialization: "Holy",
    primaryRole: "HEALER",
  });
  await orm.CharacterPlayableSpec.create({
    id: crypto.randomUUID(),
    characterId: holyPaladin,
    specialization: "Retribution",
    createdAt: new Date().toISOString(),
  });
  noSpecMage = await createCharacter(target.id, "Qsnospec", {
    wowClass: "MAGE",
    specialization: null,
    primaryRole: "RANGED_DPS",
  });
  unavailableHunter = await createCharacter(target.id, "Qsunavail");

  mainRunId = (
    await runService.createRun(
      lead,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        venomousPlannedBossCount: 8,
        scheduledStartAt: futureIso(),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
    )
  ).id;
  created.runIds.push(mainRunId);
  await runService.openRun(lead, mainRunId);

  communityRunId = (
    await runService.createRun(
      lead,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "COMMUNITY",
        venomousPlannedBossCount: 8,
        scheduledStartAt: futureIso(13),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
    )
  ).id;
  created.runIds.push(communityRunId);
  await runService.openRun(lead, communityRunId);

  mythicRunId = (
    await runService.createRun(
      lead,
      venomousCreateInput({
        difficulty: "MYTHIC",
        lootType: "VIP",
        venomousPlannedBossCount: 8,
        scheduledStartAt: futureIso(14),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
    )
  ).id;
  created.runIds.push(mythicRunId);
  await runService.openRun(lead, mythicRunId);
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await orm.CharacterWeeklyUnavailability.where((row) => row.characterId.in(created.characterIds)).deleteAndCount();
  await orm.CharacterRaidLockout.where((row) => row.characterId.in(created.characterIds)).deleteAndCount();
  await deleteCreatedRows(created);
}, 60_000);

describe("formatQuickSignupBoostersMessage", () => {
  const base = {
    runId: "r",
    alreadySigned: 0,
    skippedNoDefaultRole: 0,
    skippedUnavailable: 0,
    skippedReservationConflict: 0,
    skippedInactive: 0,
    skippedIneligible: 0,
  };

  it("covers added / already signed / detailed skip copy", () => {
    expect(formatQuickSignupBoostersMessage({ ...base, added: 8 })).toBe(
      "Signed up with 8 characters offered.",
    );
    expect(
      formatQuickSignupBoostersMessage({
        ...base,
        added: 8,
        skippedUnavailable: 2,
        skippedReservationConflict: 1,
        skippedNoDefaultRole: 1,
        skippedIneligible: 3,
      }),
    ).toBe(
      "Signed up with 8 characters offered. 2 unavailable · 1 scheduling conflict · 1 missing default role skipped",
    );
    expect(
      formatQuickSignupBoostersMessage({
        ...base,
        added: 0,
        alreadySigned: 3,
        skippedIneligible: 1,
        skippedUnavailable: 1,
      }),
    ).toBe("All eligible characters are already signed up. 1 unavailable skipped");
    expect(
      formatQuickSignupBoostersMessage({
        ...base,
        added: 0,
        skippedNoDefaultRole: 2,
      }),
    ).toBe("No characters were added. 2 missing default roles skipped");
  });
});

describe("signupService.quickSignupBoosters", () => {
  it("A. adds every eligible Character with a defaultRole", async () => {
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    const result = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(result.added).toBeGreaterThanOrEqual(3);
    const active = await activeBoosters(mainRunId, target.id);
    const byId = new Map(active.map((row) => [row.character!.id, row.offeredRoles]));
    expect(byId.get(hunterA)).toEqual(["RANGED_DPS"]);
    expect(byId.get(hunterB)).toEqual(["RANGED_DPS"]);
    expect(byId.get(holyPaladin)).toEqual(["HEALER"]);
  });

  it("B/C. preserves existing offeredRoles and only adds missing Characters", async () => {
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: holyPaladin, offeredRoles: ["HEALER", "MELEE_DPS"] }],
    });
    const result = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(result.added).toBeGreaterThanOrEqual(1);
    expect(result.alreadySigned).toBeGreaterThanOrEqual(1);
    const active = await activeBoosters(mainRunId, target.id);
    const pala = active.find((row) => row.character?.id === holyPaladin);
    expect(pala?.offeredRoles.sort()).toEqual(["HEALER", "MELEE_DPS"]);
    expect(active.some((row) => row.character?.id === hunterA)).toBe(true);
  });

  it("D. is idempotent — second click adds 0 and withdraws 0", async () => {
    const first = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    const before = await activeBoosters(mainRunId, target.id);
    const second = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(second.added).toBe(0);
    const after = await activeBoosters(mainRunId, target.id);
    expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());
    expect(first.added + second.alreadySigned).toBeGreaterThanOrEqual(second.alreadySigned);
  });

  it("E. skips Characters with null defaultRole", async () => {
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    const result = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(result.skippedNoDefaultRole).toBeGreaterThanOrEqual(1);
    const active = await activeBoosters(mainRunId, target.id);
    expect(active.some((row) => row.character?.id === noSpecMage)).toBe(false);
  });

  it("F. skips weekly unavailable Characters", async () => {
    const run = await runRepository.findById(mainRunId);
    const resetIdentifier = lockoutService.getResetIdentifierForRun("EU", run!.scheduledStartAt);
    await orm.CharacterWeeklyUnavailability.where({ characterId: unavailableHunter }).deleteAndCount();
    await orm.CharacterWeeklyUnavailability.create({
      id: crypto.randomUUID(),
      characterId: unavailableHunter,
      resetIdentifier,
      difficulty: "HEROIC",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    const result = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(result.skippedUnavailable).toBeGreaterThanOrEqual(1);
    expect(result.skippedIneligible).toBeGreaterThanOrEqual(result.skippedUnavailable);
    const active = await activeBoosters(mainRunId, target.id);
    expect(active.some((row) => row.character?.id === unavailableHunter)).toBe(false);
    await orm.CharacterWeeklyUnavailability.where({ characterId: unavailableHunter }).deleteAndCount();
  });

  it("G. skips Characters reserved on a colliding Run", async () => {
    const collide = await runService.createRun(
      otherLead,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        venomousPlannedBossCount: 8,
        scheduledStartAt: (await runRepository.findById(mainRunId))!.scheduledStartAt,
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 2,
      }),
    );
    created.runIds.push(collide.id);
    await runService.openRun(otherLead, collide.id);
    await signupService.setCharacterOffers(target, {
      runId: collide.id,
      offers: [{ characterId: hunterC, offeredRoles: ["RANGED_DPS"] }],
    });
    const collideRows = await activeBoosters(collide.id, target.id);
    const collideSignup = collideRows.find((row) => row.character?.id === hunterC)!;
    const view = await rosterService.getRosterManagementView(otherLead, collide.id);
    await rosterService.saveDraftSelection(otherLead, {
      runId: collide.id,
      version: view.roster.version,
      selections: [{ signupId: collideSignup.id, selectedRole: "RANGED_DPS" }],
    });

    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    const result = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(result.skippedReservationConflict).toBeGreaterThanOrEqual(1);
    expect(result.skippedIneligible).toBeGreaterThanOrEqual(result.skippedReservationConflict);
    const active = await activeBoosters(mainRunId, target.id);
    expect(active.some((row) => row.character?.id === hunterC)).toBe(false);

    await clearBoosterOffers(target, otherLead, collide.id);
  });

  it("H. still adds a Character with saved lockout progress (informational only)", async () => {
    const run = await runRepository.findById(mainRunId);
    const raidId = run!.contents[0]!.raidId;
    const resetIdentifier = lockoutService.getResetIdentifierForRun("EU", run!.scheduledStartAt);
    await orm.CharacterRaidLockout.where({ characterId: hunterA }).deleteAndCount();
    await orm.CharacterRaidLockout.create({
      id: crypto.randomUUID(),
      characterId: hunterA,
      raidId,
      difficulty: "HEROIC",
      resetIdentifier,
      bossesDefeated: 8,
      isComplete: true,
      killedBossIds: JSON.stringify([]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    const result = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(result.added).toBeGreaterThanOrEqual(1);
    const active = await activeBoosters(mainRunId, target.id);
    expect(active.some((row) => row.character?.id === hunterA)).toBe(true);
    await orm.CharacterRaidLockout.where({ characterId: hunterA }).deleteAndCount();
  });

  it("I/J. preserves draft-selected and SELECTED existing offers without mutating roles", async () => {
    const protectedRunId = await runService
      .createRun(
        lead,
        venomousCreateInput({
          difficulty: "HEROIC",
          lootType: "VIP",
          venomousPlannedBossCount: 8,
          scheduledStartAt: futureIso(15),
          desiredTankCount: 2,
          desiredHealerCount: 4,
          desiredDpsCount: 14,
        }),
      )
      .then((run) => run.id);
    created.runIds.push(protectedRunId);
    await runService.openRun(lead, protectedRunId);

    await signupService.setCharacterOffers(target, {
      runId: protectedRunId,
      offers: [{ characterId: holyPaladin, offeredRoles: ["HEALER", "MELEE_DPS"] }],
    });
    const rows = await activeBoosters(protectedRunId, target.id);
    const palaSignup = rows.find((row) => row.character?.id === holyPaladin)!;
    const view = await rosterService.getRosterManagementView(lead, protectedRunId);
    await rosterService.saveDraftSelection(lead, {
      runId: protectedRunId,
      version: view.roster.version,
      selections: [{ signupId: palaSignup.id, selectedRole: "HEALER" }],
    });

    const draftResult = await signupService.quickSignupBoosters(target, { runId: protectedRunId });
    expect(draftResult.alreadySigned).toBeGreaterThanOrEqual(1);
    const afterDraft = await activeBoosters(protectedRunId, target.id);
    const palaDraft = afterDraft.find((row) => row.character?.id === holyPaladin)!;
    expect(palaDraft.offeredRoles.sort()).toEqual(["HEALER", "MELEE_DPS"]);
    expect(palaDraft.id).toBe(palaSignup.id);

    // SELECTED preservation: mutate the row to SELECTED without closing the signup
    // window so Quick Signup can still run (publish would close the window).
    await orm.RunSignup.where({ id: palaSignup.id }).update({ status: "SELECTED" });
    const selectedResult = await signupService.quickSignupBoosters(target, { runId: protectedRunId });
    expect(selectedResult.alreadySigned).toBeGreaterThanOrEqual(1);
    const still = await activeBoosters(protectedRunId, target.id);
    expect(still.find((row) => row.id === palaSignup.id)?.status).toBe("SELECTED");
    expect(still.find((row) => row.id === palaSignup.id)?.offeredRoles.sort()).toEqual(["HEALER", "MELEE_DPS"]);
  });

  it("K. leaves Lootbuddy rows unchanged", async () => {
    await signupService.setLootbuddies(target, {
      runId: mainRunId,
      lootbuddies: [{ wowClass: "MAGE", mode: "LOOT_ONLY" }],
    });
    const before = await signupRepository.listByRunAndUser(mainRunId, target.id);
    const loot = before.find((row) => row.participationType === "LOOTBUDDY" && row.status !== "WITHDRAWN")!;
    await signupService.quickSignupBoosters(target, { runId: mainRunId });
    const after = await signupRepository.listByRunAndUser(mainRunId, target.id);
    const lootAfter = after.find((row) => row.id === loot.id);
    expect(lootAfter?.status).toBe("PENDING");
    expect(lootAfter?.lootbuddyClass).toBe("MAGE");
    await signupService.setLootbuddies(target, { runId: mainRunId, lootbuddies: [] });
  });

  it("L. refuses when the User lacks the Booster role", async () => {
    await orm.User.where({ id: target.id }).update({ isBooster: false });
    await expectDomainError(
      signupService.quickSignupBoosters(target, { runId: mainRunId }),
      "BOOSTER_ACCESS_REQUIRED",
    );
    await orm.User.where({ id: target.id }).update({ isBooster: true });
  });

  it("M. refuses when the signup window is closed", async () => {
    await runService.setSignupWindow(lead, mainRunId, false);
    await expectDomainError(
      signupService.quickSignupBoosters(target, { runId: mainRunId }),
      "SIGNUP_CLOSED",
    );
    await runService.setSignupWindow(lead, mainRunId, true);
  });

  it("N. works on Community Runs", async () => {
    await signupService.setCharacterOffers(target, { runId: communityRunId, offers: [] });
    const result = await signupService.quickSignupBoosters(target, { runId: communityRunId });
    expect(result.added).toBeGreaterThanOrEqual(1);
    const active = await activeBoosters(communityRunId, target.id);
    expect(active.length).toBe(result.added + result.alreadySigned > 0 ? active.length : 0);
    expect(active.some((row) => row.character?.id === hunterA)).toBe(true);
  });

  it("O. works on Mythic Runs", async () => {
    await signupService.setCharacterOffers(target, { runId: mythicRunId, offers: [] });
    const result = await signupService.quickSignupBoosters(target, { runId: mythicRunId });
    expect(result.added).toBeGreaterThanOrEqual(1);
    const active = await activeBoosters(mythicRunId, target.id);
    expect(active.some((row) => row.character?.id === hunterA)).toBe(true);
  });

  it("P. Quick Signup offers appear in normal Signup options projection", async () => {
    await signupService.setCharacterOffers(target, { runId: communityRunId, offers: [] });
    await signupService.quickSignupBoosters(target, { runId: communityRunId });
    const options = await signupService.getSignupOptions(target, communityRunId);
    expect(options.activeBoosterOffers.characterIds.length).toBeGreaterThanOrEqual(1);
    expect(options.activeBoosterOffers.offeredRolesByCharacterId[hunterA]).toEqual(["RANGED_DPS"]);
  });

  it("Q. PENDING on another overlapping Run does not block Quick Signup", async () => {
    const other = await runService.createRun(
      otherLead,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        venomousPlannedBossCount: 8,
        scheduledStartAt: (await runRepository.findById(mainRunId))!.scheduledStartAt,
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 2,
      }),
    );
    created.runIds.push(other.id);
    await runService.openRun(otherLead, other.id);
    await signupService.setCharacterOffers(target, {
      runId: other.id,
      offers: [{ characterId: hunterB, offeredRoles: ["RANGED_DPS"] }],
    });
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    const result = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    const active = await activeBoosters(mainRunId, target.id);
    expect(active.some((row) => row.character?.id === hunterB)).toBe(true);
    // hunterB itself must not be counted as a reservation conflict (PENDING ≠ reservation).
    const options = await signupService.getSignupOptions(target, mainRunId);
    expect(options.booster.ineligible.find((row) => row.characterId === hunterB)?.reason).not.toBe(
      "ALREADY_SELECTED_OTHER_RUN",
    );
    expect(result.added + result.alreadySigned).toBeGreaterThanOrEqual(1);
    await clearBoosterOffers(target, otherLead, other.id);
  });

  it("R. draft-selected / SELECTED exactly 2h apart are included; <2h skipped", async () => {
    const targetStart = new Date((await runRepository.findById(mainRunId))!.scheduledStartAt).getTime();
    const exactly2h = new Date(targetStart - 2 * 60 * 60 * 1000).toISOString();
    const under2h = new Date(targetStart - 90 * 60 * 1000).toISOString();

    async function reserveOn(at: string, characterId: string, mode: "draft" | "selected") {
      const run = await runService.createRun(
        otherLead,
        venomousCreateInput({
          difficulty: "HEROIC",
          lootType: "UNSAVED",
          venomousPlannedBossCount: 8,
          scheduledStartAt: at,
          desiredTankCount: 1,
          desiredHealerCount: 1,
          desiredDpsCount: 2,
        }),
      );
      created.runIds.push(run.id);
      await runService.openRun(otherLead, run.id);
      await signupService.setCharacterOffers(target, {
        runId: run.id,
        offers: [{ characterId, offeredRoles: ["RANGED_DPS"] }],
      });
      const rows = await activeBoosters(run.id, target.id);
      const signup = rows.find((row) => row.character?.id === characterId)!;
      if (mode === "draft") {
        const view = await rosterService.getRosterManagementView(otherLead, run.id);
        await rosterService.saveDraftSelection(otherLead, {
          runId: run.id,
          version: view.roster.version,
          selections: [{ signupId: signup.id, selectedRole: "RANGED_DPS" }],
        });
      } else {
        await orm.RunSignup.where({ id: signup.id }).update({ status: "SELECTED" });
      }
      return run.id;
    }

    const allowedRunId = await reserveOn(exactly2h, hunterA, "draft");
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect((await activeBoosters(mainRunId, target.id)).some((row) => row.character?.id === hunterA)).toBe(true);
    await clearBoosterOffers(target, otherLead, allowedRunId);

    const blockedRunId = await reserveOn(under2h, hunterB, "selected");
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    const blocked = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(blocked.skippedReservationConflict).toBeGreaterThanOrEqual(1);
    expect((await activeBoosters(mainRunId, target.id)).some((row) => row.character?.id === hunterB)).toBe(false);
    await clearBoosterOffers(target, otherLead, blockedRunId);
  });

  it("S. reserved >2h apart and saved+non-conflicting reservation are included", async () => {
    const targetStart = new Date((await runRepository.findById(mainRunId))!.scheduledStartAt).getTime();
    const over2h = new Date(targetStart - 3 * 60 * 60 * 1000).toISOString();
    const far = await runService.createRun(
      otherLead,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        venomousPlannedBossCount: 8,
        scheduledStartAt: over2h,
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 2,
      }),
    );
    created.runIds.push(far.id);
    await runService.openRun(otherLead, far.id);
    await signupService.setCharacterOffers(target, {
      runId: far.id,
      offers: [{ characterId: hunterA, offeredRoles: ["RANGED_DPS"] }],
    });
    const farRows = await activeBoosters(far.id, target.id);
    const farSignup = farRows.find((row) => row.character?.id === hunterA)!;
    await orm.RunSignup.where({ id: farSignup.id }).update({ status: "SELECTED" });

    const run = await runRepository.findById(mainRunId);
    const raidId = run!.contents[0]!.raidId;
    const resetIdentifier = lockoutService.getResetIdentifierForRun("EU", run!.scheduledStartAt);
    await orm.CharacterRaidLockout.where({ characterId: hunterA }).deleteAndCount();
    await orm.CharacterRaidLockout.create({
      id: crypto.randomUUID(),
      characterId: hunterA,
      raidId,
      difficulty: "HEROIC",
      resetIdentifier,
      bossesDefeated: 8,
      isComplete: true,
      killedBossIds: JSON.stringify([]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect((await activeBoosters(mainRunId, target.id)).some((row) => row.character?.id === hunterA)).toBe(true);
    await orm.CharacterRaidLockout.where({ characterId: hunterA }).deleteAndCount();
    await clearBoosterOffers(target, otherLead, far.id);
  });

  it("T. inactive Characters are skipped with skippedInactive", async () => {
    const inactiveId = await createCharacter(target.id, "Qsinactive", { isActive: false });
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    const result = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(result.skippedInactive).toBeGreaterThanOrEqual(1);
    expect((await activeBoosters(mainRunId, target.id)).some((row) => row.character?.id === inactiveId)).toBe(false);
  });

  it("U. withdrawn eligible offer is reactivated in place", async () => {
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterA, offeredRoles: ["RANGED_DPS"] }],
    });
    const before = (await activeBoosters(mainRunId, target.id)).find((row) => row.character?.id === hunterA)!;
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    const withdrawn = await signupRepository.listByRunAndUser(mainRunId, target.id);
    expect(withdrawn.find((row) => row.id === before.id)?.status).toBe("WITHDRAWN");
    const result = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(result.added).toBeGreaterThanOrEqual(1);
    const after = await activeBoosters(mainRunId, target.id);
    const revived = after.find((row) => row.character?.id === hunterA)!;
    expect(revived.id).toBe(before.id);
    expect(revived.status).toBe("PENDING");
    expect(revived.offeredRoles).toEqual(["RANGED_DPS"]);
  });

  it("V. manual and Quick Signup agree on hard blockers; no-spec Characters cannot offer roles", async () => {
    const options = await signupService.getSignupOptions(target, mainRunId);
    const eligibleIds = new Set(options.booster.eligible.map((row) => row.characterId));
    const ineligibleById = new Map(options.booster.ineligible.map((row) => [row.characterId, row.reason]));

    expect(ineligibleById.get(hunterA)).not.toBe("INACTIVE");
    if (!ineligibleById.has(hunterA)) {
      expect(eligibleIds.has(hunterA)).toBe(true);
    }

    const mageEligible = options.booster.eligible.find((row) => row.characterId === noSpecMage);
    expect(mageEligible).toBeTruthy();
    expect(mageEligible?.defaultRole).toBeNull();
    expect(mageEligible?.roles).toEqual([]);
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    const quick = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(quick.skippedNoDefaultRole).toBeGreaterThanOrEqual(1);
    expect((await activeBoosters(mainRunId, target.id)).some((row) => row.character?.id === noSpecMage)).toBe(false);

    await expect(
      signupService.setCharacterOffers(target, {
        runId: mainRunId,
        offers: [{ characterId: noSpecMage, offeredRoles: ["RANGED_DPS"] }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_CHARACTER_ROLE" });
    expect((await activeBoosters(mainRunId, target.id)).some((row) => row.character?.id === noSpecMage)).toBe(false);
  });

  it("W. race safety: applyOfferPlan re-checks reservation conflicts transactionally", async () => {
    // Contract: quickSignupBoosters → validateOfferedCharacters → applyOfferPlan, and
    // applyOfferPlan calls queryReservationConflicts inside the write transaction for
    // activating Character ids. Write-boundary races are covered in
    // signup-cross-run-reservation.test.ts; here Quick Signup must skip a colliding
    // draft-selected Character through the shared eligibility path.
    const collideAt = (await runRepository.findById(mainRunId))!.scheduledStartAt;
    const collide = await runService.createRun(
      otherLead,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        venomousPlannedBossCount: 8,
        scheduledStartAt: collideAt,
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 2,
      }),
    );
    created.runIds.push(collide.id);
    await runService.openRun(otherLead, collide.id);
    await signupService.setCharacterOffers(target, {
      runId: collide.id,
      offers: [{ characterId: hunterC, offeredRoles: ["RANGED_DPS"] }],
    });
    const rows = await activeBoosters(collide.id, target.id);
    const signup = rows.find((row) => row.character?.id === hunterC)!;
    const view = await rosterService.getRosterManagementView(otherLead, collide.id);
    await rosterService.saveDraftSelection(otherLead, {
      runId: collide.id,
      version: view.roster.version,
      selections: [{ signupId: signup.id, selectedRole: "RANGED_DPS" }],
    });
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    const result = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(result.skippedReservationConflict).toBeGreaterThanOrEqual(1);
    expect((await activeBoosters(mainRunId, target.id)).some((row) => row.character?.id === hunterC)).toBe(false);
    await clearBoosterOffers(target, otherLead, collide.id);
  });
});
