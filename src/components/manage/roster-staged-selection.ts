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
