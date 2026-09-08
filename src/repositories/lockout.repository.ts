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
};
