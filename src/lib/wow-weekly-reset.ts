import type { WowRegion } from "@/models/enums";
import { resetIdentifierFor } from "@/lib/datetime";

/**
 * Regional WoW weekly reset windows (UTC).
 *
 * Source: established retail schedule documented by wowreset.com / community
 * maintenance clocks (cross-checked 2025–2026):
 * - EU: Wednesday 04:00 UTC (changed from 07:00 UTC on 2022-11-16)
 * - US (incl. Latin/Oceanic realms on US API): Tuesday 15:00 UTC
 *
 * BoostingHub uses these instants to classify Blizzard encounter
 * `last_kill_timestamp` into the current reset. Display/persistence still uses
 * `resetIdentifierFor(resetStart)` so identifiers stay compatible with Runs.
 */
const EU_RESET_UTC_DAY = 3; // Wednesday
const EU_RESET_UTC_HOUR = 4;
const US_RESET_UTC_DAY = 2; // Tuesday
const US_RESET_UTC_HOUR = 15;

export type RegionalWeeklyReset = {
  region: WowRegion;
  start: Date;
  end: Date;
  resetIdentifier: string;
};

function resetUtcDay(region: WowRegion): number {
  return region === "EU" ? EU_RESET_UTC_DAY : US_RESET_UTC_DAY;
}

function resetUtcHour(region: WowRegion): number {
  return region === "EU" ? EU_RESET_UTC_HOUR : US_RESET_UTC_HOUR;
}

function utcAt(year: number, monthIndex: number, day: number, hour: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, hour, 0, 0, 0));
}

/**
 * Most recent regional weekly reset start at or before `now`.
 */
export function regionalWeeklyResetStart(region: WowRegion, now: Date = new Date()): Date {
  const targetDay = resetUtcDay(region);
  const targetHour = resetUtcHour(region);
  const cursor = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), targetHour, 0, 0, 0),
  );

  // Walk back at most 8 days to the previous matching weekday/hour.
  for (let step = 0; step < 8; step += 1) {
    const candidate = utcAt(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth(),
      cursor.getUTCDate() - step,
      targetHour,
    );
    if (candidate.getUTCDay() !== targetDay) continue;
    if (candidate.getTime() <= now.getTime()) {
      return candidate;
    }
  }

  // Fallback: previous week same weekday.
  return utcAt(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 7,
    targetHour,
  );
}

export function getRegionalWeeklyReset(
  region: WowRegion,
  now: Date = new Date(),
): RegionalWeeklyReset {
  const start = regionalWeeklyResetStart(region, now);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    region,
    start,
    end,
    resetIdentifier: resetIdentifierFor(start),
  };
}

export function isTimestampInRegionalReset(
  timestampMs: number,
  window: Pick<RegionalWeeklyReset, "start" | "end">,
): boolean {
  return timestampMs >= window.start.getTime() && timestampMs < window.end.getTime();
}
