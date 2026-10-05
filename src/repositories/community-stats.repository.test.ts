import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orm } from "@/lib/prisma";
import { communityStatsRepository } from "@/repositories/community-stats.repository";
import {
  aggregateCommunityStats,
  communityStatsService,
} from "@/services/community-stats.service";

/**
 * Integration coverage for Community Stats eligibility filtering.
 * Capability math is covered in community-stats.service.test.ts via aggregateCommunityStats.
 */
const ids = {
  activeBooster: "aaaaaaaa-aaaa-4aaa-8aaa-cs0000000001",
  disabledBooster: "aaaaaaaa-aaaa-4aaa-8aaa-cs0000000002",
  activeNonBooster: "aaaaaaaa-aaaa-4aaa-8aaa-cs0000000003",
  activeBoosterTwo: "aaaaaaaa-aaaa-4aaa-8aaa-cs0000000004",
  charActive: "bbbbbbbb-bbbb-4bbb-8bbb-cs0000000001",
  charRetired: "bbbbbbbb-bbbb-4bbb-8bbb-cs0000000002",
  charDisabledOwner: "bbbbbbbb-bbbb-4bbb-8bbb-cs0000000003",
  charNonBooster: "bbbbbbbb-bbbb-4bbb-8bbb-cs0000000004",
  charOffspec: "bbbbbbbb-bbbb-4bbb-8bbb-cs0000000005",
  charTankA: "bbbbbbbb-bbbb-4bbb-8bbb-cs0000000006",
  charTankB: "bbbbbbbb-bbbb-4bbb-8bbb-cs0000000007",
};

const USER_IDS = [ids.activeBooster, ids.disabledBooster, ids.activeNonBooster, ids.activeBoosterTwo];
const CHARACTER_IDS = [
  ids.charActive,
  ids.charRetired,
  ids.charDisabledOwner,
  ids.charNonBooster,
  ids.charOffspec,
  ids.charTankA,
  ids.charTankB,
];

async function deletePlayableSpecs(characterId: string) {
  for (const row of await orm.CharacterPlayableSpec.where({ characterId }).all()) {
    await orm.CharacterPlayableSpec.where({ id: String(row.id) }).delete().catch(() => {});
  }
}

async function cleanup() {
  for (const characterId of CHARACTER_IDS) {
    await deletePlayableSpecs(characterId);
    await orm.Character.where({ id: characterId }).delete().catch(() => {});
  }
  for (const userId of USER_IDS) {
    await orm.User.where({ id: userId }).delete().catch(() => {});
  }
}

async function createUser(input: {
  id: string;
  name: string;
  accountStatus: "ACTIVE" | "DISABLED";
  isBooster: boolean;
}) {
  const now = new Date().toISOString();
  await orm.User.create({
    id: input.id,
    name: input.name,
    email: `${input.id}@cstats.boostting.local`,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: input.accountStatus,
    isBooster: input.isBooster,
    isLootbuddy: false,
    createdAt: now,
    updatedAt: now,
  });
}

async function createCharacter(input: {
  id: string;
  userId: string;
  name: string;
  wowClass: "SHAMAN" | "WARRIOR" | "MAGE";
  specialization: string;
  primaryRole: "HEALER" | "TANK" | "RANGED_DPS" | "MELEE_DPS";
  isActive: boolean;
  playableSpecs?: string[];
}) {
  const now = new Date().toISOString();
  await orm.Character.create({
    id: input.id,
    userId: input.userId,
    name: input.name,
    realm: "Tarren Mill",
    region: "EU",
    normalizedName: input.name.toLocaleLowerCase("en-US"),
    normalizedRealm: "tarrenmill",
    wowClass: input.wowClass,
    specialization: input.specialization,
    primaryRole: input.primaryRole,
    itemLevel: 700,
    isActive: input.isActive,
    createdAt: now,
    updatedAt: now,
  });
  for (const specialization of input.playableSpecs ?? []) {
    await orm.CharacterPlayableSpec.create({
      id: crypto.randomUUID(),
      characterId: input.id,
      specialization,
      createdAt: now,
    });
  }
}

beforeAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await cleanup();

  await createUser({
    id: ids.activeBooster,
    name: "CS Active Booster",
    accountStatus: "ACTIVE",
    isBooster: true,
  });
  await createUser({
    id: ids.disabledBooster,
    name: "CS Disabled Booster",
    accountStatus: "DISABLED",
    isBooster: true,
  });
  await createUser({
    id: ids.activeNonBooster,
    name: "CS Active NonBooster",
    accountStatus: "ACTIVE",
    isBooster: false,
  });
  await createUser({
    id: ids.activeBoosterTwo,
    name: "CS Active Booster Two",
    accountStatus: "ACTIVE",
    isBooster: true,
  });

  await createCharacter({
    id: ids.charActive,
    userId: ids.activeBooster,
    name: "CsActive",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    primaryRole: "HEALER",
    isActive: true,
  });
  await createCharacter({
    id: ids.charRetired,
    userId: ids.activeBooster,
    name: "CsRetired",
    wowClass: "MAGE",
    specialization: "Frost",
    primaryRole: "RANGED_DPS",
    isActive: false,
  });
  await createCharacter({
    id: ids.charDisabledOwner,
    userId: ids.disabledBooster,
    name: "CsDisabledOwner",
    wowClass: "WARRIOR",
    specialization: "Protection",
    primaryRole: "TANK",
    isActive: true,
  });
  await createCharacter({
    id: ids.charNonBooster,
    userId: ids.activeNonBooster,
    name: "CsNonBooster",
    wowClass: "WARRIOR",
    specialization: "Arms",
    primaryRole: "MELEE_DPS",
    isActive: true,
  });
  await createCharacter({
    id: ids.charOffspec,
    userId: ids.activeBooster,
    name: "CsOffspec",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    primaryRole: "HEALER",
    isActive: true,
    playableSpecs: ["Elemental"],
  });
  await createCharacter({
    id: ids.charTankA,
    userId: ids.activeBoosterTwo,
    name: "CsTankA",
    wowClass: "WARRIOR",
    specialization: "Protection",
    primaryRole: "TANK",
    isActive: true,
  });
  await createCharacter({
    id: ids.charTankB,
    userId: ids.activeBoosterTwo,
    name: "CsTankB",
    wowClass: "WARRIOR",
    specialization: "Protection",
    primaryRole: "TANK",
    isActive: true,
  });
});

afterAll(async () => {
  await cleanup();
});

describe("communityStatsRepository.listPool", () => {
  it("includes ACTIVE approved Boosters and excludes DISABLED / non-Boosters", async () => {
    const { boosterIds } = await communityStatsRepository.listPool();
    expect(boosterIds).toEqual(expect.arrayContaining([ids.activeBooster, ids.activeBoosterTwo]));
    expect(boosterIds).not.toContain(ids.disabledBooster);
    expect(boosterIds).not.toContain(ids.activeNonBooster);
  });

  it("includes only active Characters of eligible Boosters", async () => {
    const { characters } = await communityStatsRepository.listPool();
    const characterIds = characters.map((row) => row.id);
    expect(characterIds).toEqual(
      expect.arrayContaining([ids.charActive, ids.charOffspec, ids.charTankA, ids.charTankB]),
    );
    expect(characterIds).not.toContain(ids.charRetired);
    expect(characterIds).not.toContain(ids.charDisabledOwner);
    expect(characterIds).not.toContain(ids.charNonBooster);
  });

  it("loads playableSpecs without lockouts or Battle.net overfetch", async () => {
    const { characters } = await communityStatsRepository.listPool();
    const offspec = characters.find((row) => row.id === ids.charOffspec);
    expect(offspec).toMatchObject({
      userId: ids.activeBooster,
      wowClass: "SHAMAN",
      specialization: "Restoration",
      playableSpecs: ["Elemental"],
    });
    expect(offspec).not.toHaveProperty("lockouts");
    expect(offspec).not.toHaveProperty("primaryRole");
  });
});

describe("communityStatsService.getStats", () => {
  it("wires the repository pool through aggregateCommunityStats", async () => {
    const pool = await communityStatsRepository.listPool();
    const stats = await communityStatsService.getStats();
    expect(stats).toEqual(aggregateCommunityStats(pool));

    // Our fixtures are present and excluded rows stay out of the pool.
    expect(pool.boosterIds).toEqual(expect.arrayContaining([ids.activeBooster, ids.activeBoosterTwo]));
    expect(pool.boosterIds).not.toContain(ids.disabledBooster);
    expect(pool.boosterIds).not.toContain(ids.activeNonBooster);

    const ours = pool.characters.filter((c) => CHARACTER_IDS.includes(c.id));
    expect(ours).toHaveLength(4);
    expect(ours.map((c) => c.id).sort()).toEqual(
      [ids.charActive, ids.charOffspec, ids.charTankA, ids.charTankB].sort(),
    );

    // Isolated aggregation over only our Characters matches capability semantics.
    const isolated = aggregateCommunityStats({
      boosterIds: [ids.activeBooster, ids.activeBoosterTwo],
      characters: ours,
    });
    expect(isolated.activeBoosters).toBe(2);
    expect(isolated.activeCharacters).toBe(4);
    expect(isolated.roles.HEALER).toEqual({ characters: 2, boosters: 1 });
    expect(isolated.roles.RANGED_DPS).toEqual({ characters: 1, boosters: 1 });
    expect(isolated.roles.TANK).toEqual({ characters: 2, boosters: 1 });
    expect(isolated.multiRole).toEqual({ characters: 1, boosters: 1 });
    expect(isolated.classes.SHAMAN).toBe(2);
    expect(isolated.classes.WARRIOR).toBe(2);
  });
});
