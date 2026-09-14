import { vi } from "vitest";
import { classifyRunWeek } from "@/lib/wow-run-week";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/**
 * Freeze only `Date` / `Date.now()`. Leaves setTimeout/setInterval real so
 * Prisma and other async I/O keep working under Vitest.
 */
export function freezeSystemTime(isoOrDate: string | Date): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate);
}

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
