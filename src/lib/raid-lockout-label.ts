import type { RaidDifficulty, RunLootType } from "@/models/enums";
import type { SignupRaidSaveInfo } from "@/models/records";
import { DIFFICULTY_ABBREVIATIONS } from "@/lib/labels";

/**
 * UNSAVED and VIP both care about "fresh" raid progress for the target
 * difficulty. SAVED does not treat existing progress as attention/error.
 */
export function requiresFreshRaidLockout(lootType: RunLootType): boolean {
  return lootType === "UNSAVED" || lootType === "VIP";
}

export type RaidLockoutLabelKind = "unsaved" | "saved" | "fully_saved" | "unknown";

export type RaidLockoutLabel = {
  kind: RaidLockoutLabelKind;
  /** e.g. "HC 0/8 · Unsaved" — always includes difficulty + text status. */
  text: string;
  /**
   * When the Run loot type requires a fresh lockout, progress and unknown
   * need operational attention. Never used as a hard eligibility blocker.
   */
  attention: boolean;
};

function difficultyAbbrev(difficulty: RaidDifficulty): string {
  return DIFFICULTY_ABBREVIATIONS[difficulty];
}

/**
 * Formats verified target-run lockout progress, or Unknown when no verified
 * row exists for the exact raid/difficulty/regional reset.
 */
export function formatTargetRaidLockoutLabel(input: {
  difficulty: RaidDifficulty;
  totalBossCount: number;
  raidSave: SignupRaidSaveInfo | null;
  lootType?: RunLootType;
}): RaidLockoutLabel {
  const fresh = input.lootType ? requiresFreshRaidLockout(input.lootType) : false;
  const abbrev = difficultyAbbrev(input.difficulty);

  if (!input.raidSave) {
    return {
      kind: "unknown",
      text: `${abbrev} ?/${input.totalBossCount} · Unknown`,
      attention: fresh,
    };
  }

  const progress = `${abbrev} ${input.raidSave.bossesDefeated}/${input.raidSave.totalBossCount}`;
  if (input.raidSave.bossesDefeated === 0 && !input.raidSave.isComplete) {
    return {
      kind: "unsaved",
      text: `${progress} · Unsaved`,
      attention: false,
    };
  }
  if (input.raidSave.isComplete || input.raidSave.bossesDefeated >= input.raidSave.totalBossCount) {
    return {
      kind: "fully_saved",
      text: `${progress} · Fully saved`,
      attention: fresh,
    };
  }
  return {
    kind: "saved",
    text: `${progress} · Saved`,
    attention: fresh,
  };
}
