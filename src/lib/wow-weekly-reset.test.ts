import { describe, expect, it } from "vitest";
import {
  getRegionalWeeklyReset,
  isTimestampInRegionalReset,
  regionalWeeklyResetStart,
} from "@/lib/wow-weekly-reset";

describe("wow weekly reset", () => {
  it("computes EU Wednesday 04:00 UTC windows with stable identifiers", () => {
    // Thursday after EU reset in a known week.
    const now = new Date("2026-03-12T12:00:00.000Z");
    const window = getRegionalWeeklyReset("EU", now);
    expect(window.start.toISOString()).toBe("2026-03-11T04:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-03-18T04:00:00.000Z");
    expect(window.resetIdentifier).toBe("2026-W11");
  });

  it("computes US Tuesday 15:00 UTC windows", () => {
    const now = new Date("2026-03-12T12:00:00.000Z");
    const window = getRegionalWeeklyReset("US", now);
    expect(window.start.toISOString()).toBe("2026-03-10T15:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-03-17T15:00:00.000Z");
    expect(window.resetIdentifier).toBe("2026-W11");
  });

  it("keeps EU and US reset starts distinct around midweek", () => {
    const now = new Date("2026-03-11T02:00:00.000Z"); // before EU reset, after US
    const eu = regionalWeeklyResetStart("EU", now);
    const us = regionalWeeklyResetStart("US", now);
    expect(us.toISOString()).toBe("2026-03-10T15:00:00.000Z");
    expect(eu.toISOString()).toBe("2026-03-04T04:00:00.000Z");
  });

  it("classifies timestamps with inclusive start and exclusive end", () => {
    const window = getRegionalWeeklyReset("EU", new Date("2026-03-12T12:00:00.000Z"));
    expect(isTimestampInRegionalReset(window.start.getTime(), window)).toBe(true);
    expect(isTimestampInRegionalReset(window.start.getTime() + 3_600_000, window)).toBe(true);
    expect(isTimestampInRegionalReset(window.start.getTime() - 1, window)).toBe(false);
    expect(isTimestampInRegionalReset(window.end.getTime(), window)).toBe(false);
    expect(isTimestampInRegionalReset(window.end.getTime() - 1, window)).toBe(true);
  });
});
