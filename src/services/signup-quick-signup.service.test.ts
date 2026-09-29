import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
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

const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-qs0000000001",
  target: "aaaaaaaa-aaaa-4aaa-8aaa-qs0000000002",
  otherLead: "aaaaaaaa-aaaa-4aaa-8aaa-qs0000000003",
};
const createdUserIds = Object.values(ids);
const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"] = "USER"): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@qstest.boostting.local`,
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
    if (error instanceof Error && error.message === `Expected domain error ${code}`) {
      throw error;
    }
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

async function createTestUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@qstest.boostting.local`,
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
    else if (table === "RunSignupRole") await orm.RunSignupRole.where({ id }).delete();
    else if (table === "RunSignup") await orm.RunSignup.where({ id }).delete();
    else if (table === "Run") await orm.Run.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

function futureIso(days = 12) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function createCharacter(
  userId: string,
  name: string,
  options: {
    wowClass?: "HUNTER" | "PALADIN" | "MAGE" | "DRUID" | "PRIEST";
    specialization?: string | null;
    primaryRole?: "TANK" | "HEALER" | "DPS";
    isActive?: boolean;
  } = {},
) {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  await orm.Character.create({
    id,
    userId,
    name,
    realm: "Quick Lab",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity("Quick Lab"),
    region: "EU",
    wowClass: options.wowClass ?? "HUNTER",
    specialization: options.specialization === undefined ? "Beast Mastery" : options.specialization,
    primaryRole: options.primaryRole ?? "DPS",
    itemLevel: 700,
    isActive: options.isActive ?? true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function cleanupRun(runId: string) {
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
  await deleteIfPresent("Run", runId);
}

async function activeBoosters(runId: string, userId: string) {
  const rows = await signupRepository.listByRunAndUser(runId, userId);
  return rows.filter((row) => row.participationType === "BOOSTER" && row.status !== "WITHDRAWN");
}

const lead = asUser(ids.lead, "QS Lead", "RAID_LEAD");
const target = asUser(ids.target, "QS Target", "USER");
const otherLead = asUser(ids.otherLead, "QS Other Lead", "RAID_LEAD");

let hunterA = "";
let hunterB = "";
let hunterC = "";
let holyPaladin = "";
let noSpecMage = "";
let unavailableHunter = "";
let mainRunId = "";
let communityRunId = "";
let mythicRunId = "";

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const userId of createdUserIds) {
    const runs = await orm.Run.where({ raidLeadId: userId }).select("id").all();
    for (const row of runs) {
      await cleanupRun((row as { id: string }).id);
    }
    const chars = await orm.Character.where({ userId }).select("id").all();
    for (const row of chars) {
      await orm.CharacterWeeklyUnavailability.where({ characterId: (row as { id: string }).id }).delete().catch(() => {});
      await orm.CharacterRaidLockout.where({ characterId: (row as { id: string }).id }).delete().catch(() => {});
      await deleteIfPresent("Character", (row as { id: string }).id);
    }
    await deleteIfPresent("User", userId);
  }

  await createTestUser(ids.lead, "QS Lead", "RAID_LEAD");
  await createTestUser(ids.target, "QS Target", "USER");
  await createTestUser(ids.otherLead, "QS Other Lead", "RAID_LEAD");
  await orm.User.where({ id: ids.target }).update({ isBooster: true });

  hunterA = await createCharacter(ids.target, "Qshuntera");
  hunterB = await createCharacter(ids.target, "Qshunterb");
  hunterC = await createCharacter(ids.target, "Qshunterc");
  holyPaladin = await createCharacter(ids.target, "Qsholypala", {
    wowClass: "PALADIN",
    specialization: "Holy",
    primaryRole: "HEALER",
  });
  noSpecMage = await createCharacter(ids.target, "Qsnospec", {
    wowClass: "MAGE",
    specialization: null,
    primaryRole: "DPS",
  });
  unavailableHunter = await createCharacter(ids.target, "Qsunavail");

  mainRunId = await runService
    .createRun(
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
    .then((run) => run.id);
  createdRunIds.push(mainRunId);
  await runService.openRun(lead, mainRunId);

  communityRunId = await runService
    .createRun(
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
    .then((run) => run.id);
  createdRunIds.push(communityRunId);
  await runService.openRun(lead, communityRunId);

  mythicRunId = await runService
    .createRun(
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
    .then((run) => run.id);
  createdRunIds.push(mythicRunId);
  await runService.openRun(lead, mythicRunId);
}, 60_000);

afterAll(async () => {
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const id of createdCharacterIds) {
    await orm.CharacterWeeklyUnavailability.where({ characterId: id }).delete().catch(() => {});
    await orm.CharacterRaidLockout.where({ characterId: id }).delete().catch(() => {});
    await deleteIfPresent("Character", id);
  }
  for (const id of createdUserIds) {
    await deleteIfPresent("User", id);
  }
}, 60_000);

describe("formatQuickSignupBoostersMessage", () => {
  it("covers added / already signed / skipped-default-role copy", () => {
    expect(
      formatQuickSignupBoostersMessage({
        runId: "r",
        added: 8,
        alreadySigned: 0,
        skippedNoDefaultRole: 0,
        skippedIneligible: 0,
      }),
    ).toBe("Quick Signup added 8 characters.");
    expect(
      formatQuickSignupBoostersMessage({
        runId: "r",
        added: 7,
        alreadySigned: 0,
        skippedNoDefaultRole: 1,
        skippedIneligible: 2,
      }),
    ).toBe(
      "Quick Signup added 7 characters. 1 character was skipped because no default role could be determined.",
    );
    expect(
      formatQuickSignupBoostersMessage({
        runId: "r",
        added: 0,
        alreadySigned: 3,
        skippedNoDefaultRole: 0,
        skippedIneligible: 1,
      }),
    ).toBe("All eligible characters are already signed up.");
  });
});

describe("signupService.quickSignupBoosters", () => {
  it("A. adds every eligible Character with a defaultRole", async () => {
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    const result = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(result.added).toBeGreaterThanOrEqual(3);
    const active = await activeBoosters(mainRunId, ids.target);
    const byId = new Map(active.map((row) => [row.character!.id, row.offeredRoles]));
    expect(byId.get(hunterA)).toEqual(["DPS"]);
    expect(byId.get(hunterB)).toEqual(["DPS"]);
    expect(byId.get(holyPaladin)).toEqual(["HEALER"]);
  });

  it("B/C. preserves existing offeredRoles and only adds missing Characters", async () => {
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: holyPaladin, offeredRoles: ["HEALER", "DPS"] }],
    });
    const result = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(result.added).toBeGreaterThanOrEqual(1);
    expect(result.alreadySigned).toBeGreaterThanOrEqual(1);
    const active = await activeBoosters(mainRunId, ids.target);
    const pala = active.find((row) => row.character?.id === holyPaladin);
    expect(pala?.offeredRoles.sort()).toEqual(["DPS", "HEALER"]);
    expect(active.some((row) => row.character?.id === hunterA)).toBe(true);
  });

  it("D. is idempotent — second click adds 0 and withdraws 0", async () => {
    const first = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    const before = await activeBoosters(mainRunId, ids.target);
    const second = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(second.added).toBe(0);
    const after = await activeBoosters(mainRunId, ids.target);
    expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());
    expect(first.added + second.alreadySigned).toBeGreaterThanOrEqual(second.alreadySigned);
  });

  it("E. skips Characters with null defaultRole", async () => {
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    const result = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(result.skippedNoDefaultRole).toBeGreaterThanOrEqual(1);
    const active = await activeBoosters(mainRunId, ids.target);
    expect(active.some((row) => row.character?.id === noSpecMage)).toBe(false);
  });

  it("F. skips weekly unavailable Characters", async () => {
    const run = await runRepository.findById(mainRunId);
    const resetIdentifier = lockoutService.getResetIdentifierForRun("EU", run!.scheduledStartAt);
    await orm.CharacterWeeklyUnavailability.where({ characterId: unavailableHunter }).delete().catch(() => {});
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
    expect(result.skippedIneligible).toBeGreaterThanOrEqual(1);
    const active = await activeBoosters(mainRunId, ids.target);
    expect(active.some((row) => row.character?.id === unavailableHunter)).toBe(false);
    await orm.CharacterWeeklyUnavailability.where({ characterId: unavailableHunter }).delete().catch(() => {});
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
    createdRunIds.push(collide.id);
    await runService.openRun(otherLead, collide.id);
    await signupService.setCharacterOffers(target, {
      runId: collide.id,
      offers: [{ characterId: hunterC, offeredRoles: ["DPS"] }],
    });
    const collideRows = await activeBoosters(collide.id, ids.target);
    const collideSignup = collideRows.find((row) => row.character?.id === hunterC)!;
    const view = await rosterService.getRosterManagementView(otherLead, collide.id);
    await rosterService.saveDraftSelection(otherLead, {
      runId: collide.id,
      version: view.roster.version,
      selections: [{ signupId: collideSignup.id, selectedRole: "DPS" }],
    });

    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    const result = await signupService.quickSignupBoosters(target, { runId: mainRunId });
    expect(result.skippedIneligible).toBeGreaterThanOrEqual(1);
    const active = await activeBoosters(mainRunId, ids.target);
    expect(active.some((row) => row.character?.id === hunterC)).toBe(false);

    await signupService.setCharacterOffers(target, { runId: collide.id, offers: [] }).catch(() => {});
  });

  it("H. still adds a Character with saved lockout progress (informational only)", async () => {
    const run = await runRepository.findById(mainRunId);
    const raidId = run!.contents[0]!.raidId;
    const resetIdentifier = lockoutService.getResetIdentifierForRun("EU", run!.scheduledStartAt);
    await orm.CharacterRaidLockout.where({ characterId: hunterA }).delete().catch(() => {});
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
    const active = await activeBoosters(mainRunId, ids.target);
    expect(active.some((row) => row.character?.id === hunterA)).toBe(true);
    await orm.CharacterRaidLockout.where({ characterId: hunterA }).delete().catch(() => {});
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
    createdRunIds.push(protectedRunId);
    await runService.openRun(lead, protectedRunId);

    await signupService.setCharacterOffers(target, {
      runId: protectedRunId,
      offers: [{ characterId: holyPaladin, offeredRoles: ["HEALER", "DPS"] }],
    });
    const rows = await activeBoosters(protectedRunId, ids.target);
    const palaSignup = rows.find((row) => row.character?.id === holyPaladin)!;
    const view = await rosterService.getRosterManagementView(lead, protectedRunId);
    await rosterService.saveDraftSelection(lead, {
      runId: protectedRunId,
      version: view.roster.version,
      selections: [{ signupId: palaSignup.id, selectedRole: "HEALER" }],
    });

    const draftResult = await signupService.quickSignupBoosters(target, { runId: protectedRunId });
    expect(draftResult.alreadySigned).toBeGreaterThanOrEqual(1);
    const afterDraft = await activeBoosters(protectedRunId, ids.target);
    const palaDraft = afterDraft.find((row) => row.character?.id === holyPaladin)!;
    expect(palaDraft.offeredRoles.sort()).toEqual(["DPS", "HEALER"]);
    expect(palaDraft.id).toBe(palaSignup.id);

    // SELECTED preservation: mutate the row to SELECTED without closing the signup
    // window so Quick Signup can still run (publish would close the window).
    await orm.RunSignup.where({ id: palaSignup.id }).update({ status: "SELECTED" });
    const selectedResult = await signupService.quickSignupBoosters(target, { runId: protectedRunId });
    expect(selectedResult.alreadySigned).toBeGreaterThanOrEqual(1);
    const still = await activeBoosters(protectedRunId, ids.target);
    expect(still.find((row) => row.id === palaSignup.id)?.status).toBe("SELECTED");
    expect(still.find((row) => row.id === palaSignup.id)?.offeredRoles.sort()).toEqual(["DPS", "HEALER"]);
  });

  it("K. leaves Lootbuddy rows unchanged", async () => {
    await signupService.setLootbuddies(target, {
      runId: mainRunId,
      lootbuddies: [{ wowClass: "MAGE", mode: "LOOT_ONLY" }],
    });
    const before = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    const loot = before.find((row) => row.participationType === "LOOTBUDDY" && row.status !== "WITHDRAWN")!;
    await signupService.quickSignupBoosters(target, { runId: mainRunId });
    const after = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    const lootAfter = after.find((row) => row.id === loot.id);
    expect(lootAfter?.status).toBe("PENDING");
    expect(lootAfter?.lootbuddyClass).toBe("MAGE");
    await signupService.setLootbuddies(target, { runId: mainRunId, lootbuddies: [] });
  });

  it("L. refuses when the User lacks the Booster role", async () => {
    await orm.User.where({ id: ids.target }).update({ isBooster: false });
    await expectDomainCode(
      signupService.quickSignupBoosters(target, { runId: mainRunId }),
      "BOOSTER_ACCESS_REQUIRED",
    );
    await orm.User.where({ id: ids.target }).update({ isBooster: true });
  });

  it("M. refuses when the signup window is closed", async () => {
    await runService.setSignupWindow(lead, mainRunId, false);
    await expectDomainCode(
      signupService.quickSignupBoosters(target, { runId: mainRunId }),
      "SIGNUP_CLOSED",
    );
    await runService.setSignupWindow(lead, mainRunId, true);
  });

  it("N. works on Community Runs", async () => {
    await signupService.setCharacterOffers(target, { runId: communityRunId, offers: [] });
    const result = await signupService.quickSignupBoosters(target, { runId: communityRunId });
    expect(result.added).toBeGreaterThanOrEqual(1);
    const active = await activeBoosters(communityRunId, ids.target);
    expect(active.length).toBe(result.added + result.alreadySigned > 0 ? active.length : 0);
    expect(active.some((row) => row.character?.id === hunterA)).toBe(true);
  });

  it("O. works on Mythic Runs", async () => {
    await signupService.setCharacterOffers(target, { runId: mythicRunId, offers: [] });
    const result = await signupService.quickSignupBoosters(target, { runId: mythicRunId });
    expect(result.added).toBeGreaterThanOrEqual(1);
    const active = await activeBoosters(mythicRunId, ids.target);
    expect(active.some((row) => row.character?.id === hunterA)).toBe(true);
  });

  it("P. Quick Signup offers appear in normal Signup options projection", async () => {
    await signupService.setCharacterOffers(target, { runId: communityRunId, offers: [] });
    await signupService.quickSignupBoosters(target, { runId: communityRunId });
    const options = await signupService.getSignupOptions(target, communityRunId);
    expect(options.activeBoosterOffers.characterIds.length).toBeGreaterThanOrEqual(1);
    expect(options.activeBoosterOffers.offeredRolesByCharacterId[hunterA]).toEqual(["DPS"]);
  });
});
