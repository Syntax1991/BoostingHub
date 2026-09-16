import type { RaidDifficulty } from "@/models/enums";
import { COMPACT_DIFFICULTY_LABELS } from "@/lib/blizzard/raid-difficulty";
import { findRaidCatalogById, raidContentDisplayName } from "@/lib/wow-raid-catalog";

export type LockoutDisplayRow = {
  difficulty: RaidDifficulty;
  bossesDefeated: number;
  bossTotal: number;
  isComplete?: boolean;
  raidId?: string;
  raidName?: string;
  /** true when backed by a persisted current-reset row; false for display-only zero fill. */
  verified?: boolean;
};

/** Authoritative current-reset raid slots from `getCurrentLockoutRaids()`. */
export type CurrentLockoutRaidDescriptor = {
  id: string;
  name: string;
};

/** Every current raid with NORMAL/HEROIC/MYTHIC rows (persisted or zero-filled). */
export type RaidLockoutSlot = {
  raidId: string;
  raidName: string;
  rows: LockoutDisplayRow[];
};

const TRACKED: RaidDifficulty[] = ["NORMAL", "HEROIC", "MYTHIC"];

/**
 * Compact progress for an already-projected difficulty set.
 * Missing difficulties in the input still show "?" (Blizzard derivation callers).
 * Character list/detail always pass a complete projected set from
 * {@link projectCurrentRaidLockoutSlots}, so zeros appear there instead.
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

function projectRaidDifficulties(
  raid: CurrentLockoutRaidDescriptor,
  persisted: readonly LockoutDisplayRow[],
): LockoutDisplayRow[] {
  const bossTotal = defaultRaidBossTotal(raid.id);
  const byDifficulty = new Map(persisted.map((row) => [row.difficulty, row]));

  return TRACKED.map((difficulty) => {
    const existing = byDifficulty.get(difficulty);
    if (existing) {
      return {
        ...existing,
        raidId: raid.id,
        raidName: raid.name,
        bossTotal: existing.bossTotal || bossTotal,
        verified: existing.verified ?? true,
      };
    }
    return {
      raidId: raid.id,
      raidName: raid.name,
      difficulty,
      bossesDefeated: 0,
      bossTotal,
      isComplete: false,
      verified: false,
    };
  });
}

/**
 * Project every authoritative current raid in catalog order.
 * Missing current-reset difficulties are display-filled as 0/N — never persisted.
 */
export function projectCurrentRaidLockoutSlots(
  rows: LockoutDisplayRow[],
  currentRaids: readonly CurrentLockoutRaidDescriptor[],
): RaidLockoutSlot[] {
  const byRaidId = new Map<string, LockoutDisplayRow[]>();
  for (const row of rows) {
    if (!row.raidId) continue;
    const bucket = byRaidId.get(row.raidId);
    if (bucket) bucket.push(row);
    else byRaidId.set(row.raidId, [row]);
  }

  return currentRaids.map((raid) => ({
    raidId: raid.id,
    raidName: raid.name,
    rows: projectRaidDifficulties(raid, byRaidId.get(raid.id) ?? []),
  }));
}

/**
 * Multi-raid compact progress for Character list cells.
 * Always emits one segment per `currentRaids` entry in that order, with
 * zero-filled missing difficulties.
 */
export function formatCompactMultiRaidLockoutProgress(
  rows: LockoutDisplayRow[],
  currentRaids: readonly CurrentLockoutRaidDescriptor[],
): string {
  if (currentRaids.length === 0) {
    return "Unknown";
  }

  return projectCurrentRaidLockoutSlots(rows, currentRaids)
    .map((slot) => {
      const progress = formatCompactLockoutProgress(slot.rows);
      return `${slot.raidName}: ${progress ?? "N 0/0 · HC 0/0 · M 0/0"}`;
    })
    .join(" · ");
}

/** Catalog boss count for an explicit raid id — never an implicit "current" raid. */
export function defaultRaidBossTotal(raidId: string): number {
  return findRaidCatalogById(raidId)?.bosses.length ?? 0;
}

/** Re-export for callers that still resolve display names at the service boundary. */
export { raidContentDisplayName };
