import { orm } from "@/lib/prisma";
import { asNumber, asNumberOrNull, asString } from "@/lib/persistence";

export type CharacterWclPerformanceRecord = {
  id: string;
  characterId: string;
  zoneId: number;
  encounterId: number;
  difficulty: number;
  metricKey: string;
  bestPct: number | null;
  avgPct: number | null;
  fetchedAt: string;
};

function mapRow(row: Record<string, unknown>): CharacterWclPerformanceRecord {
  return {
    id: asString(row.id),
    characterId: asString(row.characterId),
    zoneId: asNumber(row.zoneId),
    encounterId: asNumber(row.encounterId),
    difficulty: asNumber(row.difficulty),
    metricKey: asString(row.metricKey),
    bestPct: asNumberOrNull(row.bestPct),
    avgPct: asNumberOrNull(row.avgPct),
    fetchedAt: asString(row.fetchedAt),
  };
}

export const characterWclPerformanceRepository = {
  async listForCharacters(characterIds: string[]): Promise<CharacterWclPerformanceRecord[]> {
    if (characterIds.length === 0) return [];
    const rows = await orm.CharacterWclPerformance.where((row) => row.characterId.in(characterIds)).all();
    return (rows as Record<string, unknown>[]).map(mapRow);
  },

  async upsert(input: {
    characterId: string;
    zoneId: number;
    encounterId: number;
    difficulty: number;
    metricKey: string;
    bestPct: number | null;
    avgPct: number | null;
    fetchedAt: string;
  }): Promise<void> {
    const now = input.fetchedAt;
    const existing = await orm.CharacterWclPerformance.where({
      characterId: input.characterId,
      zoneId: input.zoneId,
      encounterId: input.encounterId,
      difficulty: input.difficulty,
      metricKey: input.metricKey,
    }).first();

    if (existing) {
      await orm.CharacterWclPerformance.where({ id: asString((existing as Record<string, unknown>).id) }).update({
        bestPct: input.bestPct,
        avgPct: input.avgPct,
        fetchedAt: input.fetchedAt,
        updatedAt: now,
      });
      return;
    }

    await orm.CharacterWclPerformance.create({
      id: crypto.randomUUID(),
      characterId: input.characterId,
      zoneId: input.zoneId,
      encounterId: input.encounterId,
      difficulty: input.difficulty,
      metricKey: input.metricKey,
      bestPct: input.bestPct,
      avgPct: input.avgPct,
      fetchedAt: input.fetchedAt,
      createdAt: now,
      updatedAt: now,
    });
  },
};
