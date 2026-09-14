import { CHARACTER_ROLES, type CharacterRole } from "@/models/enums";

/** Deterministic order for volunteered booster roles: TANK → HEALER → DPS. */
export function normalizeOfferedRoles(roles: readonly CharacterRole[]): CharacterRole[] {
  const unique = new Set(roles);
  return CHARACTER_ROLES.filter((role) => unique.has(role));
}

export function formatOfferedRoles(roles: readonly CharacterRole[]): string {
  return normalizeOfferedRoles(roles).join(" · ");
}
