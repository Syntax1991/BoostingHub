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
