import type { RaidDifficulty, WowRegion } from "@/models/enums";
import type { BlizzardCharacterRaidEncounters, BlizzardRaidInstanceProgress } from "@/lib/blizzard/types";
import { mapBlizzardRaidDifficulty } from "@/lib/blizzard/raid-difficulty";
import {
  getCurrentLockoutRaids,
  type WowRaidCatalogBoss,
  type WowRaidCatalogEntry,
} from "@/lib/wow-raid-catalog";
import {
  getRegionalWeeklyReset,
  isTimestampInRegionalReset,
  type RegionalWeeklyReset,
} from "@/lib/wow-weekly-reset";

const TRACKED_DIFFICULTIES: RaidDifficulty[] = ["NORMAL", "HEROIC", "MYTHIC"];

export type DerivedDifficultyLockout = {
  raidId: string;
  difficulty: RaidDifficulty;
  resetIdentifier: string;
  bossesDefeated: number;
  bossTotal: number;
  isComplete: boolean;
  verified: true;
  bosses: Array<{
    bossId: string;
    name: string;
    killedThisReset: boolean;
  }>;
};

export type DerivedRaidLockoutSnapshot = {
  raidId: string;
  blizzardInstanceId: number;
  difficulties: DerivedDifficultyLockout[];
};

export type DerivedRaidLockoutResult =
  | {
      status: "derived";
      resetIdentifier: string;
      verifiedAt: string;
      raids: DerivedRaidLockoutSnapshot[];
    }
  | { status: "unknown"; reason: string };

function matchBossByEncounterId(
  bosses: readonly WowRaidCatalogBoss[],
  encounterId: string,
): WowRaidCatalogBoss | null {
  const numericId = Number(encounterId);
  if (!Number.isFinite(numericId)) return null;
  return bosses.find((boss) => boss.blizzardEncounterIds.includes(numericId)) ?? null;
}

function findBlizzardRaidByInstanceId(
  encounters: BlizzardCharacterRaidEncounters,
  blizzardInstanceId: number,
): BlizzardRaidInstanceProgress | null {
  return (
    encounters.raids.find((raid) => Number(raid.instanceId) === blizzardInstanceId) ?? null
  );
}

function deriveDifficulty(input: {
  catalog: WowRaidCatalogEntry;
  difficulty: RaidDifficulty;
  resetIdentifier: string;
  window: RegionalWeeklyReset;
  encounters: BlizzardRaidInstanceProgress["difficulties"][number]["encounters"];
}): DerivedDifficultyLockout {
  const bossStates = input.catalog.bosses.map((boss) => ({
    bossId: boss.id,
    name: boss.name,
    killedThisReset: false,
  }));

  for (const encounter of input.encounters) {
    const boss = matchBossByEncounterId(input.catalog.bosses, encounter.encounterId);
    if (!boss) continue;
    const killed =
      encounter.lastKillTimestampMs != null &&
      isTimestampInRegionalReset(encounter.lastKillTimestampMs, input.window);
    const slot = bossStates.find((row) => row.bossId === boss.id);
    if (slot && killed) slot.killedThisReset = true;
  }

  const bossesDefeated = bossStates.filter((boss) => boss.killedThisReset).length;
  const bossTotal = input.catalog.bosses.length;
  return {
    raidId: input.catalog.id,
    difficulty: input.difficulty,
    resetIdentifier: input.resetIdentifier,
    bossesDefeated,
    bossTotal,
    isComplete: bossesDefeated >= bossTotal && bossTotal > 0,
    verified: true,
    bosses: bossStates,
  };
}

function encountersForDifficulty(
  blizzardRaid: BlizzardRaidInstanceProgress | null,
  difficulty: RaidDifficulty,
): BlizzardRaidInstanceProgress["difficulties"][number]["encounters"] {
  if (!blizzardRaid) return [];
  const mode = blizzardRaid.difficulties.find(
    (entry) => mapBlizzardRaidDifficulty(entry.difficulty) === difficulty,
  );
  return mode?.encounters ?? [];
}

function deriveRaidSnapshot(input: {
  catalog: WowRaidCatalogEntry;
  resetIdentifier: string;
  window: RegionalWeeklyReset;
  blizzardRaid: BlizzardRaidInstanceProgress | null;
}): DerivedRaidLockoutSnapshot {
  return {
    raidId: input.catalog.id,
    blizzardInstanceId: input.catalog.blizzardInstanceId,
    difficulties: TRACKED_DIFFICULTIES.map((difficulty) =>
      deriveDifficulty({
        catalog: input.catalog,
        difficulty,
        resetIdentifier: input.resetIdentifier,
        window: input.window,
        encounters: encountersForDifficulty(input.blizzardRaid, difficulty),
      }),
    ),
  };
}

/**
 * Derive a complete current-reset lockout snapshot for every catalog raid marked
 * currentForLockouts. After a successful Blizzard encounters response, every
 * tracked difficulty (NORMAL/HEROIC/MYTHIC) is verified — missing raids or modes
 * become explicit 0/N. Callers must not invoke this on a failed request.
 */
export function deriveCurrentResetLockouts(input: {
  region: WowRegion;
  encounters: BlizzardCharacterRaidEncounters;
  now?: Date;
  resetWindow?: RegionalWeeklyReset;
}): DerivedRaidLockoutResult {
  const window = input.resetWindow ?? getRegionalWeeklyReset(input.region, input.now ?? new Date());
  const verifiedAt = (input.now ?? new Date()).toISOString();
  const currentRaids = getCurrentLockoutRaids();

  if (currentRaids.length === 0) {
    return { status: "unknown", reason: "No catalog raid is marked currentForLockouts." };
  }

  const raids = currentRaids.map((catalog) =>
    deriveRaidSnapshot({
      catalog,
      resetIdentifier: window.resetIdentifier,
      window,
      blizzardRaid: findBlizzardRaidByInstanceId(input.encounters, catalog.blizzardInstanceId),
    }),
  );

  return {
    status: "derived",
    resetIdentifier: window.resetIdentifier,
    verifiedAt,
    raids,
  };
}
