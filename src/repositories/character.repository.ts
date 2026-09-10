import { orm } from "@/lib/prisma";
import {
  asBoolean,
  asNumber,
  asString,
  asStringOrNull,
  mapCharacterRole,
  mapDifficulty,
  mapRegion,
  mapWowClass,
} from "@/lib/persistence";
import type { BoosterAccessRecord } from "@/models/records";
import type { CharacterRole, WowClass, WowRegion } from "@/models/enums";
import { boosterAccessRepository } from "@/repositories/booster-access.repository";

export type CharacterPageRecord = {
  id: string;
  userId: string;
  name: string;
  realm: string;
  region: ReturnType<typeof mapRegion>;
  normalizedName: string;
  normalizedRealm: string;
  wowClass: ReturnType<typeof mapWowClass>;
  specialization: string | null;
  primaryRole: ReturnType<typeof mapCharacterRole>;
  itemLevel: number;
  isActive: boolean;
  lastSyncedAt: string | null;
  blizzardCharacterId: string | null;
  blizzardRealmId: string | null;
  warcraftLogsId: string | null;
  createdAt: string;
  updatedAt: string;
  boosterAccess: BoosterAccessRecord[];
  lockouts: Array<{
    raidId: string;
    raid: { name: string };
    difficulty: ReturnType<typeof mapDifficulty>;
    resetIdentifier: string;
    isComplete: boolean;
    bossesDefeated: number;
  }>;
};

export type CharacterCreateInput = {
  id: string;
  userId: string;
  name: string;
  realm: string;
  region: WowRegion;
  normalizedName: string;
  normalizedRealm: string;
  wowClass: WowClass;
  specialization: string;
  primaryRole: CharacterRole;
  itemLevel: number;
  isActive: boolean;
  blizzardCharacterId?: string | null;
  blizzardRealmId?: string | null;
  lastSyncedAt?: string | null;
};

export type CharacterUpdateInput = {
  name: string;
  realm: string;
  region: WowRegion;
  normalizedName: string;
  normalizedRealm: string;
  specialization: string;
  primaryRole: CharacterRole;
  itemLevel: number;
};

export type CharacterBlizzardLinkInput = {
  blizzardCharacterId: string;
  blizzardRealmId: string;
  specialization?: string;
  primaryRole?: CharacterRole;
  itemLevel?: number;
  lastSyncedAt?: string | null;
};

export type CharacterBlizzardSyncInput = {
  name: string;
  normalizedName: string;
  itemLevel: number;
  lastSyncedAt: string;
};

function mapCharacter(character: Record<string, unknown>): CharacterPageRecord {
  const lockouts = Array.isArray(character.lockouts) ? character.lockouts : [];

  return {
    id: asString(character.id),
    userId: asString(character.userId),
    name: asString(character.name),
    realm: asString(character.realm),
    region: mapRegion(character.region),
    normalizedName: asString(character.normalizedName),
    normalizedRealm: asString(character.normalizedRealm),
    wowClass: mapWowClass(character.wowClass),
    specialization: asStringOrNull(character.specialization),
    primaryRole: mapCharacterRole(character.primaryRole),
    itemLevel: asNumber(character.itemLevel),
    isActive: asBoolean(character.isActive, true),
    lastSyncedAt: asStringOrNull(character.lastSyncedAt),
    blizzardCharacterId: asStringOrNull(character.blizzardCharacterId),
    blizzardRealmId: asStringOrNull(character.blizzardRealmId),
    warcraftLogsId: asStringOrNull(character.warcraftLogsId),
    createdAt: asString(character.createdAt),
    updatedAt: asString(character.updatedAt),
    // Account-level access is attached separately — never via Character.boosterAccess relation.
    boosterAccess: [],
    lockouts: lockouts.map((row) => {
      const record = row as Record<string, unknown>;
      const raid = (record.raid ?? {}) as Record<string, unknown>;
      return {
        raidId: asString(record.raidId),
        raid: { name: asString(raid.name, "Unknown raid") },
        difficulty: mapDifficulty(record.difficulty),
        resetIdentifier: asString(record.resetIdentifier),
        isComplete: asBoolean(record.isComplete),
        bossesDefeated: asNumber(record.bossesDefeated),
      };
    }),
  };
}

/**
 * Attach account-level BoosterAccess rows matching each Character's class.
 * characterId on BoosterAccess is request context only and must not drive eligibility.
 */
async function withAccountBoosterAccess(
  characters: CharacterPageRecord[],
): Promise<CharacterPageRecord[]> {
  if (characters.length === 0) return characters;

  const accessByUser = new Map<string, BoosterAccessRecord[]>();
  for (const userId of new Set(characters.map((character) => character.userId))) {
    accessByUser.set(userId, await boosterAccessRepository.listByUserId(userId));
  }

  return characters.map((character) => ({
    ...character,
    boosterAccess: (accessByUser.get(character.userId) ?? []).filter(
      (row) => row.wowClass === character.wowClass,
    ),
  }));
}

