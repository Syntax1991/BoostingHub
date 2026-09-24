import type { RaidDifficulty, RunLootType } from "@/models/enums";
import type { SignupRaidSaveInfo } from "@/models/records";
import {
  formatTargetRaidLockoutLabel,
  type RaidLockoutLabel,
} from "@/lib/raid-lockout-label";
import { raidContentDisplayName } from "@/lib/wow-raid-catalog";
import { lockoutBossBreakdown, type LockoutBossState } from "@/lib/lockout-bosses";
import type { RunRaidContentRecord } from "@/repositories/run.repository";

/**
 * Per-content informational lockout for a Run participant.
 * Bundle Runs expose one entry per RunRaidContent — never an aggregated 9/9.
 */
export type RunContentRaidSaveInfo = {
  raidId: string;
  raidName: string;
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
    Pick<RunRaidContentRecord, "raidId" | "raidName" | "sortOrder" | "plannedBossCount" | "totalBossCount">
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
      sortOrder: content.sortOrder,
      plannedBossCount: content.plannedBossCount,
      totalBossCount: content.totalBossCount,
      raidSave,
      label,
      bosses: raidSave ? lockoutBossBreakdown(content.raidId, raidSave.killedBossIds) : null,
    };
  });
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
