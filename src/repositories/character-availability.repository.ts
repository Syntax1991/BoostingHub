/**
 * DEPRECATED / INERT — CharacterAvailabilityBlock is no longer part of active
 * BoostingHub scheduling. Table may remain; do not call from product paths.
 */
import { randomUUID } from "node:crypto";
import { orm } from "@/lib/prisma";
import { asString, asStringOrNull } from "@/lib/persistence";

export type CharacterAvailabilityBlockRecord = {
  id: string;
  characterId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CharacterAvailabilityBlockWriteInput = {
  characterId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
};

function mapBlock(row: Record<string, unknown>): CharacterAvailabilityBlockRecord {
  return {
    id: asString(row.id),
    characterId: asString(row.characterId),
    startsAt: asString(row.startsAt),
    endsAt: asString(row.endsAt),
    reason: asStringOrNull(row.reason),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  };
}

export const characterAvailabilityRepository = {
  async listByCharacterId(characterId: string): Promise<CharacterAvailabilityBlockRecord[]> {
    return this.listByCharacterIds([characterId]);
  },

  /**
   * Batched read for Character list / multi-character surfaces.
   * One query for all ids; empty input â†’ []. Sorted startsAt, endsAt, id.
   */
  async listByCharacterIds(characterIds: string[]): Promise<CharacterAvailabilityBlockRecord[]> {
    if (characterIds.length === 0) {
      return [];
    }
    const uniqueIds = [...new Set(characterIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return [];
    }
    const rows = await orm.CharacterAvailabilityBlock
      .where((f) => f.characterId.in(uniqueIds))
      .all();
    return (rows as Record<string, unknown>[])
      .map(mapBlock)
      .sort(
        (a, b) =>
          a.startsAt.localeCompare(b.startsAt) ||
          a.endsAt.localeCompare(b.endsAt) ||
          a.id.localeCompare(b.id),
      );
  },

  async findById(blockId: string): Promise<CharacterAvailabilityBlockRecord | null> {
    const row = await orm.CharacterAvailabilityBlock.where({ id: blockId }).first();
    return row ? mapBlock(row as Record<string, unknown>) : null;
  },

  /**
   * Blocks that cover a Run start for any of the given Characters:
   * startsAt <= runStartAt < endsAt.
   */
  async findBlockingForRun(input: {
    characterIds: string[];
    runStartAt: string;
  }): Promise<CharacterAvailabilityBlockRecord[]> {
    if (input.characterIds.length === 0) {
      return [];
    }
    const rows = await this.listByCharacterIds(input.characterIds);
    const runMs = new Date(input.runStartAt).getTime();
    return rows.filter((block) => {
      const startMs = new Date(block.startsAt).getTime();
      const endMs = new Date(block.endsAt).getTime();
      return startMs <= runMs && runMs < endMs;
    });
  },

  async create(input: CharacterAvailabilityBlockWriteInput): Promise<CharacterAvailabilityBlockRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await orm.CharacterAvailabilityBlock.create({
      id,
      characterId: input.characterId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: input.reason,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.findById(id);
    if (!created) {
      throw new Error("CharacterAvailabilityBlock create did not persist.");
    }
    return created;
  },

  async update(
    blockId: string,
    input: Omit<CharacterAvailabilityBlockWriteInput, "characterId">,
  ): Promise<CharacterAvailabilityBlockRecord> {
    await orm.CharacterAvailabilityBlock.where({ id: blockId }).update({
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: input.reason,
      updatedAt: new Date().toISOString(),
    });
    const updated = await this.findById(blockId);
    if (!updated) {
      throw new Error("CharacterAvailabilityBlock update did not persist.");
    }
    return updated;
  },

  async delete(blockId: string): Promise<void> {
    await orm.CharacterAvailabilityBlock.where({ id: blockId }).delete();
  },
};

