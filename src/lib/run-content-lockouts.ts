import type { RaidDifficulty, RunLootType } from "@/models/enums";
import type { SignupRaidSaveInfo } from "@/models/records";
import { DIFFICULTY_ABBREVIATIONS } from "@/lib/labels";
import {
  formatTargetRaidLockoutLabel,
  type RaidLockoutLabel,
} from "@/lib/raid-lockout-label";
import { raidContentDisplayName } from "@/lib/wow-raid-catalog";
import { lockoutBossBreakdown, type LockoutBossState, type RaidBossRef } from "@/lib/lockout-bosses";
import type { RunRaidContentRecord } from "@/repositories/run.repository";

/**
 * Per-content informational lockout for a Run participant.
 * Tooltip / Discord keep one entry per RunRaidContent. Signup tiles use
 * {@link formatSignupTileLockoutShort} to sum progress across the Bundle.
 */
export type RunContentRaidSaveInfo = {
  raidId: string;
  /** Compact product-facing label (Tidebound → "Tide"). */
  raidName: string;
  /** The content's full DB Raid name ("The Tidebound Grotto") for confirmation dialogs. */
  raidFullName: string;
  sortOrder: number;
  plannedBossCount: number;
  totalBossCount: number;
  raidSave: SignupRaidSaveInfo | null;
  label: RaidLockoutLabel;
  /** Per-boss kill state for the tooltip; null when unknown (no save, or synced before boss tracking). */
  bosses: LockoutBossState[] | null;
};

export type LockoutMatchInput = {
  raidId: string;
  difficulty: RaidDifficulty;
  resetIdentifier: string;
  bossesDefeated: number;
  totalBossCount: number;
  isComplete: boolean;
};

/**
 * Project ordered Run contents into per-raid lockout labels.
 * `findSave` returns the verified row for that content, or null (Unknown).
 */
export function projectRunContentLockouts(input: {
  contents: ReadonlyArray<
    Pick<RunRaidContentRecord, "raidId" | "raidName" | "sortOrder" | "plannedBossCount" | "totalBossCount"> & {
      /** The content raid's RaidBoss rows (already loaded with the content). */
      bosses: readonly RaidBossRef[];
    }
  >;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  findSave: (content: { raidId: string; totalBossCount: number }) => SignupRaidSaveInfo | null;
}): RunContentRaidSaveInfo[] {
  const ordered = [...input.contents].sort((a, b) => a.sortOrder - b.sortOrder);
  return ordered.map((content) => {
    const raidSave = input.findSave({
      raidId: content.raidId,
      totalBossCount: content.totalBossCount,
    });
    const label = formatTargetRaidLockoutLabel({
      difficulty: input.difficulty,
      totalBossCount: content.totalBossCount,
      raidSave,
      lootType: input.lootType,
    });
    return {
      raidId: content.raidId,
      raidName: raidContentDisplayName(content.raidId, content.raidName),
      raidFullName: content.raidName,
      sortOrder: content.sortOrder,
      plannedBossCount: content.plannedBossCount,
      totalBossCount: content.totalBossCount,
      raidSave,
      label,
      bosses: raidSave ? lockoutBossBreakdown(content.bosses, raidSave.killedBossIds) : null,
    };
  });
}

/**
 * Whether a verified save keeps this Character from fresh loot on the bosses
 * the Run actually plans (the first `plannedBossCount` in boss order — the
 * same planned-boss rule as roster-saved-notice). Null save (Unknown) or no
 * progress → false.
 *
 * - Normal / Heroic lock loot per boss: only a kill on a planned boss counts
 *   (6/8 Run, only boss 8 killed → not relevant).
 * - Mythic binds the Character to one raid ID: any kill in that content
 *   keeps it out of a fresh instance (why MYTHIC + SAVED Runs do not exist).
 * - Full clear always counts. A save whose killed bosses are unknown (older
 *   sync, no boss list) counts too — irrelevance is never guessed from a count.
 * - The boss list only proves a save harmless when it accounts for every
 *   verified kill: as many recognised catalog bosses killed as
 *   `bossesDefeated`. A shorter or unrecognised list (ids dropped by a catalog
 *   merge, ids outside this content's catalog, a list left from an earlier
 *   sync) counts as relevant. Kills only accumulate within a reset, so a
 *   complete count also means the list is the exact set.
 */
export function isSaveRelevantToPlannedBosses(row: RunContentRaidSaveInfo): boolean {
  const save = row.raidSave;
  if (!save) return false;
  const full = save.isComplete || save.bossesDefeated >= save.totalBossCount;
  if (save.bossesDefeated === 0 && !full) return false;
  if (full || save.difficulty === "MYTHIC" || !row.bosses) return true;
  const knownKills = row.bosses.filter((boss) => boss.killed).length;
  if (knownKills !== save.bossesDefeated) return true;
  return row.bosses.slice(0, row.plannedBossCount).some((boss) => boss.killed);
}

/** Aggregate attention: true if ANY content needs operational attention. */
export function contentLockoutsNeedAttention(rows: readonly RunContentRaidSaveInfo[]): boolean {
  return rows.some((row) => row.label.attention);
}

/** Compact multi-line or single-line secondary metadata for UI cards. */
export function formatContentLockoutLines(rows: readonly RunContentRaidSaveInfo[]): string[] {
  return rows.map((row) => `${row.raidName}: ${row.label.text}`);
}

/**
 * Compact Signup-tile lockout: summed progress across every RunRaidContent.
 * Season Complete Bundle (Venomous 8 + Tide 1 + Kith'ix 1) → `HC 10/10`, not
 * a single raid's `HC 8/8 · Fully saved`.
 *
 * - No "Unsaved" / "Saved" / "Fully saved" suffixes (too long; redundant).
 * - All verified 0 kills → null (quiet; do not show `0/10 · Unsaved`).
 * - All unknown → null (quiet unless the caller already flags attention).
 * - Mixed unknown + known → known kills over the full content boss total.
 */
export function formatSignupTileLockoutShort(
  rows: readonly RunContentRaidSaveInfo[],
  difficulty: RaidDifficulty,
): string | null {
  if (rows.length === 0) return null;

  let defeated = 0;
  let total = 0;
  let known = 0;
  for (const row of rows) {
    total += row.totalBossCount;
    if (!row.raidSave) continue;
    known += 1;
    defeated += row.raidSave.bossesDefeated;
  }

  if (known === 0 || total <= 0) return null;
  if (defeated === 0) return null;

  return `${DIFFICULTY_ABBREVIATIONS[difficulty]} ${defeated}/${total}`;
}

/**
 * Hover text for a lockout line: which bosses this Character already killed
 * this reset (✓) and which are still open (✗), one line per Run content.
 */
export function formatContentLockoutTooltip(rows: readonly RunContentRaidSaveInfo[]): string {
  return rows
    .map((row) => {
      if (!row.raidSave) return `${row.raidName}: lockout unknown`;
      if (!row.bosses) return `${row.raidName}: boss details after the next character sync`;
      return `${row.raidName}: ${row.bosses.map((boss) => `${boss.killed ? "✓" : "✗"} ${boss.name}`).join(" · ")}`;
    })
    .join("\n");
}
