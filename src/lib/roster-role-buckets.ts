import { isLegacyGenericDps } from "@/lib/character-roles";
import type { CharacterRole } from "@/models/enums";

/**
 * Authoritative roster UI / publish buckets for concrete roles.
 * Legacy generic DPS is never silently remapped to Melee or Ranged.
 */
export type RosterRoleBucket = "TANK" | "HEALER" | "MELEE_DPS" | "RANGED_DPS" | "LEGACY_DPS";

export function rosterBucketForRole(role: CharacterRole | null | undefined): RosterRoleBucket | null {
  if (role == null) return null;
  if (role === "TANK" || role === "HEALER" || role === "MELEE_DPS" || role === "RANGED_DPS") return role;
  if (isLegacyGenericDps(role)) return "LEGACY_DPS";
  return null;
}

/** External boosters: concrete roles go to their bucket; historic DPS stays Legacy. */
export function externalBoosterRosterBucket(
  role: CharacterRole | null | undefined,
): RosterRoleBucket | null {
  return rosterBucketForRole(role);
}

export function countRolesByBucket(roles: readonly (CharacterRole | null | undefined)[]): {
  tanks: number;
  healers: number;
  meleeDps: number;
  rangedDps: number;
  legacyDps: number;
  /** Aggregate Melee + Ranged + Legacy (composition target). */
  dps: number;
} {
  let tanks = 0;
  let healers = 0;
  let meleeDps = 0;
  let rangedDps = 0;
  let legacyDps = 0;
  for (const role of roles) {
    const bucket = rosterBucketForRole(role);
    if (bucket === "TANK") tanks += 1;
    else if (bucket === "HEALER") healers += 1;
    else if (bucket === "MELEE_DPS") meleeDps += 1;
    else if (bucket === "RANGED_DPS") rangedDps += 1;
    else if (bucket === "LEGACY_DPS") legacyDps += 1;
  }
  return {
    tanks,
    healers,
    meleeDps,
    rangedDps,
    legacyDps,
    dps: meleeDps + rangedDps + legacyDps,
  };
}
