import { DEFAULT_TIME_ZONE, fromDatetimeLocalValue, zonedParts } from "@/lib/datetime";

export type WowRunWeekBucket = "CURRENT" | "NEXT" | "PAST" | "FUTURE";

export type RunWeekClassification = {
  bucket: WowRunWeekBucket;
  /** Start of the CURRENT window — the most recent Wednesday 06:00 local at or before `now`. */
  currentStart: string;
  /** Start of the NEXT window — exactly 7 local calendar days after `currentStart`. */
  nextStart: string;
  /** Start of the window after NEXT — exactly 7 local calendar days after `nextStart`. */
  followingStart: string;
};

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const WEDNESDAY = 3;
const RESET_HOUR = "06:00";

type LocalDate = { year: number; month: number; day: number };

/**
 * Pure calendar-date arithmetic (no timezone/DST involved — this only ever
 * moves a Y-M-D triple by whole days, using UTC internally purely as a
 * carry-safe integer calendar, never as a real instant).
 */
function addLocalDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/**
 * The real UTC instant of 06:00 local wall-clock time on the given calendar
 * date, in `timeZone`. Reuses `fromDatetimeLocalValue`'s DST-correcting
 * iteration (see datetime.ts) — Europe/Berlin's UTC offset for a Wednesday
 * 06:00 wall-clock instant depends on whether that date falls in CET or
 * CEST, so this can NEVER be a fixed UTC hour (see module doc below).
 */
function localResetInstant(date: LocalDate, timeZone: string): Date {
  const pad = (value: number) => String(value).padStart(2, "0");
  const local = `${date.year}-${pad(date.month)}-${pad(date.day)}T${RESET_HOUR}`;
  return new Date(fromDatetimeLocalValue(local, timeZone));
}

/**
 * The most recent Wednesday-06:00-local instant at or before `now`. Walks
 * back to this local week's Wednesday calendar date, then — if that
 * instant is still in the future relative to `now` (true only when `now`
 * itself falls on a Wednesday before 06:00 local) — steps back one further
 * local week.
 */
function mostRecentWednesdayReset(now: Date, timeZone: string): Date {
  const parts = zonedParts(now, timeZone);
  const dow = WEEKDAY_INDEX[parts.weekday] ?? 0;
  const daysSinceWednesday = (dow - WEDNESDAY + 7) % 7;
  let candidate = addLocalDays({ year: parts.year, month: parts.month, day: parts.day }, -daysSinceWednesday);
  let resetInstant = localResetInstant(candidate, timeZone);
  if (resetInstant.getTime() > now.getTime()) {
    candidate = addLocalDays(candidate, -7);
    resetInstant = localResetInstant(candidate, timeZone);
  }
  return resetInstant;
}

/**
 * Classifies a Run's `scheduledStartAt` against the product's own weekly
 * raid-ID boundary — Wednesday 06:00 Europe/Berlin — NOT Blizzard's regional
 * server reset (`wow-weekly-reset.ts`, a fixed UTC instant used only for
 * lockout/encounter classification). This boundary is deliberately
 * calendar/timezone-based rather than a fixed UTC offset: Europe/Berlin
 * alternates between CET (UTC+1) and CEST (UTC+2), and the product
 * invariant is "Wednesday 06:00 local wall-clock time", not "some fixed
 * number of UTC hours after the last boundary" — `currentStart + 7 days` in
 * UTC would silently drift the local reset time by an hour across a DST
 * transition, which is exactly the bug this helper exists to avoid (see
 * `mostRecentWednesdayReset`/`localResetInstant` — every boundary is
 * (re)computed from real calendar dates via `fromDatetimeLocalValue`, never
 * by adding `7 * 24h` in milliseconds).
 *
 * Half-open windows: CURRENT = [currentStart, nextStart), NEXT = [nextStart,
 * followingStart), PAST = anything before currentStart, FUTURE = anything at
 * or after followingStart. `now` is always injectable — never buried behind
 * an internal `Date.now()` — so classification stays deterministic in tests
 * and reproducible across a reconciliation pass.
 */
export function classifyRunWeek(input: {
  scheduledStartAt: string;
  now?: Date;
  timeZone?: string;
}): RunWeekClassification {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;

  const currentStart = mostRecentWednesdayReset(now, timeZone);
  const currentStartLocal = zonedParts(currentStart, timeZone);
  const nextStart = localResetInstant(addLocalDays(currentStartLocal, 7), timeZone);
  const nextStartLocal = zonedParts(nextStart, timeZone);
  const followingStart = localResetInstant(addLocalDays(nextStartLocal, 7), timeZone);

  const scheduled = new Date(input.scheduledStartAt).getTime();
  let bucket: WowRunWeekBucket;
  if (scheduled < currentStart.getTime()) {
    bucket = "PAST";
  } else if (scheduled < nextStart.getTime()) {
    bucket = "CURRENT";
  } else if (scheduled < followingStart.getTime()) {
    bucket = "NEXT";
  } else {
    bucket = "FUTURE";
  }

  return {
    bucket,
    currentStart: currentStart.toISOString(),
    nextStart: nextStart.toISOString(),
    followingStart: followingStart.toISOString(),
  };
}
