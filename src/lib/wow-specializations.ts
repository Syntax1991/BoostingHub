import type { CharacterRole, WowClass } from "@/models/enums";
import { WOW_CLASSES } from "@/models/enums";
import { DomainError } from "@/lib/errors";

/**
 * Retail specializations used to prevent impossible class/spec/role combinations.
 * This is a domain catalog, not Blizzard-synced talent data.
 * primaryRole is derived from specialization; BoosterAccess may still approve
 * additional roles for the same character.
 */
export type WowSpecialization = {
  name: string;
  role: CharacterRole;
};

export const WOW_SPECIALIZATIONS: Record<WowClass, readonly WowSpecialization[]> = {
  DEATH_KNIGHT: [
    { name: "Blood", role: "TANK" },
    { name: "Frost", role: "DPS" },
    { name: "Unholy", role: "DPS" },
  ],
  DEMON_HUNTER: [
    { name: "Havoc", role: "DPS" },
    { name: "Vengeance", role: "TANK" },
  ],
  DRUID: [
    { name: "Balance", role: "DPS" },
    { name: "Feral", role: "DPS" },
    { name: "Guardian", role: "TANK" },
    { name: "Restoration", role: "HEALER" },
  ],
  EVOKER: [
    { name: "Devastation", role: "DPS" },
    { name: "Preservation", role: "HEALER" },
    { name: "Augmentation", role: "DPS" },
  ],
  HUNTER: [
    { name: "Beast Mastery", role: "DPS" },
    { name: "Marksmanship", role: "DPS" },
    { name: "Survival", role: "DPS" },
  ],
  MAGE: [
    { name: "Arcane", role: "DPS" },
    { name: "Fire", role: "DPS" },
    { name: "Frost", role: "DPS" },
  ],
  MONK: [
    { name: "Brewmaster", role: "TANK" },
    { name: "Mistweaver", role: "HEALER" },
    { name: "Windwalker", role: "DPS" },
  ],
  PALADIN: [
    { name: "Holy", role: "HEALER" },
    { name: "Protection", role: "TANK" },
    { name: "Retribution", role: "DPS" },
  ],
  PRIEST: [
    { name: "Discipline", role: "HEALER" },
    { name: "Holy", role: "HEALER" },
    { name: "Shadow", role: "DPS" },
  ],
  ROGUE: [
    { name: "Assassination", role: "DPS" },
    { name: "Outlaw", role: "DPS" },
    { name: "Subtlety", role: "DPS" },
  ],
  SHAMAN: [
    { name: "Elemental", role: "DPS" },
    { name: "Enhancement", role: "DPS" },
    { name: "Restoration", role: "HEALER" },
  ],
  WARLOCK: [
    { name: "Affliction", role: "DPS" },
    { name: "Demonology", role: "DPS" },
    { name: "Destruction", role: "DPS" },
  ],
  WARRIOR: [
    { name: "Arms", role: "DPS" },
    { name: "Fury", role: "DPS" },
    { name: "Protection", role: "TANK" },
  ],
};

export const WOW_CLASS_OPTIONS = WOW_CLASSES;

export type DpsAttackType = "MELEE" | "RANGED";

/**
 * Melee/ranged split for DPS specializations only — meaningless for TANK/HEALER.
 * Keyed by (class, specialization) because spec names collide across classes
 * (e.g. "Frost" is a ranged Mage spec and a melee Death Knight spec). This is
 * the one authoritative source; presentation layers (including the Discord
 * bot) must call attackTypeForSpecialization rather than re-deriving it.
 */
const DPS_ATTACK_TYPE: Record<WowClass, Record<string, DpsAttackType>> = {
  DEATH_KNIGHT: { Frost: "MELEE", Unholy: "MELEE" },
  DEMON_HUNTER: { Havoc: "MELEE" },
  DRUID: { Balance: "RANGED", Feral: "MELEE" },
  EVOKER: { Devastation: "RANGED", Augmentation: "RANGED" },
  HUNTER: { "Beast Mastery": "RANGED", Marksmanship: "RANGED", Survival: "MELEE" },
  MAGE: { Arcane: "RANGED", Fire: "RANGED", Frost: "RANGED" },
  MONK: { Windwalker: "MELEE" },
  PALADIN: { Retribution: "MELEE" },
  PRIEST: { Shadow: "RANGED" },
  ROGUE: { Assassination: "MELEE", Outlaw: "MELEE", Subtlety: "MELEE" },
  SHAMAN: { Elemental: "RANGED", Enhancement: "MELEE" },
  WARLOCK: { Affliction: "RANGED", Demonology: "RANGED", Destruction: "RANGED" },
  WARRIOR: { Arms: "MELEE", Fury: "MELEE" },
};

/** Null for a non-DPS specialization (TANK/HEALER) or an unrecognized spec name. */
export function attackTypeForSpecialization(wowClass: WowClass, specialization: string | null): DpsAttackType | null {
  if (!specialization) return null;
  const match = findSpecialization(wowClass, specialization);
  if (!match) return null;
  return DPS_ATTACK_TYPE[wowClass]?.[match.name] ?? null;
}

export function specializationsForClass(wowClass: WowClass): readonly WowSpecialization[] {
  return WOW_SPECIALIZATIONS[wowClass];
}

export function findSpecialization(
  wowClass: WowClass,
  specialization: string,
): WowSpecialization | null {
  const needle = specialization.trim().toLocaleLowerCase("en-US");
  return (
    WOW_SPECIALIZATIONS[wowClass].find((entry) => entry.name.toLocaleLowerCase("en-US") === needle) ??
    null
  );
}

export function roleForSpecialization(wowClass: WowClass, specialization: string): CharacterRole | null {
  return findSpecialization(wowClass, specialization)?.role ?? null;
}

/**
 * The one authoritative class/spec check: used both by plain character
 * writes and by the Blizzard import/link flow so a specialization can never
 * persist against a class it doesn't belong to via either path.
 */
export function resolveClassSpecialization(
  wowClass: WowClass,
  specialization: string,
): { specialization: string; primaryRole: CharacterRole } {
  const match = findSpecialization(wowClass, specialization);
  if (!match) {
    throw new DomainError(
      "INVALID_CLASS_SPECIALIZATION",
      "That specialization is not valid for the selected class.",
    );
  }
  return { specialization: match.name, primaryRole: match.role };
}

/** Roles this class can actually perform. BoosterAccess may approve any of these, not only primaryRole. */
export function rolesForClass(wowClass: WowClass): CharacterRole[] {
  return [...new Set(WOW_SPECIALIZATIONS[wowClass].map((entry) => entry.role))];
}

export function isRoleValidForClass(wowClass: WowClass, role: CharacterRole): boolean {
  return rolesForClass(wowClass).includes(role);
}
