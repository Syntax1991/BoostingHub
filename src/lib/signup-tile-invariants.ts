import { resolveOfferedSpecs, type OfferedSpecChoice } from "@/lib/signup-offered-specs";
import type { CharacterRole, WowClass } from "@/models/enums";

/**
 * View helpers for the Signup tile grid.
 * Domain may still expand multi-role Boosters into role-section cards; the
 * unified grid must show each Signup identity at most once.
 */

export type SignupTileIdentity = {
  id: string;
  characterId: string | null;
  characterName: string | null;
  assignableRoles: readonly CharacterRole[];
};

/** Deduplicate by signup id (never by character name — same name, different realms stay distinct). */
export function uniqueSignupTiles<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/** Role filter: include when any offered/assignable role matches — still one tile. */
export function signupMatchesRoleFilter(
  assignableRoles: readonly CharacterRole[],
  roleFilter: CharacterRole | "ALL",
): boolean {
  if (roleFilter === "ALL") return true;
  return assignableRoles.includes(roleFilter);
}

export function offeredSpecsForTile(input: {
  wowClass: WowClass | null;
  primarySpecialization: string | null;
  playableSpecs: readonly string[];
  offeredRoles: readonly CharacterRole[];
}): OfferedSpecChoice[] {
  return resolveOfferedSpecs(input);
}

/** Specs shown on the normal tile: all when unselected; selected only when drafted. */
export function tileVisibleSpecs(
  offered: readonly OfferedSpecChoice[],
  selected: boolean,
  assignedSpec: string | null,
): OfferedSpecChoice[] {
  if (selected && assignedSpec) {
    return offered.filter((spec) => spec.name === assignedSpec);
  }
  return [...offered];
}
