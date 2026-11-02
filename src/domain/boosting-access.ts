import type { BoostingAccessGrant, BoostingRoles } from "@/models/records";

export type { BoostingAccessGrant, BoostingRoles };

/**
 * Central Booster access: manual grant OR Discord Raid Booster role.
 * Lootbuddy never contributes. ADMIN / OWNER have no bypass.
 */
export function hasEffectiveBoosterAccess(
  roles: { isBooster?: boolean; discordRaidBooster?: boolean } | null | undefined,
): BoostingAccessGrant {
  const manual = roles?.isBooster === true;
  const discord = roles?.discordRaidBooster === true;
  return { granted: manual || discord, manual, discord };
}

/**
 * Central Lootbuddy access: manual grant OR Discord Lootbuddy role.
 * Raid Booster never contributes.
 */
export function hasEffectiveLootbuddyAccess(
  roles: { isLootbuddy?: boolean; discordLootbuddy?: boolean } | null | undefined,
): BoostingAccessGrant {
  const manual = roles?.isLootbuddy === true;
  const discord = roles?.discordLootbuddy === true;
  return { granted: manual || discord, manual, discord };
}

/**
 * The single Booster-access check used by signup / roster / Auto Build.
 * Reads effective access (manual ∨ Discord Raid Booster).
 * Callers that already hydrate `ownerIsBooster` as the effective OR may pass
 * `{ isBooster: ownerIsBooster }` alone.
 */
export function isApprovedBooster(
  roles: { isBooster?: boolean; discordRaidBooster?: boolean } | null | undefined,
): boolean {
  return hasEffectiveBoosterAccess(roles).granted;
}

/** Display helper for admin source labels (no raw role IDs). */
export function boosterAccessSourceLabel(grant: BoostingAccessGrant): string | null {
  if (!grant.granted) return null;
  if (grant.manual && grant.discord) return "Manual + Discord";
  if (grant.discord) return "Discord · Raid Booster";
  return "Manual";
}

export function lootbuddyAccessSourceLabel(grant: BoostingAccessGrant): string | null {
  if (!grant.granted) return null;
  if (grant.manual && grant.discord) return "Manual + Discord";
  if (grant.discord) return "Discord · Lootbuddy";
  return "Manual";
}
