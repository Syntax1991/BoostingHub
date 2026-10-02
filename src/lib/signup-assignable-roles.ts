import {
  CONCRETE_CHARACTER_ROLES,
  isConcreteCharacterRole,
  isLegacyGenericDps,
  type ConcreteCharacterRole,
} from "@/lib/character-roles";
import { normalizeOfferedRoles } from "@/lib/offered-roles";
import { findSpecialization, rolesForClass } from "@/lib/wow-specializations";
import type { CharacterRole, WowClass } from "@/models/enums";

/**
 * Assignment-time view of a signup. Historic `offeredRoles` may still contain
 * generic DPS. This helper never rewrites that offer — it only decides which
 * concrete roles a Raid Lead may write onto RunRosterEntry.selectedRole.
 */
export type SignupAssignableRoleInput = {
  offeredRoles: readonly CharacterRole[];
  characterClass: WowClass | null;
  primarySpecialization: string | null;
  playableSpecs?: readonly string[];
};

export type RosterAssignmentSection = ConcreteCharacterRole | "UNASSIGNED_DPS";

type DpsSubtype = "MELEE_DPS" | "RANGED_DPS";

function isDpsSubtype(role: ConcreteCharacterRole): role is DpsSubtype {
  return role === "MELEE_DPS" || role === "RANGED_DPS";
}

function orderRoles(roles: Iterable<ConcreteCharacterRole>): ConcreteCharacterRole[] {
  const present = new Set(roles);
  return CONCRETE_CHARACTER_ROLES.filter((role) => present.has(role));
}

function dpsRoleForSpec(wowClass: WowClass, specialization: string): DpsSubtype | null {
  const match = findSpecialization(wowClass, specialization);
  if (!match || !isDpsSubtype(match.role)) return null;
  return match.role;
}

/** Every DPS subtype the class catalog can play. Not a character capability. */
function classDpsSubtypes(wowClass: WowClass): DpsSubtype[] {
  return rolesForClass(wowClass).filter(isDpsSubtype);
}

/**
 * Historic generic DPS → concrete subtypes.
 * 1. Primary specialization, when it is itself a DPS spec.
 * 2. Configured playable DPS specs, when primary does not decide.
 * 3. Class catalog, only when no DPS spec is configured. Never a new-signup capability.
 */
function resolveHistoricGenericDps(input: SignupAssignableRoleInput): DpsSubtype[] {
  const wowClass = input.characterClass;
  if (!wowClass) return ["MELEE_DPS", "RANGED_DPS"];

  const primary = input.primarySpecialization?.trim();
  if (primary) {
    const fromPrimary = dpsRoleForSpec(wowClass, primary);
    if (fromPrimary) return [fromPrimary];
  }

  const fromPlayable = new Set<DpsSubtype>();
  for (const spec of input.playableSpecs ?? []) {
    const role = dpsRoleForSpec(wowClass, spec);
    if (role) fromPlayable.add(role);
  }
  if (fromPlayable.size > 0) return orderRoles(fromPlayable).filter(isDpsSubtype);

  const fromClass = classDpsSubtypes(wowClass);
  return fromClass.length > 0 ? fromClass : ["MELEE_DPS", "RANGED_DPS"];
}

/**
 * Concrete roles the Raid Lead may assign.
 * Modern offers are returned unchanged. Generic DPS is expanded only for a
 * historic offer and is never itself returned.
 */
export function resolveSignupAssignableRoles(input: SignupAssignableRoleInput): ConcreteCharacterRole[] {
  const offered = normalizeOfferedRoles(input.offeredRoles);
  const concrete = offered.filter((role): role is ConcreteCharacterRole => isConcreteCharacterRole(role));
  const legacyGenericDps = offered.some((role) => isLegacyGenericDps(role));
  if (!legacyGenericDps) return concrete;

  const kept = concrete.filter((role) => !isDpsSubtype(role));
  const explicitDps = concrete.filter(isDpsSubtype);
  return orderRoles([...kept, ...explicitDps, ...resolveHistoricGenericDps(input)]);
}

/**
 * Where a booster card is drawn. Ambiguous historic DPS is one Unassigned DPS
 * row — never duplicated under Melee and Ranged. A single resolved subtype
 * goes straight into that concrete section.
 */
export function rosterRoleSectionsForSignup(input: SignupAssignableRoleInput): {
  assignableRoles: ConcreteCharacterRole[];
  sections: RosterAssignmentSection[];
} {
  const assignableRoles = resolveSignupAssignableRoles(input);
  const historic = input.offeredRoles.some((role) => isLegacyGenericDps(role));
  const dps = assignableRoles.filter(isDpsSubtype);
  const sections: RosterAssignmentSection[] = [];
  for (const role of assignableRoles) {
    if (role === "TANK" || role === "HEALER") sections.push(role);
  }
  if (historic && dps.length > 1) sections.push("UNASSIGNED_DPS");
  else {
    for (const role of dps) sections.push(role);
  }
  return { assignableRoles, sections };
}

export function unresolvedHistoricDpsMessage(characterLabel: string): string {
  return `Choose Melee or Ranged DPS for ${characterLabel}.`;
}
