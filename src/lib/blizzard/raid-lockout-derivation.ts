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

export type DerivedRaidLockoutResult =
  | {
      status: "derived";
      difficulties: DerivedDifficultyLockout[];
      verifiedAt: string;
      currentRaidId: string;
      currentBlizzardInstanceId: number;
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

/**
 * Derive current-reset lockouts for explicitly marked current catalog raids.
 * Only difficulties present in the Blizzard response are verified.
 * Missing current raid or missing difficulty → unknown for that scope (never invent 0/N).
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

  const difficulties: DerivedDifficultyLockout[] = [];
  let matchedCurrent: WowRaidCatalogEntry | null = null;

  for (const catalog of currentRaids) {
    const blizzardRaid = findBlizzardRaidByInstanceId(input.encounters, catalog.blizzardInstanceId);
    if (!blizzardRaid) continue;
    matchedCurrent = catalog;

    for (const mode of blizzardRaid.difficulties) {
      const difficulty = mapBlizzardRaidDifficulty(mode.difficulty);
      if (!difficulty) continue;

      difficulties.push(
        deriveDifficulty({
          catalog,
          difficulty,
          resetIdentifier: window.resetIdentifier,
          window,
          encounters: mode.encounters,
        }),
      );
    }
  }

  if (!matchedCurrent) {
    return {
      status: "unknown",
      reason:
        "Current BoostingHub lockout raid was not present in the Blizzard encounters response (stable journal instance id).",
    };
  }

  if (difficulties.length === 0) {
    return {
      status: "unknown",
      reason:
        "Current raid was found but no supported Normal/Heroic/Mythic modes were present in the Blizzard response.",
    };
  }

  return {
    status: "derived",
    difficulties,
    verifiedAt,
    currentRaidId: matchedCurrent.id,
    currentBlizzardInstanceId: matchedCurrent.blizzardInstanceId,
  };
}
