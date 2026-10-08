import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orm } from "@/lib/prisma";
import { lockoutRepository } from "@/repositories/lockout.repository";
import { raidRepository } from "@/repositories/raid.repository";
import {
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
} from "@/lib/wow-raid-catalog";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";

const ids = {
  user: "aaaaaaaa-aaaa-4aaa-8aaa-lo0000000001",
  character: "bbbbbbbb-bbbb-4bbb-8bbb-lo0000000001",
};

async function deleteCharacterCascade(characterId: string) {
  const lockouts = await orm.CharacterRaidLockout.where({ characterId }).all();
  for (const row of lockouts) {
    await orm.CharacterRaidLockout.where({ id: String(row.id) }).delete();
  }
  try {
    await orm.Character.where({ id: characterId }).delete();
  } catch {
    // Already gone.
  }
}

async function deleteUser(userId: string) {
  try {
    await orm.User.where({ id: userId }).delete();
  } catch {
    // Already gone.
  }
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await deleteCharacterCascade(ids.character);
  await deleteUser(ids.user);

  const nowIso = new Date().toISOString();
  await orm.User.create({
    id: ids.user,
    name: "Lockout Repo User",
    email: `${ids.user}@lockout.boostting.local`,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  await orm.Character.create({
    id: ids.character,
    userId: ids.user,
    name: "Lockrepo",
    realm: "Tarren Mill",
    region: "EU",
    normalizedName: "lockrepo",
    normalizedRealm: "tarrenmill",
    wowClass: "SHAMAN",
    specialization: "Elemental",
    primaryRole: "MELEE_DPS",
    itemLevel: 700,
    isActive: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
});

/** The production tracked set (DB `Raid.trackLockouts`): Venomous + Tidebound. */
const TRACKED_RAID_IDS = [VENOMOUS_ABYSS_RAID_ID, TIDEBOUND_GROTTO_RAID_ID];

afterAll(async () => {
  await deleteCharacterCascade(ids.character);
  await deleteUser(ids.user);
});

describe("lockoutRepository.replaceVerifiedCurrentResetLockouts", () => {
  it("stores which bosses were killed and keeps them on a later sync without the list", async () => {
    const reset = getRegionalWeeklyReset("EU");
    const killed = ["bb000001-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "bb000002-bbbb-4bbb-8bbb-bbbbbbbbbbbb"];
    await lockoutRepository.replaceVerifiedCurrentResetLockouts(ids.character, {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      resetIdentifier: reset.resetIdentifier,
      trackedRaidIds: TRACKED_RAID_IDS,
      rows: [{ difficulty: "HEROIC", bossesDefeated: 2, isComplete: false, killedBossIds: killed }],
      verifiedAt: new Date().toISOString(),
    });
    const row = await orm.CharacterRaidLockout.where({
      characterId: ids.character,
      raidId: VENOMOUS_ABYSS_RAID_ID,
      difficulty: "HEROIC",
      resetIdentifier: reset.resetIdentifier,
    }).first();
    expect(JSON.parse(String((row as { killedBossIds: string }).killedBossIds))).toEqual(killed);
  });

  it("keeps Venomous rows when Tidebound is replaced for the same reset", async () => {
    const reset = getRegionalWeeklyReset("EU");
    const verifiedAt = new Date().toISOString();

    await lockoutRepository.replaceVerifiedCurrentResetLockouts(ids.character, {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      resetIdentifier: reset.resetIdentifier,
      trackedRaidIds: TRACKED_RAID_IDS,
      rows: [
        { difficulty: "NORMAL", bossesDefeated: 0, isComplete: false },
        { difficulty: "HEROIC", bossesDefeated: 6, isComplete: false },
        { difficulty: "MYTHIC", bossesDefeated: 0, isComplete: false },
      ],
      verifiedAt,
    });

    await lockoutRepository.replaceVerifiedCurrentResetLockouts(ids.character, {
      raidId: TIDEBOUND_GROTTO_RAID_ID,
      resetIdentifier: reset.resetIdentifier,
      trackedRaidIds: TRACKED_RAID_IDS,
      rows: [
        { difficulty: "NORMAL", bossesDefeated: 0, isComplete: false },
        { difficulty: "HEROIC", bossesDefeated: 1, isComplete: true },
        { difficulty: "MYTHIC", bossesDefeated: 0, isComplete: false },
      ],
      verifiedAt,
    });

    const rows = await orm.CharacterRaidLockout.where({ characterId: ids.character }).all();
    const current = rows.filter((row) => String(row.resetIdentifier) === reset.resetIdentifier);
    expect(current).toHaveLength(6);

    const venomousHc = current.find(
      (row) =>
        String(row.raidId) === VENOMOUS_ABYSS_RAID_ID && String(row.difficulty) === "HEROIC",
    );
    const tideboundHc = current.find(
      (row) =>
        String(row.raidId) === TIDEBOUND_GROTTO_RAID_ID && String(row.difficulty) === "HEROIC",
    );
    expect(Number(venomousHc?.bossesDefeated)).toBe(6);
    expect(Number(tideboundHc?.bossesDefeated)).toBe(1);
  });

  it("clears same-reset rows only for raids outside the DB tracked set, never on an empty set", async () => {
    const reset = getRegionalWeeklyReset("EU");
    const verifiedAt = new Date().toISOString();
    const heroicOnly = [{ difficulty: "HEROIC" as const, bossesDefeated: 6, isComplete: false }];
    const tideRows = async () =>
      (await orm.CharacterRaidLockout.where({ characterId: ids.character, raidId: TIDEBOUND_GROTTO_RAID_ID }).all())
        .length;
    expect(await tideRows()).toBe(3);

    // An empty tracked set is never authoritative: nothing outside this raid is touched.
    await lockoutRepository.replaceVerifiedCurrentResetLockouts(ids.character, {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      resetIdentifier: reset.resetIdentifier,
      trackedRaidIds: [],
      rows: heroicOnly,
      verifiedAt,
    });
    expect(await tideRows()).toBe(3);

    // When the DB stops tracking Tide, its same-reset rows are stale and cleared.
    await lockoutRepository.replaceVerifiedCurrentResetLockouts(ids.character, {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      resetIdentifier: reset.resetIdentifier,
      trackedRaidIds: [VENOMOUS_ABYSS_RAID_ID],
      rows: heroicOnly,
      verifiedAt,
    });
    expect(await tideRows()).toBe(0);
  });
});
