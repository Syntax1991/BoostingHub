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

export type CharacterPageRecord = {
  id: string;
  userId: string;
  name: string;
  realm: string;
  region: ReturnType<typeof mapRegion>;
  wowClass: ReturnType<typeof mapWowClass>;
  specialization: string | null;
  primaryRole: ReturnType<typeof mapCharacterRole>;
  itemLevel: number;
  isActive: boolean;
  lastSyncedAt: string | null;
  blizzardCharacterId: string | null;
  warcraftLogsId: string | null;
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

function mapCharacter(character: Record<string, unknown>): CharacterPageRecord {
  const access = Array.isArray(character.boosterAccess) ? character.boosterAccess : [];
  const lockouts = Array.isArray(character.lockouts) ? character.lockouts : [];

  return {
    id: asString(character.id),
    userId: asString(character.userId),
    name: asString(character.name),
    realm: asString(character.realm),
    region: mapRegion(character.region),
    wowClass: mapWowClass(character.wowClass),
    specialization: asStringOrNull(character.specialization),
    primaryRole: mapCharacterRole(character.primaryRole),
    itemLevel: asNumber(character.itemLevel),
    isActive: asBoolean(character.isActive, true),
    lastSyncedAt: asStringOrNull(character.lastSyncedAt),
    blizzardCharacterId: asStringOrNull(character.blizzardCharacterId),
    warcraftLogsId: asStringOrNull(character.warcraftLogsId),
    boosterAccess: access.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        wowClass: mapWowClass(record.wowClass),
        role: mapCharacterRole(record.role),
        difficulty: mapDifficulty(record.difficulty),
        status: mapAccessStatus(record.status),
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

  async findOwnedById(userId: string, characterId: string): Promise<CharacterPageRecord | null> {
    const character = await orm.Character
      .where({ id: characterId, userId })
      .include("boosterAccess")
      .include("lockouts", (lockout) => lockout.include("raid"))
      .first();

    return character ? mapCharacter(character as Record<string, unknown>) : null;
  },
};
