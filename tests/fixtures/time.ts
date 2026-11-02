import { vi } from "vitest";
import { classifyRunWeek } from "@/lib/wow-run-week";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/**
 * Freeze only `Date` / `Date.now()`. Leaves setTimeout/setInterval real so
 * Prisma and other async I/O keep working under Vitest.
 *
 * `advance: true` starts the clock at that instant and lets it run on with
 * real time — deterministic start, but successive writes still get later
 * timestamps (so `updatedAt`-based "unchanged" assertions keep their teeth).
 */
export function freezeSystemTime(isoOrDate: string | Date, options: { advance?: boolean } = {}): void {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: options.advance ?? false });
  vi.setSystemTime(typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate);
}

/**
 * Wall clock for the DB-backed Community Schedule suites: a fixed instant
 * before every Run their fixtures create (Jan / Feb 2027). Run creation checks
 * the real clock ("Scheduled start cannot be in the past"), so without it those
 * suites would start failing once the fixture dates become history.
 */
export const SCHEDULE_TEST_CLOCK = "2027-01-01T12:00:00.000Z";

/**
 * Wall clock for DB-backed suites that assert on a global newest-first feed
 * (`activityRepository.listRecent`, `userNotificationRepository.listForUser`)
 * with a limit. The shared test DB keeps the rows earlier suites wrote at
 * their frozen clocks (SCHEDULE_TEST_CLOCK and the Jan 2027 instants in the
 * schedule suites), which sort ahead of anything written at the real "now"
 * and push a suite's own events out of the top N. Must stay after every other
 * frozen clock in the DB suites.
 */
export const FEED_TEST_CLOCK = "2027-06-01T12:00:00.000Z";

/**
 * A Thursday, the day after the Wednesday 06:00 Europe/Berlin raid-ID reset,
 * for DB suites that need their Runs in a known raid week. Freeze it with
 * `advance: true`; before FEED_TEST_CLOCK as that clock requires.
 */
export const RAID_WEEK_TEST_CLOCK = "2027-03-04T12:00:00.000Z";
/** Saturday evening of RAID_WEEK_TEST_CLOCK's week: a Run start that classifies CURRENT. */
export const CURRENT_WEEK_RUN_START = "2027-03-06T19:00:00.000Z";

/**
 * Wall clock for the Discord Schedule lane suite, which classifies a week after
 * it (so a Run in the PAST week was still creatable). Its empty-schedule
 * assertions read every Run in the CURRENT and NEXT weeks (14 to 28 April
 * 2027), so no other suite may schedule Runs there. Before FEED_TEST_CLOCK.
 */
export const DISCORD_SCHEDULE_TEST_CLOCK = "2027-04-08T12:00:00.000Z";

export function restoreSystemTime(): void {
  vi.useRealTimers();
}

/** ISO timestamp `ms` after the (possibly frozen) clock. */
export function futureIsoFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

/**
 * A schedule still inside the CURRENT raid-ID week (Wed 06:00 Europe/Berlin)
 * and strictly after now — for tests that assert `targetBucket === "CURRENT"`.
 *
 * Plain `now + N days` is not safe near week end: from Monday, +2 days lands
 * in NEXT after the Wednesday reset.
 */
export function currentWeekFutureIso(options?: { hoursAhead?: number }): string {
  const hoursAhead = options?.hoursAhead ?? 2;
  const now = new Date();
  const { nextStart } = classifyRunWeek({ scheduledStartAt: now.toISOString(), now });
  const preferred = new Date(now.getTime() + hoursAhead * HOUR_MS);
  if (preferred.getTime() < Date.parse(nextStart)) {
    return preferred.toISOString();
  }
  const mid = new Date((now.getTime() + Date.parse(nextStart)) / 2);
  if (mid.getTime() <= now.getTime()) {
    throw new Error("No remaining CURRENT-week window after now for a future schedule");
  }
  return mid.toISOString();
}
