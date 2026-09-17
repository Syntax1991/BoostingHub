import { orm } from "@/lib/prisma";
import { asString } from "@/lib/persistence";

export type CharacterWeeklyUnavailabilityRecord = {
  id: string;
  characterId: string;
  resetIdentifier: string;
  createdAt: string;
  updatedAt: string;
};

function mapRow(row: Record<string, unknown>): CharacterWeeklyUnavailabilityRecord {
  return {
    id: asString(row.id),
    characterId: asString(row.characterId),
    resetIdentifier: asString(row.resetIdentifier),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  };
}

function keyOf(characterId: string, resetIdentifier: string): string {
  return `${characterId}:${resetIdentifier}`;
}

/**
 * Reset-scoped Character unavailability (presence = Unavailable).
 * Available is the default when no row exists for a reset.
 */
export const characterWeeklyAvailabilityRepository = {
  async findByCharacterAndReset(
    characterId: string,
    resetIdentifier: string,
  ): Promise<CharacterWeeklyUnavailabilityRecord | null> {
    const row = await orm.CharacterWeeklyUnavailability.where({
      characterId,
      resetIdentifier,
    }).first();
    return row ? mapRow(row as Record<string, unknown>) : null;
  },

  /**
   * Batch load unavailability rows for specific (characterId, resetIdentifier) pairs.
   * One query — never N+1. Returns a Set of `${characterId}:${resetIdentifier}` keys that are Unavailable.
   */
  async listUnavailableKeys(
    keys: ReadonlyArray<{ characterId: string; resetIdentifier: string }>,
  ): Promise<Set<string>> {
    const unique = new Map<string, { characterId: string; resetIdentifier: string }>();
    for (const key of keys) {
      if (!key.characterId || !key.resetIdentifier) continue;
      unique.set(keyOf(key.characterId, key.resetIdentifier), key);
    }
    if (unique.size === 0) return new Set();

    const characterIds = [...new Set([...unique.values()].map((row) => row.characterId))];
    const rows = await orm.CharacterWeeklyUnavailability.where((f) =>
      f.characterId.in(characterIds),
    ).all();

    const wanted = new Set(unique.keys());
    const result = new Set<string>();
    for (const raw of rows as Record<string, unknown>[]) {
      const mapped = mapRow(raw);
      const key = keyOf(mapped.characterId, mapped.resetIdentifier);
      if (wanted.has(key)) result.add(key);
    }
    return result;
  },

  async setUnavailable(
    characterId: string,
    resetIdentifier: string,
  ): Promise<CharacterWeeklyUnavailabilityRecord> {
    const existing = await this.findByCharacterAndReset(characterId, resetIdentifier);
    if (existing) return existing;

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await orm.CharacterWeeklyUnavailability.create({
      id,
      characterId,
      resetIdentifier,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.findByCharacterAndReset(characterId, resetIdentifier);
    if (!created) {
      throw new Error("CharacterWeeklyUnavailability create did not persist.");
    }
    return created;
  },

  async clearUnavailable(characterId: string, resetIdentifier: string): Promise<void> {
    const existing = await this.findByCharacterAndReset(characterId, resetIdentifier);
    if (!existing) return;
    await orm.CharacterWeeklyUnavailability.where({ id: existing.id }).delete();
  },
};
