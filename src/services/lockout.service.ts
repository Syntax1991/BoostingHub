import type { RaidDifficulty } from "@/models/enums";
import { resetIdentifierFor } from "@/lib/datetime";
import { lockoutRepository } from "@/repositories/lockout.repository";

type LockoutProgress = {
  isComplete: boolean;
  bossesDefeated: number;
};

/**
 * Lockouts are reset-scoped rather than stored on the character, because Heroic
 * and Mythic eligibility must be evaluated independently for the same raid week.
 */
export const lockoutService = {
  isProgressLockout(lockout: LockoutProgress): boolean {
    return lockout.isComplete || lockout.bossesDefeated > 0;
  },

  hasRunConflict(
    lockouts: Array<{
      raidId: string;
      difficulty: RaidDifficulty;
      resetIdentifier: string;
      isComplete: boolean;
      bossesDefeated: number;
    }>,
    input: { raidId: string; difficulty: RaidDifficulty; resetIdentifier: string },
  ): boolean {
    return lockouts.some(
      (lockout) =>
        lockout.raidId === input.raidId &&
        lockout.difficulty === input.difficulty &&
        lockout.resetIdentifier === input.resetIdentifier &&
        this.isProgressLockout(lockout),
    );
  },

  async hasConflictingLockout(input: {
    characterId: string;
    raidId: string;
    difficulty: RaidDifficulty;
    resetIdentifier?: string;
  }): Promise<boolean> {
    const conflict = await lockoutRepository.findConflict({
      characterId: input.characterId,
      raidId: input.raidId,
      difficulty: input.difficulty,
      resetIdentifier: input.resetIdentifier ?? resetIdentifierFor(),
    });

    if (!conflict) {
      return false;
    }

    const row = conflict as Record<string, unknown>;
    return this.isProgressLockout({
      isComplete: row.isComplete === true,
      bossesDefeated: typeof row.bossesDefeated === "number" ? row.bossesDefeated : 0,
    });
  },

  summarize(lockouts: Array<{
    raid: { name: string };
    difficulty: RaidDifficulty;
    resetIdentifier: string;
    isComplete: boolean;
    bossesDefeated: number;
  }>) {
    return lockouts.map((lockout) => ({
      raidName: lockout.raid.name,
      difficulty: lockout.difficulty,
      resetIdentifier: lockout.resetIdentifier,
      isComplete: lockout.isComplete,
      bossesDefeated: lockout.bossesDefeated,
      attention: this.isProgressLockout(lockout),
    }));
  },
};