export const characterRepository = {
  async listByUserId(userId: string): Promise<CharacterPageRecord[]> {
    const characters = await orm.Character
      .where({ userId })
      .include("lockouts", (lockout) => lockout.include("raid"))
      .orderBy((character) => character.name.asc())
      .all();

    return withAccountBoosterAccess(
      characters.map((character) => mapCharacter(character as Record<string, unknown>)),
    );
  },

  async findById(characterId: string): Promise<CharacterPageRecord | null> {
    const character = await orm.Character
      .where({ id: characterId })
      .include("lockouts", (lockout) => lockout.include("raid"))
      .first();
    if (!character) return null;
    const [withAccess] = await withAccountBoosterAccess([
      mapCharacter(character as Record<string, unknown>),
    ]);
    return withAccess ?? null;
  },

  async findOwnedById(userId: string, characterId: string): Promise<CharacterPageRecord | null> {
    const character = await orm.Character
      .where({ id: characterId, userId })
      .include("lockouts", (lockout) => lockout.include("raid"))
      .first();
    if (!character) return null;
    const [withAccess] = await withAccountBoosterAccess([
      mapCharacter(character as Record<string, unknown>),
    ]);
    return withAccess ?? null;
  },

  /**
   * Scoped Blizzard identity: region + blizzardRealmId + blizzardCharacterId.
   */
  async findByBlizzardIdentity(
    region: WowRegion,
    blizzardRealmId: string,
    blizzardCharacterId: string,
  ): Promise<CharacterPageRecord | null> {
    const character = await orm.Character
      .where({
        region,
        blizzardRealmId,
        blizzardCharacterId,
      })
      .include("lockouts", (lockout) => lockout.include("raid"))
      .first();
    if (!character) return null;
    const [withAccess] = await withAccountBoosterAccess([
      mapCharacter(character as Record<string, unknown>),
    ]);
    return withAccess ?? null;
  },

  /**
   * Owner-scoped identity lookup. Same name/realm on another region, or the
   * same identity owned by a different user, is not a conflict.
   */
  async findIdentityConflict(input: {
    userId: string;
    region: WowRegion;
    normalizedName: string;
    normalizedRealm: string;
    excludeId?: string;
  }): Promise<CharacterPageRecord | null> {
    const character = await orm.Character
      .where({
        userId: input.userId,
        region: input.region,
        normalizedName: input.normalizedName,
        normalizedRealm: input.normalizedRealm,
      })
      .first();

    if (!character) {
      return null;
    }

    const mapped = mapCharacter(character as Record<string, unknown>);
    if (input.excludeId && mapped.id === input.excludeId) {
      return null;
    }

    return mapped;
  },

  async create(input: CharacterCreateInput): Promise<CharacterPageRecord> {
    const now = new Date().toISOString();
    await orm.Character.create({
      id: input.id,
      userId: input.userId,
      name: input.name,
      realm: input.realm,
      region: input.region,
      normalizedName: input.normalizedName,
      normalizedRealm: input.normalizedRealm,
      wowClass: input.wowClass,
      specialization: input.specialization,
      primaryRole: input.primaryRole,
      itemLevel: input.itemLevel,
      isActive: input.isActive,
      blizzardCharacterId: input.blizzardCharacterId ?? null,
      blizzardRealmId: input.blizzardRealmId ?? null,
      lastSyncedAt: input.lastSyncedAt ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const created = await this.findById(input.id);
    if (!created) {
      throw new Error("Character create did not persist.");
    }
    return created;
  },

  async update(characterId: string, input: CharacterUpdateInput): Promise<void> {
    await orm.Character.where({ id: characterId }).update({
      name: input.name,
      realm: input.realm,
      region: input.region,
      normalizedName: input.normalizedName,
      normalizedRealm: input.normalizedRealm,
      specialization: input.specialization,
      primaryRole: input.primaryRole,
      itemLevel: input.itemLevel,
      updatedAt: new Date().toISOString(),
    });
  },

  async applyBlizzardLink(characterId: string, input: CharacterBlizzardLinkInput): Promise<void> {
    await orm.Character.where({ id: characterId }).update({
      blizzardCharacterId: input.blizzardCharacterId,
      blizzardRealmId: input.blizzardRealmId,
      ...(input.specialization ? { specialization: input.specialization } : {}),
      ...(input.primaryRole ? { primaryRole: input.primaryRole } : {}),
      ...(typeof input.itemLevel === "number" ? { itemLevel: input.itemLevel } : {}),
      ...(input.lastSyncedAt !== undefined ? { lastSyncedAt: input.lastSyncedAt } : {}),
      updatedAt: new Date().toISOString(),
    });
  },

  async applyBlizzardSync(characterId: string, input: CharacterBlizzardSyncInput): Promise<void> {
    await orm.Character.where({ id: characterId }).update({
      name: input.name,
      normalizedName: input.normalizedName,
      itemLevel: input.itemLevel,
      lastSyncedAt: input.lastSyncedAt,
      updatedAt: new Date().toISOString(),
    });
  },

  async setActive(characterId: string, isActive: boolean): Promise<void> {
    await orm.Character.where({ id: characterId }).update({
      isActive,
      updatedAt: new Date().toISOString(),
    });
  },
};
