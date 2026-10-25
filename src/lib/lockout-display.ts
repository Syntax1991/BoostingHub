import type { RaidDifficulty } from "@/models/enums";
import { COMPACT_DIFFICULTY_LABELS } from "@/lib/blizzard/raid-difficulty";
import type { LockoutBossState } from "@/lib/lockout-bosses";
import { raidContentDisplayName } from "@/lib/wow-raid-catalog";

export type LockoutDisplayRow = {
  difficulty: RaidDifficulty;
  bossesDefeated: number;
  bossTotal: number;
  isComplete?: boolean;
  raidId?: string;
  raidName?: string;
  verified?: boolean;
  /**
   * Per-boss kill flags in catalog order when `killedBossIds` is known.
   * Null → older/unknown sync — UI falls back to count-based dots, never invents kills.
   */
  bossStates?: LockoutBossState[] | null;
};

/** Authoritative current-reset raid slots from the DB catalog (`RaidCatalog.lockoutRaids`). */
export type CurrentLockoutRaidDescriptor = {
  id: string;
  name: string;
  /**
   * Catalog RaidBoss names in sortOrder.
   * Used so unverified (Unknown) difficulties can still show neutral gray dots
   * without inventing kills — never empty "Unknown" text in the Characters subrow.
   */
  bosses: readonly { name: string }[];
};

export type RaidLockoutSlot =
  | {
      raidId: string;
      raidName: string;
      bosses: readonly { name: string }[];
      status: "UNKNOWN";
    }
  | {
      raidId: string;
      raidName: string;
      bosses: readonly { name: string }[];
      status: "VERIFIED";
      rows: LockoutDisplayRow[];
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
    const bosses = raid.bosses ?? [];
    if (raidRows.length === 0) {
      return {
        raidId: raid.id,
        raidName: raid.name,
        bosses,
        status: "UNKNOWN" as const,
      };
    }
    return {
      raidId: raid.id,
      raidName: raid.name,
      bosses,
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

/** Re-export for callers that still resolve display names at the service boundary. */
export { raidContentDisplayName };

/**
 * Compact raid label for dense admin lockout cells.
 * Uses product short names when defined (e.g. Tide), otherwise a stable
 * abbreviation of the catalog display name — never invents raid identity.
 */
export function shortRaidLockoutLabel(raidId: string, raidName: string): string {
  const display = raidContentDisplayName(raidId, raidName);
  if (display !== raidName && display.length <= 12) return display;
  const cleaned = display.replace(/^The\s+/i, "").trim();
  const ofMatch = cleaned.match(/\sof\s+(.+)$/i);
  if (ofMatch?.[1] && ofMatch[1].length <= 14) return ofMatch[1].trim();
  const first = cleaned.split(/\s+/)[0];
  return first && first.length > 0 ? first : cleaned;
}
