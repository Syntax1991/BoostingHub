import type { RaidDifficulty } from "@/models/enums";
import { COMPACT_DIFFICULTY_LABELS } from "@/lib/blizzard/raid-difficulty";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";

export type LockoutDisplayRow = {
  difficulty: RaidDifficulty;
  bossesDefeated: number;
  bossTotal: number;
  isComplete?: boolean;
  raidName?: string;
};

/**
 * Compact current-reset progress line. Empty input means unverified/unknown —
 * callers must render "Unknown", never invent Clear.
 */
export function formatCompactLockoutProgress(rows: LockoutDisplayRow[]): string | null {
  if (rows.length === 0) return null;
  const order: RaidDifficulty[] = ["NORMAL", "HEROIC", "MYTHIC"];
  const parts = order.flatMap((difficulty) => {
    const row = rows.find((item) => item.difficulty === difficulty);
    if (!row) return [];
    return [`${COMPACT_DIFFICULTY_LABELS[difficulty]} ${row.bossesDefeated}/${row.bossTotal}`];
  });
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function defaultRaidBossTotal(raidId?: string): number {
  const raid = raidId
    ? WOW_RAID_CATALOG.find((entry) => entry.id === raidId)
    : WOW_RAID_CATALOG[0];
  return raid?.bosses.length ?? 0;
}
