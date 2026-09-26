import { orm } from "@/lib/prisma";
import {
  asBoolean,
  asNumber,
  asString,
  asStringOrNull,
  mapCharacterRole,
  mapCharacterSyncErrorCode,
  mapDifficulty,
  mapRegion,
  mapWowClass,
} from "@/lib/persistence";
import { getCurrentLockoutRaids } from "@/lib/wow-raid-catalog";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import type {
  CharacterRole,
  CharacterSyncErrorCode,
  RaidDifficulty,
  WowClass,
  WowRegion,
} from "@/models/enums";

/**
 * Bounded read model for admin Character Operations (/manage/characters).
 * Deliberately NOT the owner /characters query: it loads every Character with
 * its owner and ONLY the current-reset rows of the current raids, plus all
 * Battle.net connection presence — two queries total, independent of the
 * number of Characters (no per-row owner / lockout / connection lookups; no
 * weekly availability or Booster Access on the list).
 */
export type OperationsCharacterRecord = {
  id: string;
  userId: string;
  name: string;
  realm: string;
  region: WowRegion;
  wowClass: WowClass;
  specialization: string | null;
  primaryRole: CharacterRole;
  itemLevel: number | null;
  isActive: boolean;
  blizzardCharacterId: string | null;
  blizzardRealmId: string | null;
  lastSyncedAt: string | null;
  lastSyncAttemptAt: string | null;
  lastSyncErrorAt: string | null;
  lastSyncErrorCode: CharacterSyncErrorCode | null;
  syncFailureCount: number;
  owner: { id: string; name: string; discordUsername: string | null };
  /** Current-reset rows of current-for-lockouts raids, for this Character's region only. */
  currentLockouts: Array<{
    raidId: string;
    difficulty: RaidDifficulty;
    bossesDefeated: number;
    isComplete: boolean;
  }>;
};

export type ConnectionKey = `${string}:${WowRegion}`;

export function connectionKey(userId: string, region: WowRegion): ConnectionKey {
  return `${userId}:${region}`;
}

function currentResetByRegion(): Record<WowRegion, string> {
  return { EU: getRegionalWeeklyReset("EU").resetIdentifier, US: getRegionalWeeklyReset("US").resetIdentifier };
}

function mapRecord(row: Record<string, unknown>, resets: Record<WowRegion, string>): OperationsCharacterRecord {
  const region = mapRegion(row.region);
  const user = (row.user ?? {}) as Record<string, unknown>;
  const lockouts = Array.isArray(row.lockouts) ? (row.lockouts as Array<Record<string, unknown>>) : [];
  return {
    id: asString(row.id),
    userId: asString(row.userId),
    name: asString(row.name),
    realm: asString(row.realm),
    region,
    wowClass: mapWowClass(row.wowClass),
    specialization: asStringOrNull(row.specialization),
    primaryRole: mapCharacterRole(row.primaryRole),
    itemLevel: row.itemLevel == null ? null : asNumber(row.itemLevel, 0),
    isActive: asBoolean(row.isActive, true),
    blizzardCharacterId: asStringOrNull(row.blizzardCharacterId),
    blizzardRealmId: asStringOrNull(row.blizzardRealmId),
    lastSyncedAt: asStringOrNull(row.lastSyncedAt),
    lastSyncAttemptAt: asStringOrNull(row.lastSyncAttemptAt),
    lastSyncErrorAt: asStringOrNull(row.lastSyncErrorAt),
    lastSyncErrorCode: mapCharacterSyncErrorCode(row.lastSyncErrorCode),
    syncFailureCount: asNumber(row.syncFailureCount, 0),
    owner: {
      id: asString(user.id),
      name: asString(user.name),
      discordUsername: asStringOrNull(user.discordUsername),
    },
    // The query already limited rows to both regions' current resets; keep only this region's.
    currentLockouts: lockouts
      .filter((lockout) => asString(lockout.resetIdentifier) === resets[region])
      .map((lockout) => ({
        raidId: asString(lockout.raidId),
        difficulty: mapDifficulty(lockout.difficulty),
        bossesDefeated: asNumber(lockout.bossesDefeated, 0),
        isComplete: asBoolean(lockout.isComplete, false),
      })),
  };
}

function characterQuery() {
  const resets = currentResetByRegion();
  const currentRaidIds = getCurrentLockoutRaids().map((raid) => raid.id);
  return {
    resets,
    query: orm.Character.include("user", (user) => user.select("id", "name", "discordUsername")).include(
      "lockouts",
      (lockout) =>
        lockout
          .where((row) => row.resetIdentifier.in([resets.EU, resets.US]))
          .where((row) => row.raidId.in(currentRaidIds))
          .select("raidId", "difficulty", "resetIdentifier", "bossesDefeated", "isComplete"),
    ),
  };
}

export const characterOperationsRepository = {
  /** Every Character for the operations list (2 queries total). Easy to paginate later via limit/offset. */
  async listAll(): Promise<{ characters: OperationsCharacterRecord[]; connections: Set<ConnectionKey> }> {
    const { resets, query } = characterQuery();
    const rows = (await query.orderBy((character) => character.name.asc()).all()) as Array<Record<string, unknown>>;
    const connectionRows = (await orm.BattleNetConnection.select("userId", "region").all()) as Array<
      Record<string, unknown>
    >;
    return {
      characters: rows.map((row) => mapRecord(row, resets)),
      connections: new Set(connectionRows.map((row) => connectionKey(asString(row.userId), mapRegion(row.region)))),
    };
  },

  async findById(
    characterId: string,
  ): Promise<{ character: OperationsCharacterRecord; ownerHasRegionConnection: boolean } | null> {
    const { resets, query } = characterQuery();
    const row = (await query.where({ id: characterId }).first()) as Record<string, unknown> | null;
    if (!row) return null;
    const character = mapRecord(row, resets);
    const connection = await orm.BattleNetConnection.where({ userId: character.userId, region: character.region })
      .select("id")
      .first();
    return { character, ownerHasRegionConnection: Boolean(connection) };
  },
};
