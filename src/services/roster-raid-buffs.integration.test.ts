import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";

/**
 * Isolated integration coverage for Class Buff Checker wiring through
 * getRosterManagementView / draft selection. Pure mapping rules live in
 * roster-raid-buffs.test.ts — this file only proves selected draft rows
 * drive the DTO (including the PR #27 multi-participation case).
 */

const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-rbc000000001",
  player: "aaaaaaaa-aaaa-4aaa-8aaa-rbc000000002",
};

const createdUserIds = Object.values(ids);
const createdCharacterIds: string[] = [];
const createdQualificationIds: string[] = [];
let runId = "";
let shamanId = "";

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"] = "USER"): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@rbctest.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function deleteIfPresent(table: string, id: string) {
  try {
    if (table === "User") await orm.User.where({ id }).delete();
    else if (table === "Character") await orm.Character.where({ id }).delete();
    else if (table === "RunSignup") await orm.RunSignup.where({ id }).delete();
    else if (table === "Run") await orm.Run.where({ id }).delete();
    else if (table === "BoosterQualification") await orm.BoosterQualification.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

async function cleanupRun(id: string) {
  const roster = await orm.RunRoster.where({ runId: id }).first();
  if (roster) {
    const rosterId = (roster as { id: string }).id;
    const entries = await orm.RunRosterEntry.where({ rosterId }).all();
    for (const entry of entries) {
      await orm.RunRosterEntry.where({ id: (entry as { id: string }).id }).delete();
    }
    await orm.RunRoster.where({ id: rosterId }).delete();
  }
  const signups = await orm.RunSignup.where({ runId: id }).select("id").all();
  for (const row of signups) {
    await deleteIfPresent("RunSignup", (row as { id: string }).id);
  }
  await deleteIfPresent("Run", id);
}

const lead = asUser(ids.lead, "Rbc Lead", "RAID_LEAD");
const player = asUser(ids.player, "Rbc Player");

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const userId of createdUserIds) {
    const runs = await orm.Run.where({ raidLeadId: userId }).select("id").all();
    for (const row of runs) {
      await cleanupRun((row as { id: string }).id);
    }
    const playerRuns = await orm.RunSignup.where({ userId }).select("runId").all();
    for (const row of playerRuns) {
      await cleanupRun((row as { runId: string }).runId);
    }
    const quals = await orm.BoosterQualification.where({ userId }).select("id").all();
    for (const row of quals) {
      await deleteIfPresent("BoosterQualification", (row as { id: string }).id);
    }
    const chars = await orm.Character.where({ userId }).select("id").all();
    for (const row of chars) {
      await deleteIfPresent("Character", (row as { id: string }).id);
    }
    await deleteIfPresent("User", userId);
  }

  await orm.User.create({
    id: ids.lead,
    name: "Rbc Lead",
    email: `${ids.lead}@rbctest.boostting.local`,
    emailVerified: true,
    accountRole: "RAID_LEAD",
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await orm.User.create({
    id: ids.player,
    name: "Rbc Player",
    email: `${ids.player}@rbctest.boostting.local`,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const shamanRow = await orm.Character.create({
    id: crypto.randomUUID(),
    userId: ids.player,
    name: "Rbcshaman",
    realm: "Antonidas",
    normalizedName: normalizeCharacterIdentity("Rbcshaman"),
    normalizedRealm: normalizeCharacterIdentity("Antonidas"),
    region: "EU",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    primaryRole: "HEALER",
    itemLevel: 700,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  shamanId = (shamanRow as { id: string }).id;
  createdCharacterIds.push(shamanId);

  const qualId = crypto.randomUUID();
  createdQualificationIds.push(qualId);
  await orm.BoosterQualification.create({
    id: qualId,
    userId: ids.player,
    difficulty: "HEROIC",
    status: "APPROVED",
    notes: null,
    grantedAt: new Date().toISOString(),
    grantedById: null,
    revokedAt: null,
    revokedById: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const run = await runService.createRun(lead, {
    raidId: VENOMOUS_ABYSS_RAID_ID,
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    plannedBossCount: 8,
    scheduledStartAt: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
  });
  runId = run.id;
  await runService.openRun(lead, runId);
}, 60_000);

afterAll(async () => {
  if (runId) await cleanupRun(runId);
  for (const id of createdQualificationIds) await deleteIfPresent("BoosterQualification", id);
  for (const id of createdCharacterIds) await deleteIfPresent("Character", id);
  for (const id of createdUserIds) await deleteIfPresent("User", id);
}, 60_000);

describe("rosterService Class Buff Checker integration", () => {
  it("updates coverage when a Shaman Booster is draft-selected and deselected", async () => {
    await signupService.setCharacterOffers(player, {
      runId,
      offers: [{ characterId: shamanId, role: "HEALER" }],
    });

    let view = await rosterService.getRosterManagementView(lead, runId);
    const booster = view.groups.healers.find((item) => item.character?.id === shamanId);
    expect(booster).toBeTruthy();
    expect(view.raidBuffCoverage.buffs.find((item) => item.id === "SKYFURY")?.covered).toBe(false);

    await rosterService.setDraftSelection(lead, {
      runId,
      signupId: booster!.id,
      selected: true,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    expect(view.raidBuffCoverage.buffs.find((item) => item.id === "SKYFURY")?.covered).toBe(true);
    expect(
      view.raidBuffCoverage.buffs
        .find((item) => item.id === "SKYFURY")
        ?.providers.some((provider) => provider.signupId === booster!.id),
    ).toBe(true);

    await rosterService.setDraftSelection(lead, {
      runId,
      signupId: booster!.id,
      selected: false,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    expect(view.raidBuffCoverage.buffs.find((item) => item.id === "SKYFURY")?.covered).toBe(false);
  });

  it("PR #27: same User Booster + Mage PLAYING + Priest LOOT_ONLY", async () => {
    await signupService.setCharacterOffers(player, {
      runId,
      offers: [{ characterId: shamanId, role: "HEALER" }],
    });
    await signupService.setLootbuddies(player, {
      runId,
      lootbuddies: [
        { wowClass: "MAGE", mode: "PLAYING" },
        { wowClass: "PRIEST", mode: "LOOT_ONLY" },
      ],
    });

    let view = await rosterService.getRosterManagementView(lead, runId);
    const booster = view.groups.healers.find((item) => item.character?.id === shamanId)!;
    const mage = view.groups.lootbuddies.find(
      (item) => item.lootbuddyClass === "MAGE" && item.lootbuddyMode === "PLAYING",
    )!;
    const priest = view.groups.lootbuddies.find(
      (item) => item.lootbuddyClass === "PRIEST" && item.lootbuddyMode === "LOOT_ONLY",
    )!;

    for (const signupId of [booster.id, mage.id, priest.id]) {
      await rosterService.setDraftSelection(lead, {
        runId,
        signupId,
        selected: true,
        version: view.roster.version,
      });
      view = await rosterService.getRosterManagementView(lead, runId);
    }

    const byId = Object.fromEntries(view.raidBuffCoverage.buffs.map((item) => [item.id, item]));
    expect(byId.SKYFURY?.covered).toBe(true);
    expect(byId.ARCANE_INTELLECT?.covered).toBe(true);
    expect(byId.POWER_WORD_FORTITUDE?.covered).toBe(false);

    // Deselect protected rows before withdrawing offers.
    for (const signupId of [booster.id, mage.id, priest.id]) {
      if (
        [...view.groups.healers, ...view.groups.lootbuddies].find((item) => item.id === signupId)?.draftSelected
      ) {
        await rosterService.setDraftSelection(lead, {
          runId,
          signupId,
          selected: false,
          version: view.roster.version,
        });
        view = await rosterService.getRosterManagementView(lead, runId);
      }
    }
    await signupService.setLootbuddies(player, { runId, lootbuddies: [] });
    await signupService.setCharacterOffers(player, { runId, offers: [] });
  });
});
