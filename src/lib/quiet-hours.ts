import { zonedParts } from "@/lib/datetime";

/** Strict 24-hour HH:MM (00:00–23:59). */
export const QUIET_HOURS_HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type QuietHoursHm = { hour: number; minute: number };

export type QuietHoursSnapshot = {
  enabled: boolean;
  start: string | null;
  end: string | null;
};

/**
 * Parse exact HH:MM. Returns null when the string is not a valid quiet-hours time.
 */
export function parseQuietHoursHm(value: string | null | undefined): QuietHoursHm | null {
  if (value == null) return null;
  const match = QUIET_HOURS_HHMM_RE.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function quietHoursHmToMinutes(hm: QuietHoursHm): number {
  return hm.hour * 60 + hm.minute;
}

/**
 * Whether `now` falls inside Quiet Hours for the given local wall-clock window.
 *
 * - start inclusive, end exclusive
 * - start < end → same calendar day window
 * - start > end → overnight window spanning midnight
 * - start === end is invalid configuration (caller must reject); treated as not quiet
 */
export function isInQuietHours(input: {
  now: Date;
  timeZone: string;
  start: string;
  end: string;
}): boolean {
  const start = parseQuietHoursHm(input.start);
  const end = parseQuietHoursHm(input.end);
  if (!start || !end) return false;
  const startMin = quietHoursHmToMinutes(start);
  const endMin = quietHoursHmToMinutes(end);
  if (startMin === endMin) return false;

  const parts = zonedParts(input.now, input.timeZone);
  const nowMin = parts.hour * 60 + parts.minute;

  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  // Overnight: quiet from start through midnight, and from midnight until end.
  return nowMin >= startMin || nowMin < endMin;
}

/**
 * UTC ISO for the next Quiet Hours end (exclusive boundary) relative to `now`.
 * Assumes `now` is currently inside Quiet Hours for a valid start≠end window.
 *
 * DST:
 * - spring-forward nonexistent local end → first valid instant at or after that local time
 * - fall-back ambiguous local end → later occurrence (quiet period not shortened)
 */
export function nextQuietHoursEndUtc(input: {
  now: Date;
  timeZone: string;
  start: string;
  end: string;
}): string {
  const start = parseQuietHoursHm(input.start);
  const end = parseQuietHoursHm(input.end);
  if (!start || !end) {
    throw new RangeError("Quiet Hours start/end must be valid HH:MM.");
  }
  const startMin = quietHoursHmToMinutes(start);
  const endMin = quietHoursHmToMinutes(end);
  if (startMin === endMin) {
    throw new RangeError("Quiet Hours start and end must differ.");
  }

  const parts = zonedParts(input.now, input.timeZone);
  const nowMin = parts.hour * 60 + parts.minute;

  let year = parts.year;
  let month = parts.month;
  let day = parts.day;

  if (startMin > endMin) {
    // Overnight: before midnight (nowMin >= start) → end is tomorrow.
    if (nowMin >= startMin) {
      ({ year, month, day } = addLocalCalendarDays(year, month, day, 1));
    }
  }

  return zonedLocalWallToUtcIso(
    { year, month, day, hour: end.hour, minute: end.minute },
    input.timeZone,
    { preferLaterOnAmbiguity: true },
  );
}

/**
 * Convert a local wall-clock date/time in `timeZone` to a UTC ISO instant.
 *
 * - Nonexistent local times (spring-forward): first valid instant at or after the
 *   requested local wall clock (walk forward minute-by-minute up to 3 hours).
 * - Ambiguous local times (fall-back): choose the later occurrence when
 *   `preferLaterOnAmbiguity` is true (Quiet Hours end default).
 */
export function zonedLocalWallToUtcIso(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
  options?: { preferLaterOnAmbiguity?: boolean },
): string {
  const preferLater = options?.preferLaterOnAmbiguity ?? true;

  for (let addMinutes = 0; addMinutes <= 180; addMinutes += 1) {
    const candidate = addLocalWallMinutes(local, addMinutes);
    const matches = findUtcInstantsForLocalWall(candidate, timeZone);
    if (matches.length === 0) continue;
    const chosen = preferLater ? matches[matches.length - 1]! : matches[0]!;
    return chosen.toISOString();
  }

  throw new RangeError(
    `Unable to resolve local wall time ${pad(local.year)}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)} in ${timeZone}.`,
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function addLocalCalendarDays(year: number, month: number, day: number, days: number) {
  // Use UTC noon as a calendar arithmetic anchor (avoids DST wall issues).
  const anchor = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
  };
}

function addLocalWallMinutes(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  minutes: number,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const total = local.hour * 60 + local.minute + minutes;
  const dayDelta = Math.floor(total / (24 * 60));
  const minsInDay = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const date = addLocalCalendarDays(local.year, local.month, local.day, dayDelta);
  return {
    ...date,
    hour: Math.floor(minsInDay / 60),
    minute: minsInDay % 60,
  };
}

/**
 * Find every UTC instant (minute resolution) whose local wall clock in `timeZone`
 * equals the requested Y-M-D HH:MM. Empty → nonexistent; 2+ → ambiguous.
 *
 * Strategy: iterative offset guess (same idea as fromDatetimeLocalValue), then
 * probe ±2h around each candidate to collect ambiguous fall-back duplicates.
 */
export function findUtcInstantsForLocalWall(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date[] {
  const desiredAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0);
  let guess = desiredAsUtc;
  let converged: Date | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const parts = zonedParts(new Date(guess), timeZone);
    const asZone = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    const delta = desiredAsUtc - asZone;
    if (delta === 0) {
      converged = new Date(guess);
      break;
    }
    guess += delta;
  }

  const matches: Date[] = [];
  const seen = new Set<number>();
  const pushIfMatch = (instant: Date) => {
    const parts = zonedParts(instant, timeZone);
    if (
      parts.year === local.year &&
      parts.month === local.month &&
      parts.day === local.day &&
      parts.hour === local.hour &&
      parts.minute === local.minute
    ) {
      const t = instant.getTime();
      if (!seen.has(t)) {
        seen.add(t);
        matches.push(instant);
      }
    }
  };

  if (converged) {
    // Ambiguity window: fall-back duplicates are typically 1h apart.
    for (let deltaMin = -150; deltaMin <= 150; deltaMin += 1) {
      pushIfMatch(new Date(converged.getTime() + deltaMin * 60_000));
    }
    matches.sort((a, b) => a.getTime() - b.getTime());
    return matches;
  }

  // Nonexistent: no iterative convergence — scan a narrow band around the guess.
  for (let deltaMin = -180; deltaMin <= 180; deltaMin += 1) {
    pushIfMatch(new Date(guess + deltaMin * 60_000));
  }
  matches.sort((a, b) => a.getTime() - b.getTime());
  return matches;
}
