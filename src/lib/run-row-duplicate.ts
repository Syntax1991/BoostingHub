import { DEFAULT_TIME_ZONE, fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime";

/** Quick duplicate offsets on Create Run rows: same start, +1 hour, +2 hours. */
export const QUICK_DUPLICATE_OFFSETS_HOURS = [0, 1, 2] as const;

export type QuickDuplicateOffset = (typeof QUICK_DUPLICATE_OFFSETS_HOURS)[number];

const HOUR_MS = 60 * 60 * 1000;

/**
 * Shift a `datetime-local` value (wall-clock time in `timeZone`) by real
 * elapsed hours: local → UTC instant (DST-aware, `fromDatetimeLocalValue`)
 * → + hours → back to local. Crossing midnight / month / year is plain
 * instant arithmetic; across a DST change the wall clock moves by what one
 * real hour is there (e.g. 01:30 + 1h on the spring-forward night is 03:30).
 * An unparseable value is returned unchanged.
 */
export function shiftDatetimeLocal(
  local: string,
  hours: number,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  if (hours === 0) return local;
  try {
    const instant = Date.parse(fromDatetimeLocalValue(local, timeZone));
    if (Number.isNaN(instant)) return local;
    return toDatetimeLocalValue(new Date(instant + hours * HOUR_MS).toISOString(), timeZone);
  } catch {
    return local;
  }
}

/** A row may be duplicated only while the form stays within the multi-create limit. */
export function canAddRunRow(rowCount: number, maxRuns: number): boolean {
  return rowCount < maxRuns;
}

type DuplicableRow = { key: string; scheduledLocal: string; overrides: object; expanded: boolean };

/**
 * Rows after duplicating the row `sourceKey` (the row the action was invoked
 * on): a copy of its overrides with its own key and a start shifted by
 * `offsetHours`, inserted directly below it. Unchanged when the source is
 * missing or the form is already at `maxRuns`.
 */
export function duplicateRunRow<T extends DuplicableRow>(
  rows: readonly T[],
  sourceKey: string,
  offsetHours: QuickDuplicateOffset,
  maxRuns: number,
  newKey: () => string,
  timeZone: string = DEFAULT_TIME_ZONE,
): T[] {
  const index = rows.findIndex((row) => row.key === sourceKey);
  if (index < 0 || !canAddRunRow(rows.length, maxRuns)) return [...rows];
  const source = rows[index]!;
  const copy: T = {
    ...source,
    key: newKey(),
    scheduledLocal: shiftDatetimeLocal(source.scheduledLocal, offsetHours, timeZone),
    overrides: { ...source.overrides },
    expanded: false,
  };
  return [...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)];
}

export function quickDuplicateLabel(offset: QuickDuplicateOffset): string {
  if (offset === 0) return "Duplicate run";
  return `Duplicate run +${offset} hour${offset === 1 ? "" : "s"}`;
}
