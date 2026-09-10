import { orm } from "@/lib/prisma";
import type { RaidDifficulty } from "@/models/enums";

export const lockoutRepository = {
  async listByCharacterIds(characterIds: string[]) {
    if (characterIds.length === 0) {
      return [];
    }

    return orm.CharacterRaidLockout
      .where((lockout) => lockout.characterId.in(characterIds))
      .include("raid")
      .all();
  },

  async findConflict(input: {
    characterId: string;
    raidId: string;
    difficulty: RaidDifficulty;
    resetIdentifier: string;
  }) {
    return orm.CharacterRaidLockout
      .where({
        characterId: input.characterId,
        raidId: input.raidId,
        difficulty: input.difficulty,
        resetIdentifier: input.resetIdentifier,
      })
      .first();
  },

  /**
   * Upsert Blizzard-derived current-reset aggregate lockout rows.
   * Does not delete older resets; callers filter by resetIdentifier for display.
   */
  async upsertCurrentResetLockouts(
    characterId: string,
    rows: Array<{
      raidId: string;
      difficulty: RaidDifficulty;
      resetIdentifier: string;
      bossesDefeated: number;
      isComplete: boolean;
    }>,
    verifiedAt: string,
  ): Promise<void> {
    for (const row of rows) {
      const existing = await this.findConflict({
        characterId,
        raidId: row.raidId,
        difficulty: row.difficulty,
        resetIdentifier: row.resetIdentifier,
      });

      if (existing) {
        const id = String((existing as Record<string, unknown>).id);
        await orm.CharacterRaidLockout.where({ id }).update({
          bossesDefeated: row.bossesDefeated,
          isComplete: row.isComplete,
          updatedAt: verifiedAt,
        });
        continue;
      }

      await orm.CharacterRaidLockout.create({
        id: crypto.randomUUID(),
        characterId,
        raidId: row.raidId,
        difficulty: row.difficulty,
        resetIdentifier: row.resetIdentifier,
        bossesDefeated: row.bossesDefeated,
        isComplete: row.isComplete,
        createdAt: verifiedAt,
        updatedAt: verifiedAt,
      });
    }
  },
};
