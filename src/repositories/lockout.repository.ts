import { orm } from "@/lib/prisma";
import type { RaidDifficulty } from "@/models/enums";
import { getCurrentLockoutRaids } from "@/lib/wow-raid-catalog";

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
   * Replace verified current-reset lockout rows for the current lockout raid.
   * - Upserts verified difficulties only
   * - Deletes unverified difficulties for that raid+reset (so missing modes stay Unknown)
   * - Clears same-reset rows for non-current catalog raids (stale mapping cleanup)
   */
  async replaceVerifiedCurrentResetLockouts(
    characterId: string,
    input: {
      raidId: string;
      resetIdentifier: string;
      rows: Array<{
        difficulty: RaidDifficulty;
        bossesDefeated: number;
        isComplete: boolean;
      }>;
      verifiedAt: string;
    },
  ): Promise<void> {
    const verifiedDifficulties = new Set(input.rows.map((row) => row.difficulty));

    for (const row of input.rows) {
      const existing = await this.findConflict({
        characterId,
        raidId: input.raidId,
        difficulty: row.difficulty,
        resetIdentifier: input.resetIdentifier,
      });

      if (existing) {
        const id = String((existing as Record<string, unknown>).id);
        await orm.CharacterRaidLockout.where({ id }).update({
          bossesDefeated: row.bossesDefeated,
          isComplete: row.isComplete,
          updatedAt: input.verifiedAt,
        });
        continue;
      }

      await orm.CharacterRaidLockout.create({
        id: crypto.randomUUID(),
        characterId,
        raidId: input.raidId,
        difficulty: row.difficulty,
        resetIdentifier: input.resetIdentifier,
        bossesDefeated: row.bossesDefeated,
        isComplete: row.isComplete,
        createdAt: input.verifiedAt,
        updatedAt: input.verifiedAt,
      });
    }

    const sameRaidReset = await orm.CharacterRaidLockout
      .where({
        characterId,
        raidId: input.raidId,
        resetIdentifier: input.resetIdentifier,
      })
      .all();

    for (const existing of sameRaidReset) {
      const difficulty = String((existing as Record<string, unknown>).difficulty) as RaidDifficulty;
      if (verifiedDifficulties.has(difficulty)) continue;
      await orm.CharacterRaidLockout.where({ id: String((existing as Record<string, unknown>).id) }).delete();
    }

    const currentRaidIds = new Set(getCurrentLockoutRaids().map((raid) => raid.id));
    const sameReset = await orm.CharacterRaidLockout
      .where({
        characterId,
        resetIdentifier: input.resetIdentifier,
      })
      .all();

    for (const existing of sameReset) {
      const raidId = String((existing as Record<string, unknown>).raidId);
      if (currentRaidIds.has(raidId)) continue;
      await orm.CharacterRaidLockout.where({ id: String((existing as Record<string, unknown>).id) }).delete();
    }
  },
};
