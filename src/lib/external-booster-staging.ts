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
import { rolesForClass } from "@/lib/wow-specializations";
import type { CharacterRole, ParticipationType, WowClass } from "@/models/enums";

export type StagedExternalBooster = ExternalBoosterInput & { key: string };

/** Prefer current role when still valid; otherwise DPS when available, else first valid role. */
export function preferredRoleForClass(
  wowClass: WowClass,
  preferred: CharacterRole | null | undefined = null,
): CharacterRole {
  const roles = rolesForClass(wowClass);
  if (preferred && roles.includes(preferred)) return preferred;
  return roles.includes("DPS") ? "DPS" : roles[0]!;
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
