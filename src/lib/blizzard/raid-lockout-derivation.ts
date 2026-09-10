import type { RaidDifficulty, WowRegion } from "@/models/enums";
import type { BlizzardCharacterRaidEncounters } from "@/lib/blizzard/types";
import { mapBlizzardRaidDifficulty } from "@/lib/blizzard/raid-difficulty";
import {
  findRaidCatalogByBlizzardInstanceId,
  findRaidCatalogByName,
  normalizeRaidName,
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
  bosses: Array<{
    bossId: string;
    name: string;
    killedThisReset: boolean;
  }>;
};

export type DerivedRaidLockoutResult =
  | { status: "derived"; difficulties: DerivedDifficultyLockout[]; verifiedAt: string }
  | { status: "unknown"; reason: string };

const TRACKED_DIFFICULTIES: RaidDifficulty[] = ["NORMAL", "HEROIC", "MYTHIC"];

function matchBoss(
  bosses: readonly WowRaidCatalogBoss[],
  encounterId: string,
  encounterName: string,
): WowRaidCatalogBoss | null {
  const numericId = Number(encounterId);
  if (Number.isFinite(numericId)) {
    const byId = bosses.find((boss) => boss.blizzardEncounterIds?.includes(numericId));
    if (byId) return byId;
  }

  const needle = normalizeRaidName(encounterName);
  const exact = bosses.find((boss) => normalizeRaidName(boss.name) === needle);
  if (exact) return exact;

  return (
    bosses.find((boss) => {
      const catalog = normalizeRaidName(boss.name);
      return needle.startsWith(catalog) || catalog.startsWith(needle);
    }) ?? null
  );
}

function resolveCatalogRaid(
  instanceId: string,
  instanceName: string,
): WowRaidCatalogEntry | null {
  const numericId = Number(instanceId);
  if (Number.isFinite(numericId)) {
    const byId = findRaidCatalogByBlizzardInstanceId(numericId);
    if (byId) return byId;
  }
  return findRaidCatalogByName(instanceName);
}

function emptyDifficulty(
  catalog: WowRaidCatalogEntry,
  difficulty: RaidDifficulty,
  resetIdentifier: string,
): DerivedDifficultyLockout {
  return {
    raidId: catalog.id,
    difficulty,
    resetIdentifier,
    bossesDefeated: 0,
    bossTotal: catalog.bosses.length,
    isComplete: false,
    bosses: catalog.bosses.map((boss) => ({
      bossId: boss.id,
      name: boss.name,
      killedThisReset: false,
    })),
  };
}

/**
 * Derive current-reset aggregate lockouts for catalog raids from Blizzard encounters.
 * Successful empty progress becomes 0/N (clear), not unknown.
 */
export function deriveCurrentResetLockouts(input: {
  region: WowRegion;
  encounters: BlizzardCharacterRaidEncounters;
  now?: Date;
  resetWindow?: RegionalWeeklyReset;
}): DerivedRaidLockoutResult {
  const window = input.resetWindow ?? getRegionalWeeklyReset(input.region, input.now ?? new Date());
  const verifiedAt = (input.now ?? new Date()).toISOString();
  const difficulties: DerivedDifficultyLockout[] = [];
  let matchedCatalogRaid = false;

  for (const raid of input.encounters.raids) {
    const catalog = resolveCatalogRaid(raid.instanceId, raid.instanceName);
    if (!catalog) continue;
    matchedCatalogRaid = true;

    const seen = new Set<RaidDifficulty>();

    for (const mode of raid.difficulties) {
      const difficulty = mapBlizzardRaidDifficulty(mode.difficulty);
      if (!difficulty) continue;
      seen.add(difficulty);

      const bossStates = catalog.bosses.map((boss) => ({
        bossId: boss.id,
        name: boss.name,
        killedThisReset: false,
      }));

      for (const encounter of mode.encounters) {
        const boss = matchBoss(catalog.bosses, encounter.encounterId, encounter.encounterName);
        if (!boss) continue;
        const killed =
          encounter.lastKillTimestampMs != null &&
          isTimestampInRegionalReset(encounter.lastKillTimestampMs, window);
        const slot = bossStates.find((row) => row.bossId === boss.id);
        if (slot && killed) slot.killedThisReset = true;
      }

      const bossesDefeated = bossStates.filter((boss) => boss.killedThisReset).length;
      const bossTotal = catalog.bosses.length;
      difficulties.push({
        raidId: catalog.id,
        difficulty,
        resetIdentifier: window.resetIdentifier,
        bossesDefeated,
        bossTotal,
        isComplete: bossesDefeated >= bossTotal && bossTotal > 0,
        bosses: bossStates,
      });
    }

    for (const difficulty of TRACKED_DIFFICULTIES) {
      if (seen.has(difficulty)) continue;
      difficulties.push(emptyDifficulty(catalog, difficulty, window.resetIdentifier));
    }
  }

  if (!matchedCatalogRaid) {
    return {
      status: "unknown",
      reason: "Current BoostingHub raid was not present in the Blizzard encounters response.",
    };
  }

  return { status: "derived", difficulties, verifiedAt };
}
