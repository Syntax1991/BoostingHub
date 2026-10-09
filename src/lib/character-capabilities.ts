import { DomainError } from "@/lib/errors";
import {
  CONCRETE_CHARACTER_ROLES,
  type ConcreteCharacterRole,
  isConcreteCharacterRole,
} from "@/lib/character-roles";
import {
  findSpecialization,
  specializationsForClass,
} from "@/lib/wow-specializations";
import type { CharacterRole, WowClass } from "@/models/enums";
import { normalizeOfferedRoles } from "@/lib/offered-roles";

export type CharacterSpecCapability = {
  specialization: string;
  role: ConcreteCharacterRole;
};

export type CharacterCapabilityInput = {
  wowClass: WowClass;
  /** Primary specialization (Character.specialization). */
  specialization: string | null;
  /** Additional playable specs (never includes primary). */
  playableSpecs: readonly string[];
};

/**
 * Configured specs = primary + additional playable, each validated for class.
 * Primary missing → only explicit playableSpecs (unusual; signup will have no default).
 */
export function configuredSpecs(input: CharacterCapabilityInput): CharacterSpecCapability[] {
  const out: CharacterSpecCapability[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const match = findSpecialization(input.wowClass, raw);
    if (!match) return;
    const key = match.name.toLocaleLowerCase("en-US");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ specialization: match.name, role: match.role });
  };

  if (input.specialization?.trim()) {
    push(input.specialization);
  }
  for (const spec of input.playableSpecs) {
    push(spec);
  }
  return out;
}

/** Deduped concrete roster roles this Character can play. */
export function availableRoles(input: CharacterCapabilityInput): ConcreteCharacterRole[] {
  const roles = new Set<ConcreteCharacterRole>();
  for (const spec of configuredSpecs(input)) {
    roles.add(spec.role);
  }
  return CONCRETE_CHARACTER_ROLES.filter((role) => roles.has(role));
}

/** Spec label for a concrete role — prefers primary when it matches, else first playable. */
export function specLabelForRole(
  input: CharacterCapabilityInput,
  role: CharacterRole,
): string | null {
  if (!isConcreteCharacterRole(role)) return null;
  const specs = configuredSpecs(input).filter((entry) => entry.role === role);
  if (specs.length === 0) return null;
  return specs[0]!.specialization;
}

/**
 * Normalize + validate additional playable specs for create/update.
 * Rejects invalid class specs, duplicates, and overlap with primary.
 */
export function normalizePlayableSpecs(input: {
  wowClass: WowClass;
  primarySpecialization: string;
  playableSpecs: readonly string[];
}): string[] {
  const primary = findSpecialization(input.wowClass, input.primarySpecialization);
  if (!primary) {
    throw new DomainError(
      "INVALID_CLASS_SPECIALIZATION",
      "That specialization is not valid for the selected class.",
    );
  }
  const primaryKey = primary.name.toLocaleLowerCase("en-US");
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of input.playableSpecs) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const match = findSpecialization(input.wowClass, trimmed);
    if (!match) {
      throw new DomainError(
        "INVALID_CLASS_SPECIALIZATION",
        `"${trimmed}" is not a valid specialization for this class.`,
      );
    }
    const key = match.name.toLocaleLowerCase("en-US");
    if (key === primaryKey) {
      throw new DomainError(
        "INVALID_PLAYABLE_SPEC",
        `${match.name} is already the primary specialization.`,
      );
    }
    if (seen.has(key)) {
      throw new DomainError(
        "INVALID_PLAYABLE_SPEC",
        `Duplicate playable specialization: ${match.name}.`,
      );
    }
    seen.add(key);
    normalized.push(match.name);
  }

  return normalized;
}

/** Every non-primary catalog spec for the class (Select all remaining). */
export function remainingSpecsForClass(wowClass: WowClass, primarySpecialization: string): string[] {
  const primary = findSpecialization(wowClass, primarySpecialization);
  if (!primary) return [];
  const primaryKey = primary.name.toLocaleLowerCase("en-US");
  return specializationsForClass(wowClass)
    .filter((entry) => entry.name.toLocaleLowerCase("en-US") !== primaryKey)
    .map((entry) => entry.name);
}

/**
 * Offered signup roles must be a non-empty subset of Character capabilities.
 * Generic DPS is never accepted.
 */
export function assertOfferedRolesAllowed(
  input: CharacterCapabilityInput,
  offeredRoles: readonly CharacterRole[],
  characterName: string,
): ConcreteCharacterRole[] {
  const allowed = new Set(availableRoles(input));
  const normalized = normalizeOfferedRoles(offeredRoles);
  if (normalized.length === 0) {
    throw new DomainError("INVALID_CHARACTER_ROLE", `Choose at least one role for ${characterName}.`);
  }
  for (const role of normalized) {
    if (!isConcreteCharacterRole(role)) {
      throw new DomainError(
        "INVALID_CHARACTER_ROLE",
        `Generic DPS is not a valid signup role for ${characterName}. Choose Melee DPS or Ranged DPS.`,
      );
    }
    if (!allowed.has(role)) {
      throw new DomainError(
        "INVALID_CHARACTER_ROLE",
        `${characterName} is not configured to play as ${role}.`,
      );
    }
  }
  return normalized as ConcreteCharacterRole[];
}

/**
 * Preferred offspec roles: concrete, capability-valid, never primary.
 * Empty is allowed (no preferred offspec).
 */
export function normalizeOffspecRoles(input: {
  capability: CharacterCapabilityInput;
  primaryRole: CharacterRole;
  offspecRoles: readonly CharacterRole[];
}): ConcreteCharacterRole[] {
  const allowed = new Set(availableRoles(input.capability));
  if (!isConcreteCharacterRole(input.primaryRole) || !allowed.has(input.primaryRole)) {
    throw new DomainError(
      "INVALID_CHARACTER_ROLE",
      "Primary role must be a valid playable role for this character.",
    );
  }

  const seen = new Set<ConcreteCharacterRole>();
  const normalized: ConcreteCharacterRole[] = [];
  for (const raw of input.offspecRoles) {
    if (!isConcreteCharacterRole(raw)) {
      throw new DomainError(
        "INVALID_CHARACTER_ROLE",
        "Offspec roles must be concrete (Tank, Healer, Melee DPS, or Ranged DPS).",
      );
    }
    if (raw === input.primaryRole) {
      throw new DomainError(
        "INVALID_CHARACTER_ROLE",
        "Primary role cannot also appear in the offspec list.",
      );
    }
    if (!allowed.has(raw)) {
      throw new DomainError(
        "INVALID_CHARACTER_ROLE",
        `Offspec ${raw} is not available for this character's configured specializations.`,
      );
    }
    if (seen.has(raw)) continue;
    seen.add(raw);
    normalized.push(raw);
  }
  return CONCRETE_CHARACTER_ROLES.filter((role) => seen.has(role));
}

/** True when the assignment role matches the Character's primary role. */
export function isPrimaryRoleAssignment(
  primaryRole: CharacterRole | null | undefined,
  assignedRole: CharacterRole | null | undefined,
): boolean {
  return primaryRole != null && assignedRole != null && primaryRole === assignedRole;
}

/** True when the assignment is a preferred offspec (not primary). */
export function isOffspecRoleAssignment(
  primaryRole: CharacterRole | null | undefined,
  offspecRoles: readonly CharacterRole[] | null | undefined,
  assignedRole: CharacterRole | null | undefined,
): boolean {
  if (assignedRole == null || isPrimaryRoleAssignment(primaryRole, assignedRole)) return false;
  return (offspecRoles ?? []).includes(assignedRole);
}
