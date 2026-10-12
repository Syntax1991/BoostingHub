import { DEFAULT_TIME_ZONE, fromDatetimeLocalValue, zonedParts } from "@/lib/datetime";
import { classifyRunWeek } from "@/lib/wow-run-week";
import { COMMUNITY_WEEKDAYS, type CommunityWeekday } from "@/models/enums";

export const COMMUNITY_SCHEDULE_TIME_ZONE = DEFAULT_TIME_ZONE;
export const COMMUNITY_SCHEDULE_LABEL_MAX = 80;
export const COMMUNITY_SCHEDULE_NOTES_MAX = 500;
/** Max weekly slots in one Create Schedule / Add times batch. */
export const MAX_SLOTS_PER_PLAN = 20;

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** en-GB short weekday from Intl → CommunityWeekday. */
const SHORT_TO_WEEKDAY: Record<string, CommunityWeekday> = {
  Mon: "MONDAY",
  Tue: "TUESDAY",
  Wed: "WEDNESDAY",
  Thu: "THURSDAY",
  Fri: "FRIDAY",
  Sat: "SATURDAY",
  Sun: "SUNDAY",
};

const WEEKDAY_TO_SHORT: Record<CommunityWeekday, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

export function isCommunityWeekday(value: string): value is CommunityWeekday {
  return (COMMUNITY_WEEKDAYS as readonly string[]).includes(value);
}

export function parseCommunityLocalStartTime(value: string): string {
  const trimmed = value.trim();
  if (!LOCAL_TIME_PATTERN.test(trimmed)) {
    throw new RangeError("Invalid local start time.");
  }
  return trimmed;
}

export function communityWeekdayShortLabel(weekday: CommunityWeekday): string {
  return WEEKDAY_TO_SHORT[weekday];
}

type LocalDate = { year: number; month: number; day: number };

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function addLocalDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function localInstant(date: LocalDate, localStartTime: string, timeZone: string): Date {
  const local = `${date.year}-${pad(date.month)}-${pad(date.day)}T${localStartTime}`;
  return new Date(fromDatetimeLocalValue(local, timeZone));
}

export type RaidIdWindow = "CURRENT" | "NEXT";

export type ScheduleOccurrence = {
  /** Concrete UTC ISO instant for this slot in the chosen raid-ID window. */
  scheduledStartAt: string;
  weekday: CommunityWeekday;
  localStartTime: string;
  /** Calendar Y-M-D in the community timezone for this occurrence. */
  localDate: string;
  window: RaidIdWindow;
  /** Raid-ID window lower bound (from classifyRunWeek). */
  windowStartAt: string;
  /** Raid-ID window upper bound (exclusive). */
  windowEndAt: string;
};

/**
 * Resolve a recurring Community Schedule slot into a concrete occurrence for
 * CURRENT or NEXT raid-ID week (Wednesday 06:00 Europe/Berlin boundary).
 *
 * Never adds `7 * 24h` in UTC — every wall-clock instant is recomputed via
 * `fromDatetimeLocalValue` so 19:45 local stays 19:45 across CET/CEST.
 */
export function resolveScheduleSlotOccurrence(input: {
  weekday: CommunityWeekday;
  localStartTime: string;
  window: RaidIdWindow;
  now?: Date;
  timeZone?: string;
}): ScheduleOccurrence {
  const timeZone = input.timeZone ?? COMMUNITY_SCHEDULE_TIME_ZONE;
  const localStartTime = parseCommunityLocalStartTime(input.localStartTime);
  if (!isCommunityWeekday(input.weekday)) {
    throw new RangeError("Invalid weekday.");
  }

  const now = input.now ?? new Date();
  const classification = classifyRunWeek({
    scheduledStartAt: now.toISOString(),
    now,
    timeZone,
  });
  const windowStartIso =
    input.window === "CURRENT" ? classification.currentStart : classification.nextStart;
  const windowEndIso =
    input.window === "CURRENT" ? classification.nextStart : classification.followingStart;
  const windowStart = new Date(windowStartIso).getTime();
  const windowEnd = new Date(windowEndIso).getTime();

  const startParts = zonedParts(new Date(windowStartIso), timeZone);
  let cursor: LocalDate = {
    year: startParts.year,
    month: startParts.month,
    day: startParts.day,
  };

  // Walk at most 8 local days from the window start calendar date.
  let occurrence: Date | null = null;
  for (let step = 0; step < 8; step += 1) {
    const parts = zonedParts(localInstant(cursor, "12:00", timeZone), timeZone);
    const short = parts.weekday;
    const weekday = SHORT_TO_WEEKDAY[short];
    if (weekday === input.weekday) {
      const candidate = localInstant(cursor, localStartTime, timeZone);
      const t = candidate.getTime();
      if (t >= windowStart && t < windowEnd) {
        occurrence = candidate;
        break;
      }
      // Same weekday but before the Wed 06:00 lower bound — try +7 local days.
      const nextWeek = addLocalDays(cursor, 7);
      const nextCandidate = localInstant(nextWeek, localStartTime, timeZone);
      const nt = nextCandidate.getTime();
      if (nt >= windowStart && nt < windowEnd) {
        occurrence = nextCandidate;
        break;
      }
    }
    cursor = addLocalDays(cursor, 1);
  }

  if (!occurrence) {
    throw new RangeError("Could not resolve schedule occurrence in raid-ID window.");
  }

  const local = zonedParts(occurrence, timeZone);
  return {
    scheduledStartAt: occurrence.toISOString(),
    weekday: input.weekday,
    localStartTime,
    localDate: `${local.year}-${pad(local.month)}-${pad(local.day)}`,
    window: input.window,
    windowStartAt: windowStartIso,
    windowEndAt: windowEndIso,
  };
}

