import type { RaidDifficulty } from "@/models/enums";
import { COMPACT_DIFFICULTY_LABELS } from "@/lib/blizzard/raid-difficulty";
import { findRaidCatalogById, getCurrentLockoutRaid, raidContentDisplayName } from "@/lib/wow-raid-catalog";

export type LockoutDisplayRow = {
  difficulty: RaidDifficulty;
  bossesDefeated: number;
  bossTotal: number;
  isComplete?: boolean;
  raidId?: string;
  raidName?: string;
  verified?: boolean;
};

const TRACKED: RaidDifficulty[] = ["NORMAL", "HEROIC", "MYTHIC"];

/**
 * Compact current-reset progress for a single raid. Verified difficulties show
 * x/N; missing tracked difficulties show "?" once any difficulty is verified.
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

/**
 * Multi-raid compact progress: one segment per raid, never merged across raids.
 * Example: `Nymrissa: HC 1/1 · The Venomous Abyss: N 8/8 · HC 3/8 · M ?`
 */
export function formatCompactMultiRaidLockoutProgress(rows: LockoutDisplayRow[]): string | null {
  if (rows.length === 0) return null;

  const order: string[] = [];
  const byRaid = new Map<string, { label: string; rows: LockoutDisplayRow[] }>();

  for (const row of rows) {
    const key = row.raidId ?? row.raidName ?? "raid";
    if (!byRaid.has(key)) {
      order.push(key);
      const label =
        row.raidId && row.raidName
          ? raidContentDisplayName(row.raidId, row.raidName)
          : row.raidName ?? "Raid";
      byRaid.set(key, { label, rows: [] });
    }
    byRaid.get(key)!.rows.push(row);
  }

  const parts = order
    .map((key) => {
      const group = byRaid.get(key)!;
      const progress = formatCompactLockoutProgress(group.rows);
      return progress ? `${group.label}: ${progress}` : null;
    })
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" · ") : null;
}

export function defaultRaidBossTotal(raidId?: string): number {
  if (raidId) {
    return findRaidCatalogById(raidId)?.bosses.length ?? 0;
  }
  return getCurrentLockoutRaid()?.bosses.length ?? 0;
}
