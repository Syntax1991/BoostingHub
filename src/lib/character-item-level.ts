/**
 * Item level for roster display must not drop on refresh: a temporary
 * unequipped weapon (or a lagging profile) can report a lower equipped
 * value than the character's known geared peak. Keep the higher of the
 * stored value and the newly observed equipped value.
 */
export function resolveMonotonicItemLevel(
  stored: number | null | undefined,
  incoming: number | null | undefined,
): number | null {
  const previous =
    typeof stored === "number" && Number.isFinite(stored) ? stored : null;
  const next =
    typeof incoming === "number" && Number.isFinite(incoming) ? incoming : null;
  if (previous == null && next == null) return null;
  if (previous == null) return next;
  if (next == null) return previous;
  return Math.max(previous, next);
}
