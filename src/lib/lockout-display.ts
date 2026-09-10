import type { RaidDifficulty } from "@/models/enums";
import { COMPACT_DIFFICULTY_LABELS } from "@/lib/blizzard/raid-difficulty";
import { findRaidCatalogById, getCurrentLockoutRaid } from "@/lib/wow-raid-catalog";

export type LockoutDisplayRow = {
  difficulty: RaidDifficulty;
  bossesDefeated: number;
  bossTotal: number;
  isComplete?: boolean;
  raidName?: string;
  verified?: boolean;
};

const TRACKED: RaidDifficulty[] = ["NORMAL", "HEROIC", "MYTHIC"];

/**
 * Compact current-reset progress. Verified difficulties show x/N; missing
 * tracked difficulties show "?" once any difficulty is verified.
 * Empty input → null (UI must render Unknown, never invent Clear).
 */
export function formatCompactLockoutProgress(rows: LockoutDisplayRow[]): string | null {
  if (rows.length === 0) return null;
  const parts = TRACKED.map((difficulty) => {
    const row = rows.find((item) => item.difficulty === difficulty);
    const label = COMPACT_DIFFICULTY_LABELS[difficulty];
    if (!row) return `${label} ?`;
    return `${label} ${row.bossesDefeated}/${row.bossTotal}`;
  });
  return parts.join(" · ");
}

export function defaultRaidBossTotal(raidId?: string): number {
  if (raidId) {
    return findRaidCatalogById(raidId)?.bosses.length ?? 0;
  }
  return getCurrentLockoutRaid()?.bosses.length ?? 0;
}
