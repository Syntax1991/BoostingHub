/**
 * Pure staging helpers for the External Boosters dialog.
 * Edit/Apply/Cancel mutate local staged rows only — persistence stays on dialog Save.
 */
import {
  externalBoosterInputError,
  normalizeExternalBoosterInput,
  type ExternalBooster,
  type ExternalBoosterInput,
} from "@/lib/external-booster";
import { isDpsRole } from "@/lib/character-roles";
import { defaultConcreteDpsRoleForClass, rolesForClass } from "@/lib/wow-specializations";
import type { CharacterRole, ParticipationType, WowClass } from "@/models/enums";

export type StagedExternalBooster = ExternalBoosterInput & { key: string };

/**
 * Role to prefer for a class when only class is known (external boosters).
 * - Keeps `preferred` when it is still valid for the class.
 * - Pure DPS classes (Mage, Rogue, Hunter, …): unambiguous concrete subtype
 *   via `defaultConcreteDpsRoleForClass` (never generic DPS).
 * - Hybrids (Tank/Healer capable): never invent Melee/Ranged DPS — fall back to
 *   the first Tank/Healer capability so the Raid Lead must explicitly pick DPS
 *   when that is the intent.
 */
export function preferredRoleForClass(
  wowClass: WowClass,
  preferred: CharacterRole | null | undefined = null,
): CharacterRole {
  const roles = rolesForClass(wowClass);
  if (preferred && (roles as readonly CharacterRole[]).includes(preferred)) return preferred;

  const dpsOnly = roles.length > 0 && roles.every((role) => isDpsRole(role));
  if (dpsOnly) {
    const concreteDps = defaultConcreteDpsRoleForClass(wowClass);
    return roles.includes(concreteDps) ? concreteDps : roles[0]!;
  }

  const nonDps = roles.find((role) => role === "TANK" || role === "HEALER");
  return nonDps ?? roles[0]!;
}

/** Role after a class change while staying BOOSTER (LOOTBUDDY keeps null). */
export function roleAfterClassChange(
  participationType: ParticipationType,
  currentRole: CharacterRole | null,
  nextClass: WowClass,
): CharacterRole | null {
  if (participationType === "LOOTBUDDY") return null;
  return preferredRoleForClass(nextClass, currentRole);
}

/** Role after a type change for the given class. */
export function roleAfterTypeChange(
  nextType: ParticipationType,
  wowClass: WowClass,
  currentRole: CharacterRole | null = null,
): CharacterRole | null {
  if (nextType === "LOOTBUDDY") return null;
  return preferredRoleForClass(wowClass, currentRole);
}

export function toStagedExternalBoosters(boosters: readonly ExternalBooster[]): StagedExternalBooster[] {
  return boosters.map(({ id, name, wowClass, participationType, role }) => ({
    key: id,
    name,
    wowClass,
    participationType,
    role,
  }));
}

export function externalBoostersStagedUnchanged(
  staged: readonly StagedExternalBooster[],
  original: readonly ExternalBooster[],
): boolean {
  if (staged.length !== original.length) return false;
  return staged.every((booster, index) => {
    const baseline = original[index]!;
    return (
      booster.name === baseline.name &&
      booster.wowClass === baseline.wowClass &&
      (booster.participationType ?? "BOOSTER") === baseline.participationType &&
      booster.role === baseline.role
    );
  });
}

/**
 * Apply an inline edit to the same staged row (preserves key + order).
 * Returns the previous staged list unchanged when validation fails.
 */
export function applyStagedExternalBoosterEdit(
  staged: readonly StagedExternalBooster[],
  key: string,
  draft: ExternalBoosterInput,
): { next: StagedExternalBooster[]; error: string | null } {
  const problem = externalBoosterInputError(draft);
  if (problem) {
    return { next: [...staged], error: problem };
  }
  const normalized = normalizeExternalBoosterInput(draft);
  let found = false;
  const next = staged.map((row) => {
    if (row.key !== key) return row;
    found = true;
    return { ...normalized, key: row.key };
  });
  if (!found) {
    return { next: [...staged], error: "That external entry is no longer in the list." };
  }
  return { next, error: null };
}

export function removeStagedExternalBooster(
  staged: readonly StagedExternalBooster[],
  key: string,
): StagedExternalBooster[] {
  return staged.filter((row) => row.key !== key);
}

export function appendStagedExternalBooster(
  staged: readonly StagedExternalBooster[],
  input: ExternalBoosterInput,
  key: string,
): StagedExternalBooster[] {
  const normalized = normalizeExternalBoosterInput(input);
  return [...staged, { ...normalized, key }];
}

/** Payload the dialog Save action submits (no client keys). */
export function stagedExternalBoostersForSave(
  staged: readonly StagedExternalBooster[],
): Array<Required<ExternalBoosterInput>> {
  return staged.map((booster) => normalizeExternalBoosterInput(booster));
}
