/**
 * Pure state helpers for the Create Schedule / Add times dialogs (no React, no
 * server imports — unit-testable).
 */

/** Shown when a Create Schedule request comes from a page loaded before a deploy. */
export const SCHEDULE_FORM_OUTDATED_MESSAGE =
  "This page is out of date — reload it and create the Schedule again.";

/**
 * Applies a fresh existing-Run candidate list (`available`, from the server)
 * to the dialog state. Only Runs that are genuinely no longer eligible (not in
 * the server's list) are dropped: the basis Run and each time's first-occurrence
 * Run independently — an additional time's Run never affects the basis.
 * Returns the same references when nothing changes.
 */
export function pruneUnavailableRuns<T extends { attachRunId: string | null }>(
  state: { basisRunId: string | null; slots: readonly T[] },
  available: ReadonlySet<string>,
): { basisRunId: string | null; slots: readonly T[] } {
  const basisRunId = state.basisRunId && !available.has(state.basisRunId) ? null : state.basisRunId;
  const stale = state.slots.some((row) => row.attachRunId && !available.has(row.attachRunId));
  const slots = stale
    ? state.slots.map((row) =>
        row.attachRunId && !available.has(row.attachRunId) ? { ...row, attachRunId: null } : row,
      )
    : state.slots;
  return { basisRunId, slots };
}
