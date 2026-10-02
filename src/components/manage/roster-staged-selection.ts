import type { CharacterRole } from "@/models/enums";

/** Stable primitive key for the authoritative server draft selection snapshot. */
export function buildRosterSavedSelectionKey(
  version: number,
  selectedSignupIds: Iterable<string>,
): string {
  return `${version}:${[...selectedSignupIds].sort().join(",")}`;
}

/**
 * When the server snapshot key is unchanged, preserve local staged edits.
 * When it changes (save/refresh/publish seed), replace staged with server ids.
 */
export function syncStagedSelectionIds(args: {
  previousServerKey: string;
  nextServerKey: string;
  previousStagedIds: ReadonlySet<string>;
  nextServerSelectedIds: Iterable<string>;
}): { serverKey: string; stagedIds: Set<string> } {
  if (args.previousServerKey === args.nextServerKey) {
    return {
      serverKey: args.previousServerKey,
      stagedIds: new Set(args.previousStagedIds),
    };
  }
  return {
    serverKey: args.nextServerKey,
    stagedIds: new Set(args.nextServerSelectedIds),
  };
}

/**
 * Role-section card click against a Map keyed by signupId.
 * - Checking a role copy selects/reassigns that signup to groupRole.
 * - Unchecking the currently assigned role copy deselects the signup.
 * - Unchecking a non-assigned copy is a no-op (those copies are not checked).
 */
export function applyRoleCopyToggle(args: {
  staged: Map<string, CharacterRole | null>;
  signupId: string;
  groupRole: CharacterRole | null;
  checked: boolean;
  /** Other BOOSTER signup ids for the same user that must be cleared on select. */
  replaceBoosterSignupIds?: Iterable<string>;
}): Map<string, CharacterRole | null> {
  const next = new Map(args.staged);
  const currentRole = next.get(args.signupId);
  const isSelected = next.has(args.signupId);

  if (args.groupRole == null) {
    if (!args.checked) {
      next.delete(args.signupId);
      return next;
    }
    next.set(args.signupId, null);
    return next;
  }

  if (!args.checked) {
    if (isSelected && currentRole === args.groupRole) {
      next.delete(args.signupId);
    }
    return next;
  }

  for (const otherId of args.replaceBoosterSignupIds ?? []) {
    if (otherId !== args.signupId) next.delete(otherId);
  }
  next.set(args.signupId, args.groupRole);
  return next;
}

/** Only the assigned role copy (or lootbuddy) renders as checked. */
export function isRoleCopyChecked(args: {
  stagedRole: CharacterRole | null | undefined;
  groupRole: CharacterRole | null;
}): boolean {
  if (args.stagedRole === undefined) return false;
  if (args.groupRole == null) return true;
  return args.stagedRole === args.groupRole;
}

/** Ambiguous historic DPS copy is checked while the slot is awaiting or holding a DPS subtype. */
export function isUnassignedDpsCopyChecked(stagedRole: CharacterRole | null | undefined): boolean {
  if (stagedRole === undefined) return false;
  return stagedRole == null || stagedRole === "MELEE_DPS" || stagedRole === "RANGED_DPS";
}

/**
 * Checking the Unassigned DPS row selects the signup without guessing a subtype.
 * Unchecking it clears the slot only when this copy is the checked one.
 */
export function applyUnassignedDpsToggle(args: {
  staged: Map<string, CharacterRole | null>;
  signupId: string;
  checked: boolean;
  replaceBoosterSignupIds?: Iterable<string>;
}): Map<string, CharacterRole | null> {
  const next = new Map(args.staged);
  const current = next.has(args.signupId) ? (next.get(args.signupId) ?? null) : undefined;
  if (!args.checked) {
    if (isUnassignedDpsCopyChecked(current)) next.delete(args.signupId);
    return next;
  }
  for (const otherId of args.replaceBoosterSignupIds ?? []) {
    if (otherId !== args.signupId) next.delete(otherId);
  }
  next.set(args.signupId, null);
  return next;
}
