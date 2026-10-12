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

/** Weekly Draft release: Monday 12:00 Europe/Berlin (wall clock, DST-safe). */
export const SCHEDULE_DRAFT_RELEASE_LOCAL_TIME = "12:00";
export const SCHEDULE_DRAFT_RELEASE_LABEL = "Monday 12:00 (Europe/Berlin)";

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/**
 * The weekly Draft release that governs automatic materialization at `now`:
 * the latest Monday 12:00 Europe/Berlin at or before `now`, and the raid ID it
 * releases — the one starting the FOLLOWING Wednesday 06:00 (never the raid ID
 * that began the previous Wednesday, although Monday belongs to it).
 * A pass after the release (catch-up, e.g. Tuesday or after downtime) targets
 * the same raid ID until the next Monday 12:00.
 */
export function scheduleDraftRelease(
  now: Date = new Date(),
  timeZone: string = COMMUNITY_SCHEDULE_TIME_ZONE,
): { releaseAt: string; targetWindowStartAt: string } {
  const parts = zonedParts(now, timeZone);
  let monday = addLocalDays({ year: parts.year, month: parts.month, day: parts.day }, -WEEKDAY_INDEX[parts.weekday]!);
  let releaseAt = localInstant(monday, SCHEDULE_DRAFT_RELEASE_LOCAL_TIME, timeZone);
  if (releaseAt.getTime() > now.getTime()) {
    monday = addLocalDays(monday, -7);
    releaseAt = localInstant(monday, SCHEDULE_DRAFT_RELEASE_LOCAL_TIME, timeZone);
  }
  const targetWindowStart = localInstant(addLocalDays(monday, 2), "06:00", timeZone);
  return { releaseAt: releaseAt.toISOString(), targetWindowStartAt: targetWindowStart.toISOString() };
}

/** The next Monday 12:00 Europe/Berlin strictly after `now` (for display). */
export function nextScheduleDraftReleaseAt(now: Date = new Date(), timeZone: string = COMMUNITY_SCHEDULE_TIME_ZONE): string {
  const { releaseAt } = scheduleDraftRelease(now, timeZone);
  const parts = zonedParts(new Date(releaseAt), timeZone);
  return localInstant(
    addLocalDays({ year: parts.year, month: parts.month, day: parts.day }, 7),
    SCHEDULE_DRAFT_RELEASE_LOCAL_TIME,
    timeZone,
  ).toISOString();
}

/** Counts of the Runs a Schedule time had produced or been linked to (future occurrences only). */
export type ScheduleRunCounts = {
  /** Schedule-created Runs still in Draft — archived when their occurrence goes away. */
  retiredDrafts: number;
  /** Schedule-created Runs that already left Draft — never changed by Schedule edits. */
  protectedRuns: number;
  /** Existing Runs linked via "Use existing Run" — never changed by Schedule edits. */
  attachedRuns: number;
};

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Result message after a Schedule edit / deactivation / deletion. */
export function describeScheduleCleanupResult(counts: ScheduleRunCounts): string {
  const parts: string[] = [];
  if (counts.retiredDrafts > 0) {
    parts.push(`${plural(counts.retiredDrafts, "scheduled Draft Run")} archived.`);
  }
  if (counts.protectedRuns > 0) {
    parts.push(`${plural(counts.protectedRuns, "active Run")} unchanged.`);
  }
  if (counts.attachedRuns > 0) {
    parts.push(`${plural(counts.attachedRuns, "linked existing Run")} unchanged.`);
  }
  return parts.join(" ");
}

/** Confirmation lines before a Schedule time is deleted / deactivated / moved. */
export function describeScheduleCleanupPreview(counts: ScheduleRunCounts): string[] {
  const lines: string[] = [];
  if (counts.retiredDrafts > 0) {
    lines.push(
      `${plural(counts.retiredDrafts, "scheduled Draft Run")} will be archived.`,
    );
  }
  if (counts.protectedRuns > 0) {
    lines.push(
      `${plural(counts.protectedRuns, "active Run")} will remain unchanged.`,
    );
  }
  lines.push("Linked existing Runs will remain unchanged.");
  return lines;
}
