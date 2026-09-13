import type { RaidDifficulty, WowRegion } from "@/models/enums";
import { resetIdentifierFor } from "@/lib/datetime";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { lockoutRepository } from "@/repositories/lockout.repository";
import type { SignupRaidSaveInfo } from "@/models/records";

type LockoutProgress = {
  isComplete: boolean;
  bossesDefeated: number;
};

type ExactRaidLockout = {
  raidId: string;
  difficulty: RaidDifficulty;
  resetIdentifier: string;
  isComplete: boolean;
  bossesDefeated: number;
};

/**
 * Lockouts are reset-scoped rather than stored on the character, because Heroic
 * and Mythic eligibility must be evaluated independently for the same raid week.
 */
export const lockoutService = {
  /**
   * Target reset for a Character participating in a Run: the Character's
   * regional WoW reset window that contains `scheduledStartAt`. Identifiers
   * remain `resetIdentifierFor(resetStart)` — never the ISO week of the Run
   * wall-clock alone (Monday/Tuesday EU Runs still belong to the prior Wednesday).
   */
  getResetIdentifierForRun(characterRegion: WowRegion, scheduledStartAt: Date | string): string {
    return getRegionalWeeklyReset(characterRegion, new Date(scheduledStartAt)).resetIdentifier;
  },

  isProgressLockout(lockout: LockoutProgress): boolean {
    return lockout.isComplete || lockout.bossesDefeated > 0;
  },

  /**
   * Exact character + raid + difficulty + reset row, including verified 0/x.
   * Absence means unverified/unknown — never invent 0/x.
   */
  findExactLockout(
    lockouts: ExactRaidLockout[],
    input: { raidId: string; difficulty: RaidDifficulty; resetIdentifier: string },
  ): ExactRaidLockout | null {
    return (
      lockouts.find(
        (item) =>
          item.raidId === input.raidId &&
          item.difficulty === input.difficulty &&
          item.resetIdentifier === input.resetIdentifier,
      ) ?? null
    );
  },

  toRaidSaveInfo(
    lockout: ExactRaidLockout,
    totalBossCount: number,
  ): SignupRaidSaveInfo {
    return {
      raidId: lockout.raidId,
      difficulty: lockout.difficulty,
      resetIdentifier: lockout.resetIdentifier,
      bossesDefeated: lockout.bossesDefeated,
      totalBossCount,
      isComplete: lockout.isComplete,
    };
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
