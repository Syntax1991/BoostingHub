import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_ZONE,
  formatDate,
  formatDateTime,
  formatTime,
  fromDatetimeLocalValue,
  resetIdentifierFor,
} from "@/lib/datetime";
import { normalizeTimeZone } from "@/lib/timezone";

const BERLIN = "Europe/Berlin";
const TORONTO = "America/Toronto";

/** A Run planned at 20:00 Berlin wall time (scheduling authority) on `date`. */
const berlin2000 = (date: string) => fromDatetimeLocalValue(`${date}T20:00`, BERLIN);

describe("viewer timezone display (BWP-3)", () => {
  // 2026: NA DST starts Mar 8 / ends Nov 1; EU DST starts Mar 29 / ends Oct 25.
  it.each([
    ["both standard (Jan)", "2026-01-15", "2026-01-15T19:00:00.000Z", "14:00"],
    ["NA already DST, EU not (Mar 18)", "2026-03-18", "2026-03-18T19:00:00.000Z", "15:00"],
    ["EU switch day (Mar 29)", "2026-03-29", "2026-03-29T18:00:00.000Z", "14:00"],
    ["both DST (Apr)", "2026-04-15", "2026-04-15T18:00:00.000Z", "14:00"],
    ["EU back to standard, NA still DST (Oct 28)", "2026-10-28", "2026-10-28T19:00:00.000Z", "15:00"],
    ["NA switch day (Nov 1)", "2026-11-01", "2026-11-01T19:00:00.000Z", "14:00"],
    ["both standard again (Nov 4)", "2026-11-04", "2026-11-04T19:00:00.000Z", "14:00"],
  ])("%s: Berlin 20:00 is the same instant, shown in Toronto local time", (_label, date, utc, torontoTime) => {
    const instant = berlin2000(date);
    // Stored instant is unchanged by any viewer.
    expect(instant).toBe(utc);
    expect(formatTime(instant, BERLIN)).toBe("20:00");
    expect(formatTime(instant, TORONTO)).toBe(torontoTime);
  });

  it("the date can differ across zones for the same instant", () => {
    const instant = berlin2000("2026-01-15");
    expect(formatDate(instant, BERLIN)).toBe("Thu 15/01/2026");
    // 01:30 Berlin = 19:30 previous day in Toronto.
    const late = fromDatetimeLocalValue("2026-01-16T01:30", BERLIN);
    expect(formatDateTime(late, BERLIN)).toBe("Fri 16/01/2026 01:30");
    expect(formatDateTime(late, TORONTO)).toBe("Thu 15/01/2026 19:30");
  });

  it("falls back to Europe/Berlin without a valid configured timezone", () => {
    expect(DEFAULT_TIME_ZONE).toBe(BERLIN);
    for (const value of [null, undefined, "", "   ", "UTC+2", "Mars/Olympus"]) {
      expect(normalizeTimeZone(value)).toBe(BERLIN);
    }
    expect(normalizeTimeZone(TORONTO)).toBe(TORONTO);
    // Formatting without an explicit zone is the Berlin fallback.
    expect(formatTime(berlin2000("2026-04-15"))).toBe("20:00");
  });

  it("reset identifier depends only on the instant — no viewer timezone input", () => {
    const instant = berlin2000("2026-10-14");
    expect(resetIdentifierFor.length).toBeLessThanOrEqual(1);
    expect(resetIdentifierFor(instant)).toBe("2026-W42");
    expect(resetIdentifierFor(new Date(instant))).toBe(resetIdentifierFor(instant));
  });
});
