/**
 * Character.itemLevel is Postgres int4. Blizzard occasionally and Raider.IO
 * commonly return fractional equipped_item_level (e.g. 322.625). Floor so we
 * never inflate past the truncated display value and never write a float.
 */
export function toStoredItemLevel(value: number): number;
export function toStoredItemLevel(value: number | null | undefined): number | null;
export function toStoredItemLevel(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.floor(value);
}

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
  const previous = toStoredItemLevel(stored);
  const next = toStoredItemLevel(incoming);
  if (previous == null && next == null) return null;
  if (previous == null) return next;
  if (next == null) return previous;
  return Math.max(previous, next);
}
