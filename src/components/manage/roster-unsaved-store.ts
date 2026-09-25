"use client";

import { useSyncExternalStore } from "react";

/**
 * Which Runs currently have unsaved roster-builder edits in this browser tab.
 * Add Booster (Run header or Roster tab) is a server mutation that reloads the
 * roster, so it stays disabled while local edits exist instead of silently
 * discarding them. Client-only; the server never relies on it.
 */
const unsavedRunIds = new Set<string>();
const listeners = new Set<() => void>();

export function setRosterHasUnsavedEdits(runId: string, unsaved: boolean): void {
  const had = unsavedRunIds.has(runId);
  if (unsaved === had) return;
  if (unsaved) unsavedRunIds.add(runId);
  else unsavedRunIds.delete(runId);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRosterHasUnsavedEdits(runId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => unsavedRunIds.has(runId),
    () => false,
  );
}
