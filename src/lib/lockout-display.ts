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
  verified?: boolean;
};

/** Authoritative current-reset raid slots from `getCurrentLockoutRaids()`. */
export type CurrentLockoutRaidDescriptor = {
  id: string;
  name: string;
};

export type RaidLockoutSlot =
  | { raidId: string; raidName: string; status: "UNKNOWN" }
  | { raidId: string; raidName: string; status: "VERIFIED"; rows: LockoutDisplayRow[] };

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
 * Project every authoritative current raid in catalog order.
 * Raids with zero current-reset rows are UNKNOWN — never invented as 0/N.
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

  return currentRaids.map((raid) => {
    const raidRows = byRaidId.get(raid.id) ?? [];
    if (raidRows.length === 0) {
      return { raidId: raid.id, raidName: raid.name, status: "UNKNOWN" as const };
    }
    return {
      raidId: raid.id,
      raidName: raid.name,
      status: "VERIFIED" as const,
      rows: raidRows,
    };
  });
}

/**
 * Multi-raid compact progress for Character list cells.
 * Always emits one segment per `currentRaids` entry in that order.
 * Fully missing raid → `<Name>: Unknown` (never omit the raid; never invent 0/N).
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
      if (slot.status === "UNKNOWN") {
        return `${slot.raidName}: Unknown`;
      }
      const progress = formatCompactLockoutProgress(slot.rows);
      return progress ? `${slot.raidName}: ${progress}` : `${slot.raidName}: Unknown`;
    })
    .join(" · ");
}

/** Catalog boss count for an explicit raid id — never an implicit "current" raid. */
export function defaultRaidBossTotal(raidId: string): number {
  return findRaidCatalogById(raidId)?.bosses.length ?? 0;
}

/** Re-export for callers that still resolve display names at the service boundary. */
export { raidContentDisplayName };
