import { orm } from "@/lib/prisma";
import {
  asBoolean,
  asNumber,
  asString,
  asStringOrNull,
  mapAccessStatus,
  mapCharacterRole,
  mapDifficulty,
  mapRegion,
  mapWowClass,
} from "@/lib/persistence";
import type { BoosterAccessRecord } from "@/models/records";
import type { CharacterRole, WowClass, WowRegion } from "@/models/enums";

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

function mapCharacter(character: Record<string, unknown>): CharacterPageRecord {
  const access = Array.isArray(character.boosterAccess) ? character.boosterAccess : [];
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
    warcraftLogsId: asStringOrNull(character.warcraftLogsId),
    createdAt: asString(character.createdAt),
    updatedAt: asString(character.updatedAt),
    boosterAccess: access.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: asString(record.id),
        userId: asString(record.userId),
        characterId: asStringOrNull(record.characterId),
        wowClass: mapWowClass(record.wowClass),
        role: mapCharacterRole(record.role),
        difficulty: mapDifficulty(record.difficulty),
        status: mapAccessStatus(record.status),
        notes: asStringOrNull(record.notes),
        approvedAt: asStringOrNull(record.approvedAt),
        approvedById: asStringOrNull(record.approvedById),
        reviewedAt: asStringOrNull(record.reviewedAt),
        reviewedById: asStringOrNull(record.reviewedById),
        createdAt: asString(record.createdAt),
        updatedAt: asString(record.updatedAt),
      };
    }),
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

export const characterRepository = {
  async listByUserId(userId: string): Promise<CharacterPageRecord[]> {
    const characters = await orm.Character
      .where({ userId })
      .include("boosterAccess")
      .include("lockouts", (lockout) => lockout.include("raid"))
      .orderBy((character) => character.name.asc())
      .all();

    return characters.map((character) => mapCharacter(character as Record<string, unknown>));
  },

  async findById(characterId: string): Promise<CharacterPageRecord | null> {
    const character = await orm.Character
      .where({ id: characterId })
      .include("boosterAccess")
      .include("lockouts", (lockout) => lockout.include("raid"))
      .first();
    return character ? mapCharacter(character as Record<string, unknown>) : null;
  },

  async findOwnedById(userId: string, characterId: string): Promise<CharacterPageRecord | null> {
    const character = await orm.Character
      .where({ id: characterId, userId })
      .include("boosterAccess")
      .include("lockouts", (lockout) => lockout.include("raid"))
      .first();
    return character ? mapCharacter(character as Record<string, unknown>) : null;
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

  async setActive(characterId: string, isActive: boolean): Promise<void> {
    await orm.Character.where({ id: characterId }).update({
      isActive,
      updatedAt: new Date().toISOString(),
    });
  },
};
