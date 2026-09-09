import type { CharacterRole, WowClass } from "@/models/enums";
import { WOW_CLASSES } from "@/models/enums";

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

/** Roles this class can actually perform. BoosterAccess may approve any of these, not only primaryRole. */
export function rolesForClass(wowClass: WowClass): CharacterRole[] {
  return [...new Set(WOW_SPECIALIZATIONS[wowClass].map((entry) => entry.role))];
}

export function isRoleValidForClass(wowClass: WowClass, role: CharacterRole): boolean {
  return rolesForClass(wowClass).includes(role);
}
