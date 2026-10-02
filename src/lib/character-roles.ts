import type { CharacterRole } from "@/models/enums";

/** Roles that may be written for new signup offers and roster assignments. */
export const CONCRETE_CHARACTER_ROLES = ["TANK", "HEALER", "MELEE_DPS", "RANGED_DPS"] as const;
export type ConcreteCharacterRole = (typeof CONCRETE_CHARACTER_ROLES)[number];

/** Generic DPS is a legacy persisted value only — never an authoritative new assignment. */
export function isLegacyGenericDps(role: CharacterRole): boolean {
  return role === "DPS";
}

export function isConcreteCharacterRole(role: CharacterRole): role is ConcreteCharacterRole {
  return (CONCRETE_CHARACTER_ROLES as readonly string[]).includes(role);
}

/** Composition / broad DPS grouping: melee, ranged, or historic generic DPS. */
export function isDpsRole(role: CharacterRole | null | undefined): boolean {
  return role === "DPS" || role === "MELEE_DPS" || role === "RANGED_DPS";
}

export function assertConcreteRosterRole(role: CharacterRole): ConcreteCharacterRole {
  if (!isConcreteCharacterRole(role)) {
    throw new Error(`Generic DPS cannot be an authoritative roster assignment (got ${role}).`);
  }
  return role;
}
