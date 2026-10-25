import { isConcreteCharacterRole, type ConcreteCharacterRole } from "@/lib/character-roles";
import {
  findSpecialization,
  rosterRoleForSpecialization,
  specializationsForClass,
} from "@/lib/wow-specializations";
import type { CharacterRole, WowClass } from "@/models/enums";

/**
 * Specs a Raid Lead may choose for a Signup on this Run.
 *
 * Domain today:
 * - Signup volunteers `offeredRoles` (not offered-spec rows)
 * - Character owns `specialization` (primary) + `playableSpecs`
 *
 * Candidate specs = primary ∪ playableSpecs that (a) exist in the class catalog
 * and (b) map to a concrete role the Signup offered.
 *
 * Role is derived from the chosen spec — never invent a spec from a role when
 * multiple specs share that role (e.g. Holy / Discipline).
 */
export type OfferedSpecChoice = {
  name: string;
  role: ConcreteCharacterRole;
};

export type SignupOfferedSpecsInput = {
  wowClass: WowClass | null;
  primarySpecialization: string | null;
  playableSpecs: readonly string[];
  offeredRoles: readonly CharacterRole[];
};

function normalizeSpecName(wowClass: WowClass, name: string): string | null {
  return findSpecialization(wowClass, name)?.name ?? null;
}

export function resolveOfferedSpecs(input: SignupOfferedSpecsInput): OfferedSpecChoice[] {
  const wowClass = input.wowClass;
  if (!wowClass) return [];

  const offeredConcrete = new Set(
    input.offeredRoles.filter((role): role is ConcreteCharacterRole => isConcreteCharacterRole(role)),
  );
  if (offeredConcrete.size === 0) return [];

  const names = new Set<string>();
  if (input.primarySpecialization) {
    const primary = normalizeSpecName(wowClass, input.primarySpecialization);
    if (primary) names.add(primary);
  }
  for (const raw of input.playableSpecs) {
    const name = normalizeSpecName(wowClass, raw);
    if (name) names.add(name);
  }

  const choices: OfferedSpecChoice[] = [];
  for (const name of names) {
    const role = rosterRoleForSpecialization(wowClass, name);
    if (!role || !offeredConcrete.has(role)) continue;
    choices.push({ name, role });
  }

  // Offered role with no configured playable spec → class catalog for that role only.
  // Example: Mistweaver primary + offered MELEE_DPS → add Windwalker. Does not invent
  // a second same-role spec (Holy) when only Discipline is configured.
  const coveredRoles = new Set(choices.map((choice) => choice.role));
  for (const role of offeredConcrete) {
    if (coveredRoles.has(role)) continue;
    for (const spec of specializationsForClass(wowClass)) {
      if (spec.role !== role) continue;
      if (choices.some((choice) => choice.name === spec.name)) continue;
      choices.push({ name: spec.name, role });
    }
  }

  // No primary/playable at all: every catalog spec for offered roles.
  if (choices.length === 0) {
    for (const spec of specializationsForClass(wowClass)) {
      if (offeredConcrete.has(spec.role)) {
        choices.push({ name: spec.name, role: spec.role });
      }
    }
  }

  // Stable catalog order
  const order = specializationsForClass(wowClass).map((s) => s.name);
  choices.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  return choices;
}

/**
 * Rehydrate a display spec after save when only `selectedRole` is persisted.
 * Prefer primary when it matches the role among offered specs; else sole match;
 * else first offered for that role (ambiguous same-role multi-spec).
 */
export function resolveDisplaySpecForSelectedRole(
  input: SignupOfferedSpecsInput,
  selectedRole: CharacterRole | null,
): string | null {
  if (!selectedRole || !isConcreteCharacterRole(selectedRole)) return null;
  const offered = resolveOfferedSpecs(input).filter((s) => s.role === selectedRole);
  if (offered.length === 0) return null;
  if (offered.length === 1) return offered[0]!.name;
  const primary = input.primarySpecialization
    ? normalizeSpecName(input.wowClass!, input.primarySpecialization)
    : null;
  if (primary && offered.some((s) => s.name === primary)) return primary;
  return offered[0]!.name;
}
