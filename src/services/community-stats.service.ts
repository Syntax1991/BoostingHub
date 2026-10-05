import { availableRoles } from "@/lib/character-capabilities";
import { CONCRETE_CHARACTER_ROLES, type ConcreteCharacterRole } from "@/lib/character-roles";
import { WOW_CLASSES, type WowClass } from "@/models/enums";
import {
  communityStatsRepository,
  type CommunityStatsCharacterRecord,
  type CommunityStatsPool,
} from "@/repositories/community-stats.repository";

export type CommunityStatsRoleCoverage = {
  characters: number;
  boosters: number;
};

export type CommunityStats = {
  activeBoosters: number;
  activeCharacters: number;
  roles: Record<ConcreteCharacterRole, CommunityStatsRoleCoverage>;
  /** Counts for every WowClass key (zeros included). Ordered via WOW_CLASSES when iterated. */
  classes: Record<WowClass, number>;
  multiRole: CommunityStatsRoleCoverage;
};

function emptyRoleCoverage(): Record<ConcreteCharacterRole, CommunityStatsRoleCoverage> {
  return {
    TANK: { characters: 0, boosters: 0 },
    HEALER: { characters: 0, boosters: 0 },
    MELEE_DPS: { characters: 0, boosters: 0 },
    RANGED_DPS: { characters: 0, boosters: 0 },
  };
}

function emptyClassCounts(): Record<WowClass, number> {
  const counts = {} as Record<WowClass, number>;
  for (const wowClass of WOW_CLASSES) {
    counts[wowClass] = 0;
  }
  return counts;
}

function emptyCommunityStats(boosterCount = 0): CommunityStats {
  return {
    activeBoosters: boosterCount,
    activeCharacters: 0,
    roles: emptyRoleCoverage(),
    classes: emptyClassCounts(),
    multiRole: { characters: 0, boosters: 0 },
  };
}

/**
 * Pure Community Stats aggregation over an already-filtered pool.
 * Role authority is `availableRoles` (primary + playableSpecs → concrete roles).
 * Authorization is intentionally not applied here — callers (e.g. Management
 * controller in a later PR) gate access with existing ADMIN helpers.
 */
export function aggregateCommunityStats(pool: CommunityStatsPool): CommunityStats {
  const stats = emptyCommunityStats(pool.boosterIds.length);
  stats.activeCharacters = pool.characters.length;

  const roleBoosterSets: Record<ConcreteCharacterRole, Set<string>> = {
    TANK: new Set(),
    HEALER: new Set(),
    MELEE_DPS: new Set(),
    RANGED_DPS: new Set(),
  };
  const multiRoleBoosters = new Set<string>();

  for (const character of pool.characters) {
    stats.classes[character.wowClass] += 1;

    const roles = availableRoles({
      wowClass: character.wowClass,
      specialization: character.specialization,
      playableSpecs: character.playableSpecs,
    });

    for (const role of roles) {
      stats.roles[role].characters += 1;
      roleBoosterSets[role].add(character.userId);
    }

    if (roles.length >= 2) {
      stats.multiRole.characters += 1;
      multiRoleBoosters.add(character.userId);
    }
  }

  for (const role of CONCRETE_CHARACTER_ROLES) {
    stats.roles[role].boosters = roleBoosterSets[role].size;
  }
  stats.multiRole.boosters = multiRoleBoosters.size;

  return stats;
}

/**
 * Community Stats domain service.
 * Read-only aggregate for the active Booster character pool.
 * Does not authorize — Management UI (PR #2) owns ADMIN gating.
 */
export const communityStatsService = {
  async getStats(): Promise<CommunityStats> {
    const pool = await communityStatsRepository.listPool();
    return aggregateCommunityStats(pool);
  },
};

export type { CommunityStatsCharacterRecord, CommunityStatsPool };
