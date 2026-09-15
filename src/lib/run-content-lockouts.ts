import type { RaidDifficulty, RunLootType } from "@/models/enums";
import type { SignupRaidSaveInfo } from "@/models/records";
import {
  formatTargetRaidLockoutLabel,
  type RaidLockoutLabel,
} from "@/lib/raid-lockout-label";
import { raidContentDisplayName } from "@/lib/wow-raid-catalog";
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
