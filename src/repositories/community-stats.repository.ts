import { orm } from "@/lib/prisma";
import { asBoolean, asString, asStringOrNull, mapWowClass } from "@/lib/persistence";
import type { WowClass } from "@/models/enums";

/**
 * Narrow read model for Community Stats — active Boosters and their active
 * Characters only. Deliberately NOT Character Operations: no lockouts,
 * Battle.net connections, weekly availability, WCL, or Run data.
 */
export type CommunityStatsCharacterRecord = {
  id: string;
  userId: string;
  wowClass: WowClass;
  specialization: string | null;
  playableSpecs: string[];
};

export type CommunityStatsPool = {
  /** Distinct ACTIVE approved Booster user ids (includes boosters with zero active Characters). */
  boosterIds: string[];
  characters: CommunityStatsCharacterRecord[];
};

function mapPlayableSpecs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => asStringOrNull((row as Record<string, unknown>).specialization))
    .filter((spec): spec is string => Boolean(spec));
}

function mapCharacter(row: Record<string, unknown>): CommunityStatsCharacterRecord {
  return {
    id: asString(row.id),
    userId: asString(row.userId),
    wowClass: mapWowClass(row.wowClass),
    specialization: asStringOrNull(row.specialization),
    playableSpecs: mapPlayableSpecs(row.playableSpecs),
  };
}

export const communityStatsRepository = {
  /**
   * Eligible Community Stats pool in two fixed queries (no N+1):
   * 1. ACTIVE Users with isBooster=true
   * 2. Their isActive Characters + playableSpecs
   */
  async listPool(): Promise<CommunityStatsPool> {
    const boosterRows = (await orm.User.where({ accountStatus: "ACTIVE", isBooster: true })
      .select("id")
      .all()) as Array<Record<string, unknown>>;

    const boosterIds = boosterRows.map((row) => asString(row.id));
    if (boosterIds.length === 0) {
      return { boosterIds: [], characters: [] };
    }

    // Narrow relation set: playableSpecs only — never lockouts / Battle.net / availability.
    const characterRows = (await orm.Character.where({ isActive: true })
      .where((character) => character.userId.in(boosterIds))
      .include("playableSpecs")
      .all()) as Array<Record<string, unknown>>;

    // Defense in depth: only active Characters of the booster set (query already filters).
    const characters = characterRows
      .filter((row) => asBoolean(row.isActive, true))
      .map(mapCharacter);

    return { boosterIds, characters };
  },
};
