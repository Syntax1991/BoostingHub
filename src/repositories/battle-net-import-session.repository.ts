import { orm } from "@/lib/prisma";
import { asString, asStringOrNull, mapRegion } from "@/lib/persistence";
import type { OwnedBlizzardCharacter } from "@/lib/blizzard/types";
import type { WowRegion } from "@/models/enums";

export type BattleNetImportSessionRecord = {
  id: string;
  userId: string;
  region: ReturnType<typeof mapRegion>;
  characters: OwnedBlizzardCharacter[];
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

function parseCharactersJson(raw: string): OwnedBlizzardCharacter[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as OwnedBlizzardCharacter[]) : [];
  } catch {
    return [];
  }
}

function mapSession(row: Record<string, unknown>): BattleNetImportSessionRecord {
  return {
    id: asString(row.id),
    userId: asString(row.userId),
    region: mapRegion(row.region),
    characters: parseCharactersJson(asString(row.charactersJson, "[]")),
    expiresAt: asString(row.expiresAt),
    consumedAt: asStringOrNull(row.consumedAt),
    createdAt: asString(row.createdAt),
  };
}

export const battleNetImportSessionRepository = {
  async findById(sessionId: string): Promise<BattleNetImportSessionRecord | null> {
    const row = await orm.BattleNetImportSession.where({ id: sessionId }).first();
    return row ? mapSession(row as Record<string, unknown>) : null;
  },

  async findOwnedById(
    userId: string,
    sessionId: string,
  ): Promise<BattleNetImportSessionRecord | null> {
    const row = await orm.BattleNetImportSession.where({ id: sessionId, userId }).first();
    return row ? mapSession(row as Record<string, unknown>) : null;
  },

  async create(input: {
    userId: string;
    region: WowRegion;
    characters: OwnedBlizzardCharacter[];
    expiresAt: string;
  }): Promise<BattleNetImportSessionRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await orm.BattleNetImportSession.create({
      id,
      userId: input.userId,
      region: input.region,
      charactersJson: JSON.stringify(input.characters),
      expiresAt: input.expiresAt,
      consumedAt: null,
      createdAt: now,
    });

    const created = await this.findById(id);
    if (!created) {
      throw new Error("BattleNetImportSession create did not persist.");
    }
    return created;
  },

  async markConsumed(sessionId: string): Promise<void> {
    await orm.BattleNetImportSession.where({ id: sessionId }).update({
      consumedAt: new Date().toISOString(),
    });
  },

  async deleteByUserAndRegion(userId: string, region: WowRegion): Promise<void> {
    const rows = await orm.BattleNetImportSession.where({ userId, region }).all();
    for (const row of rows) {
      await orm.BattleNetImportSession.where({ id: asString((row as Record<string, unknown>).id) }).delete();
    }
  },
};
