import type { CharacterRole, WowClass } from "@/models/enums";
import { WOW_CLASSES } from "@/models/enums";
import { DomainError } from "@/lib/errors";
import type { ConcreteCharacterRole } from "@/lib/character-roles";
import { CONCRETE_CHARACTER_ROLES, isConcreteCharacterRole } from "@/lib/character-roles";

/**
 * Retail specializations used to prevent impossible class/spec/role combinations.
 * This is a domain catalog, not Blizzard-synced talent data.
 * Spec → concrete roster role is authoritative; Character.playableSpecs declare
 * which of these the player can actually play.
 */
export type WowSpecialization = {
  name: string;
  role: ConcreteCharacterRole;
};

export const WOW_SPECIALIZATIONS: Record<WowClass, readonly WowSpecialization[]> = {
  DEATH_KNIGHT: [
    { name: "Blood", role: "TANK" },
    { name: "Frost", role: "MELEE_DPS" },
    { name: "Unholy", role: "MELEE_DPS" },
  ],
  DEMON_HUNTER: [
    { name: "Havoc", role: "MELEE_DPS" },
    { name: "Vengeance", role: "TANK" },
    { name: "Devourer", role: "RANGED_DPS" },
  ],
  DRUID: [
    { name: "Balance", role: "RANGED_DPS" },
    { name: "Feral", role: "MELEE_DPS" },
    { name: "Guardian", role: "TANK" },
    { name: "Restoration", role: "HEALER" },
  ],
  EVOKER: [
    { name: "Devastation", role: "RANGED_DPS" },
    { name: "Preservation", role: "HEALER" },
    { name: "Augmentation", role: "RANGED_DPS" },
  ],
  HUNTER: [
    { name: "Beast Mastery", role: "RANGED_DPS" },
    { name: "Marksmanship", role: "RANGED_DPS" },
    { name: "Survival", role: "MELEE_DPS" },
  ],
  MAGE: [
    { name: "Arcane", role: "RANGED_DPS" },
    { name: "Fire", role: "RANGED_DPS" },
    { name: "Frost", role: "RANGED_DPS" },
  ],
  MONK: [
    { name: "Brewmaster", role: "TANK" },
    { name: "Mistweaver", role: "HEALER" },
    { name: "Windwalker", role: "MELEE_DPS" },
  ],
  PALADIN: [
    { name: "Holy", role: "HEALER" },
    { name: "Protection", role: "TANK" },
    { name: "Retribution", role: "MELEE_DPS" },
  ],
  PRIEST: [
    { name: "Discipline", role: "HEALER" },
    { name: "Holy", role: "HEALER" },
    { name: "Shadow", role: "RANGED_DPS" },
  ],
  ROGUE: [
    { name: "Assassination", role: "MELEE_DPS" },
    { name: "Outlaw", role: "MELEE_DPS" },
    { name: "Subtlety", role: "MELEE_DPS" },
  ],
  SHAMAN: [
    { name: "Elemental", role: "RANGED_DPS" },
    { name: "Enhancement", role: "MELEE_DPS" },
    { name: "Restoration", role: "HEALER" },
  ],
  WARLOCK: [
    { name: "Affliction", role: "RANGED_DPS" },
    { name: "Demonology", role: "RANGED_DPS" },
    { name: "Destruction", role: "RANGED_DPS" },
  ],
  WARRIOR: [
    { name: "Arms", role: "MELEE_DPS" },
    { name: "Fury", role: "MELEE_DPS" },
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
  DEMON_HUNTER: { Havoc: "MELEE", Devourer: "RANGED" },
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

/**
 * Best guess when only the class is known (e.g. an external booster): RANGED
 * when most of the class's DPS specializations are ranged, else MELEE.
 */
export function defaultDpsAttackTypeForClass(wowClass: WowClass): DpsAttackType {
  const types = Object.values(DPS_ATTACK_TYPE[wowClass]);
  const ranged = types.filter((type) => type === "RANGED").length;
  return ranged * 2 > types.length ? "RANGED" : "MELEE";
}

/** Concrete DPS role when only class is known (external boosters). Never generic DPS. */
export function defaultConcreteDpsRoleForClass(wowClass: WowClass): "MELEE_DPS" | "RANGED_DPS" {
  return defaultDpsAttackTypeForClass(wowClass) === "RANGED" ? "RANGED_DPS" : "MELEE_DPS";
}

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

/** Concrete roster role for a specialization — never generic DPS. */
export function rosterRoleForSpecialization(
  wowClass: WowClass,
  specialization: string,
): ConcreteCharacterRole | null {
  return findSpecialization(wowClass, specialization)?.role ?? null;
}

/**
 * Spec → role. Returns the concrete catalog role (MELEE_DPS / RANGED_DPS / …).
 * Prefer rosterRoleForSpecialization when assigning to a roster.
 */
export function roleForSpecialization(wowClass: WowClass, specialization: string): CharacterRole | null {
  return rosterRoleForSpecialization(wowClass, specialization);
}

/**
 * Blizzard specialization ids (ChrSpecialization.ID — what Warcraft Logs
 * reports as CombatantInfo `specID`) → class + catalog name. The role comes
 * from WOW_SPECIALIZATIONS, so there is one role source. Checked against the
 * game's ChrSpecialization table (40 retail specs, incl. Devourer = 1480).
 */
const WOW_SPECIALIZATION_IDS: Record<number, { wowClass: WowClass; name: string }> = {
  250: { wowClass: "DEATH_KNIGHT", name: "Blood" },
  251: { wowClass: "DEATH_KNIGHT", name: "Frost" },
  252: { wowClass: "DEATH_KNIGHT", name: "Unholy" },
  577: { wowClass: "DEMON_HUNTER", name: "Havoc" },
  581: { wowClass: "DEMON_HUNTER", name: "Vengeance" },
  1480: { wowClass: "DEMON_HUNTER", name: "Devourer" },
  102: { wowClass: "DRUID", name: "Balance" },
  103: { wowClass: "DRUID", name: "Feral" },
  104: { wowClass: "DRUID", name: "Guardian" },
  105: { wowClass: "DRUID", name: "Restoration" },
  1467: { wowClass: "EVOKER", name: "Devastation" },
  1468: { wowClass: "EVOKER", name: "Preservation" },
  1473: { wowClass: "EVOKER", name: "Augmentation" },
  253: { wowClass: "HUNTER", name: "Beast Mastery" },
  254: { wowClass: "HUNTER", name: "Marksmanship" },
  255: { wowClass: "HUNTER", name: "Survival" },
  62: { wowClass: "MAGE", name: "Arcane" },
  63: { wowClass: "MAGE", name: "Fire" },
  64: { wowClass: "MAGE", name: "Frost" },
  268: { wowClass: "MONK", name: "Brewmaster" },
  269: { wowClass: "MONK", name: "Windwalker" },
  270: { wowClass: "MONK", name: "Mistweaver" },
  65: { wowClass: "PALADIN", name: "Holy" },
  66: { wowClass: "PALADIN", name: "Protection" },
  70: { wowClass: "PALADIN", name: "Retribution" },
  256: { wowClass: "PRIEST", name: "Discipline" },
  257: { wowClass: "PRIEST", name: "Holy" },
  258: { wowClass: "PRIEST", name: "Shadow" },
  259: { wowClass: "ROGUE", name: "Assassination" },
  260: { wowClass: "ROGUE", name: "Outlaw" },
  261: { wowClass: "ROGUE", name: "Subtlety" },
  262: { wowClass: "SHAMAN", name: "Elemental" },
  263: { wowClass: "SHAMAN", name: "Enhancement" },
  264: { wowClass: "SHAMAN", name: "Restoration" },
  265: { wowClass: "WARLOCK", name: "Affliction" },
  266: { wowClass: "WARLOCK", name: "Demonology" },
  267: { wowClass: "WARLOCK", name: "Destruction" },
  71: { wowClass: "WARRIOR", name: "Arms" },
  72: { wowClass: "WARRIOR", name: "Fury" },
  73: { wowClass: "WARRIOR", name: "Protection" },
};

/** Null for an unknown id (e.g. a spec added after this catalog). */
export function specializationById(
  specId: number,
): { wowClass: WowClass; name: string; role: CharacterRole } | null {
  const entry = WOW_SPECIALIZATION_IDS[specId];
  const role = entry ? roleForSpecialization(entry.wowClass, entry.name) : null;
  return entry && role ? { ...entry, role } : null;
}

/** Every catalogued specialization id (tests / diagnostics). */
export function knownSpecializationIds(): number[] {
  return Object.keys(WOW_SPECIALIZATION_IDS).map(Number);
}

/**
 * The one authoritative class/spec check: used both by plain character
 * writes and by the Blizzard import/link flow so a specialization can never
 * persist against a class it doesn't belong to via either path.
 */
export function resolveClassSpecialization(
  wowClass: WowClass,
  specialization: string,
): { specialization: string; primaryRole: ConcreteCharacterRole } {
  const match = findSpecialization(wowClass, specialization);
  if (!match) {
    throw new DomainError(
      "INVALID_CLASS_SPECIALIZATION",
      "That specialization is not valid for the selected class.",
    );
  }
  return { specialization: match.name, primaryRole: match.role };
}

/** Concrete roles this class can perform (from catalog specs). */
export function rolesForClass(wowClass: WowClass): ConcreteCharacterRole[] {
  const roles = new Set(WOW_SPECIALIZATIONS[wowClass].map((entry) => entry.role));
  return CONCRETE_CHARACTER_ROLES.filter((role) => roles.has(role));
}

export function isRoleValidForClass(wowClass: WowClass, role: CharacterRole): boolean {
  if (!isConcreteCharacterRole(role)) return false;
  return rolesForClass(wowClass).includes(role);
}