export function compareScheduleOccurrences(
  a: { scheduledStartAt: string; slotId: string },
  b: { scheduledStartAt: string; slotId: string },
): number {
  const byTime = a.scheduledStartAt.localeCompare(b.scheduledStartAt);
  if (byTime !== 0) return byTime;
  return a.slotId.localeCompare(b.slotId);
}

/**
 * The occurrence of a slot inside the raid-ID window that contains `instant`
 * (Wed 06:00 Europe/Berlin boundaries; DST-safe via resolveScheduleSlotOccurrence).
 */
export function scheduleOccurrenceInWindowOf(input: {
  weekday: CommunityWeekday;
  localStartTime: string;
  instant: Date;
  timeZone?: string;
}): ScheduleOccurrence {
  return resolveScheduleSlotOccurrence({
    weekday: input.weekday,
    localStartTime: input.localStartTime,
    window: "CURRENT",
    now: input.instant,
    timeZone: input.timeZone,
  });
}

/** How a Schedule slot starts: the materializer's activation boundary choice. */
export type ScheduleStart =
  | { mode: "IMMEDIATE" }
  /** First occurrence is the one in the next raid ID (the current raid ID is skipped). */
  | { mode: "NEXT_RAID_ID" }
  /** Skip the first upcoming occurrence; start with the one after it. */
  | { mode: "SKIP_FIRST" }
  /** First occurrence starting on or after this Europe/Berlin calendar date (YYYY-MM-DD). */
  | { mode: "FROM_DATE"; date: string };

export const SCHEDULE_START_MODES = ["IMMEDIATE", "NEXT_RAID_ID", "SKIP_FIRST", "FROM_DATE"] as const;

/**
 * Resolves a start choice into the persisted boundary (`firstWindowStartAt`:
 * raid-ID window start of the first eligible occurrence; null = immediately)
 * plus that first eligible occurrence, deterministically from `now`.
 * A boundary at or before the first upcoming occurrence's window is null.
 */
export function resolveScheduleStartBoundary(input: {
  weekday: CommunityWeekday;
  localStartTime: string;
  start: ScheduleStart;
  now?: Date;
  timeZone?: string;
}): { firstWindowStartAt: string | null; firstOccurrence: ScheduleOccurrence } {
  const timeZone = input.timeZone ?? COMMUNITY_SCHEDULE_TIME_ZONE;
  const now = input.now ?? new Date();
  const base = { weekday: input.weekday, localStartTime: input.localStartTime, timeZone };
  const current = resolveScheduleSlotOccurrence({ ...base, window: "CURRENT", now });
  const upcoming =
    Date.parse(current.scheduledStartAt) >= now.getTime()
      ? current
      : resolveScheduleSlotOccurrence({ ...base, window: "NEXT", now });
  const after = (occurrence: ScheduleOccurrence) =>
    scheduleOccurrenceInWindowOf({ ...base, instant: new Date(occurrence.windowEndAt) });

  let first: ScheduleOccurrence;
  switch (input.start.mode) {
    case "IMMEDIATE":
      return { firstWindowStartAt: null, firstOccurrence: upcoming };
    case "NEXT_RAID_ID":
      first = resolveScheduleSlotOccurrence({ ...base, window: "NEXT", now });
      break;
    case "SKIP_FIRST":
      first = after(upcoming);
      break;
    case "FROM_DATE": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start.date)) {
        throw new RangeError("Use a YYYY-MM-DD date.");
      }
      const dayStart = new Date(fromDatetimeLocalValue(`${input.start.date}T00:00`, timeZone));
      if (Number.isNaN(dayStart.getTime())) {
        throw new RangeError("Use a valid date.");
      }
      first = scheduleOccurrenceInWindowOf({ ...base, instant: dayStart });
      if (Date.parse(first.scheduledStartAt) < dayStart.getTime()) {
        first = after(first);
      }
      break;
    }
  }
  if (Date.parse(first.windowStartAt) <= Date.parse(upcoming.windowStartAt)) {
    return { firstWindowStartAt: null, firstOccurrence: upcoming };
  }
  return { firstWindowStartAt: first.windowStartAt, firstOccurrence: first };
}

/** True when an occurrence's raid-ID window lies before the slot's activation boundary. */
export function isBeforeScheduleStart(firstWindowStartAt: string | null | undefined, windowStartAt: string): boolean {
  return Boolean(firstWindowStartAt) && Date.parse(windowStartAt) < Date.parse(firstWindowStartAt!);
}
