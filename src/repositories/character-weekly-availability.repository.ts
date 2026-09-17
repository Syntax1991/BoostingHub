import { orm } from "@/lib/prisma";
import { asString } from "@/lib/persistence";
import type { RaidDifficulty } from "@/models/enums";
import { RAID_DIFFICULTIES } from "@/models/enums";

export type CharacterWeeklyUnavailabilityRecord = {
  id: string;
  characterId: string;
  resetIdentifier: string;
  difficulty: RaidDifficulty;
  createdAt: string;
  updatedAt: string;
};

function mapRow(row: Record<string, unknown>): CharacterWeeklyUnavailabilityRecord {
  return {
    id: asString(row.id),
    characterId: asString(row.characterId),
    resetIdentifier: asString(row.resetIdentifier),
    difficulty: asString(row.difficulty) as RaidDifficulty,
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  };
}

function resetKey(characterId: string, resetIdentifier: string): string {
  return `${characterId}:${resetIdentifier}`;
}

function normalizeDifficulties(difficulties: readonly RaidDifficulty[]): RaidDifficulty[] {
  const wanted = new Set(difficulties);
  return RAID_DIFFICULTIES.filter((difficulty) => wanted.has(difficulty));
}

/**
 * Reset + difficulty scoped Character unavailability (presence = Unavailable).
 * Available is the default when no row exists for that difficulty in a reset.
 */
export const characterWeeklyAvailabilityRepository = {
  async listByCharacterAndReset(
    characterId: string,
    resetIdentifier: string,
  ): Promise<CharacterWeeklyUnavailabilityRecord[]> {
    const rows = await orm.CharacterWeeklyUnavailability.where({
      characterId,
      resetIdentifier,
    }).all();
    return (rows as Record<string, unknown>[]).map(mapRow);
  },

  /**
   * Batch load unavailability rows for specific (characterId, resetIdentifier) pairs.
   * One query — never N+1. Returns Map of `${characterId}:${resetIdentifier}` → sorted difficulties.
   */
  async listUnavailableDifficultiesByKeys(
    keys: ReadonlyArray<{ characterId: string; resetIdentifier: string }>,
  ): Promise<Map<string, RaidDifficulty[]>> {
    const unique = new Map<string, { characterId: string; resetIdentifier: string }>();
    for (const key of keys) {
      if (!key.characterId || !key.resetIdentifier) continue;
      unique.set(resetKey(key.characterId, key.resetIdentifier), key);
    }
    const result = new Map<string, RaidDifficulty[]>();
    if (unique.size === 0) return result;

    const characterIds = [...new Set([...unique.values()].map((row) => row.characterId))];
    const rows = await orm.CharacterWeeklyUnavailability.where((f) =>
      f.characterId.in(characterIds),
    ).all();

    const wanted = new Set(unique.keys());
    const buckets = new Map<string, Set<RaidDifficulty>>();
    for (const raw of rows as Record<string, unknown>[]) {
      const mapped = mapRow(raw);
      const key = resetKey(mapped.characterId, mapped.resetIdentifier);
      if (!wanted.has(key)) continue;
      const set = buckets.get(key) ?? new Set<RaidDifficulty>();
      set.add(mapped.difficulty);
      buckets.set(key, set);
    }

    for (const [key, set] of buckets) {
      result.set(key, RAID_DIFFICULTIES.filter((difficulty) => set.has(difficulty)));
    }
    return result;
  },

  /**
   * Atomically replace the Character+reset difficulty set.
   * Empty difficulties → delete all rows for that reset (Available).
   */
  async replaceUnavailableDifficulties(
    characterId: string,
    resetIdentifier: string,
    difficulties: readonly RaidDifficulty[],
  ): Promise<RaidDifficulty[]> {
    const normalized = normalizeDifficulties(difficulties);
    const existing = await this.listByCharacterAndReset(characterId, resetIdentifier);
    for (const row of existing) {
      await orm.CharacterWeeklyUnavailability.where({ id: row.id }).delete();
    }

    if (normalized.length === 0) return [];

    const now = new Date().toISOString();
    for (const difficulty of normalized) {
      await orm.CharacterWeeklyUnavailability.create({
        id: crypto.randomUUID(),
        characterId,
        resetIdentifier,
        difficulty,
        createdAt: now,
        updatedAt: now,
      });
    }
    return normalized;
  },

  async clearUnavailable(characterId: string, resetIdentifier: string): Promise<void> {
    await this.replaceUnavailableDifficulties(characterId, resetIdentifier, []);
  },
};
