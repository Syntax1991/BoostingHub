import { describe, expect, it } from "vitest";
import { classifyRunWeek } from "@/lib/wow-run-week";

const TZ = "Europe/Berlin";

// Thursday 2026-01-15 12:00 Europe/Berlin (CET, UTC+1) — a plain winter
// instant with no DST involved. Its CURRENT window starts at the most
// recent Wednesday, 2026-01-14 06:00 CET = 2026-01-14T05:00:00.000Z.
const WINTER_NOW = new Date("2026-01-15T12:00:00.000Z");
const WINTER_CURRENT_START = "2026-01-14T05:00:00.000Z";
const WINTER_NEXT_START = "2026-01-21T05:00:00.000Z";
const WINTER_FOLLOWING_START = "2026-01-28T05:00:00.000Z";

// Thursday 2026-07-16 12:00 Europe/Berlin (CEST, UTC+2) — a plain summer
// instant. CURRENT window starts 2026-07-15 06:00 CEST = 2026-07-15T04:00:00.000Z.
const SUMMER_NOW = new Date("2026-07-16T12:00:00.000Z");
const SUMMER_CURRENT_START = "2026-07-15T04:00:00.000Z";
const SUMMER_NEXT_START = "2026-07-22T04:00:00.000Z";

describe("classifyRunWeek — live Discord week boundary (Sep 2026)", () => {
  // Observed live bug Run: Monday 14 September 2026 02:00 Europe/Berlin.
  // With now still inside that CURRENT window (before Wed 16 Sep 06:00 Berlin),
  // the Run must classify CURRENT — not NEXT.
  it("Monday 14 Sep 2026 02:00 Europe/Berlin is CURRENT", () => {
    const now = new Date("2026-09-13T12:00:00.000Z"); // Sat before the Mon run, still CURRENT week
    const result = classifyRunWeek({
      scheduledStartAt: "2026-09-14T00:00:00.000Z", // Mon 02:00 CEST
      now,
      timeZone: TZ,
    });
    expect(result.bucket).toBe("CURRENT");
    expect(result.currentStart).toBe("2026-09-09T04:00:00.000Z"); // Wed 09 Sep 06:00 CEST
    expect(result.nextStart).toBe("2026-09-16T04:00:00.000Z"); // Wed 16 Sep 06:00 CEST
  });
});

describe("classifyRunWeek — basic classification (winter, no DST)", () => {
  it("Tuesday before reset is PAST", () => {
    const result = classifyRunWeek({ scheduledStartAt: "2026-01-13T18:00:00.000Z", now: WINTER_NOW, timeZone: TZ });
    expect(result.bucket).toBe("PAST");
  });

  it("Wednesday 05:59:59 local is still PAST (one second before the boundary)", () => {
    // 05:59:59 CET = 04:59:59Z
    const result = classifyRunWeek({ scheduledStartAt: "2026-01-14T04:59:59.000Z", now: WINTER_NOW, timeZone: TZ });
    expect(result.bucket).toBe("PAST");
  });

  it("Wednesday 06:00:00 local is exactly CURRENT (half-open lower bound)", () => {
    const result = classifyRunWeek({ scheduledStartAt: WINTER_CURRENT_START, now: WINTER_NOW, timeZone: TZ });
    expect(result.bucket).toBe("CURRENT");
  });

  it("Wednesday just after reset is CURRENT", () => {
    const result = classifyRunWeek({ scheduledStartAt: "2026-01-14T05:00:01.000Z", now: WINTER_NOW, timeZone: TZ });
    expect(result.bucket).toBe("CURRENT");
  });

  it("current-week Thursday is CURRENT", () => {
    const result = classifyRunWeek({ scheduledStartAt: "2026-01-15T18:00:00.000Z", now: WINTER_NOW, timeZone: TZ });
    expect(result.bucket).toBe("CURRENT");
  });

  it("next Tuesday before its reset is still CURRENT", () => {
    const result = classifyRunWeek({ scheduledStartAt: "2026-01-20T18:00:00.000Z", now: WINTER_NOW, timeZone: TZ });
    expect(result.bucket).toBe("CURRENT");
  });

  it("next Wednesday exactly 06:00 is exactly NEXT (half-open lower bound)", () => {
    const result = classifyRunWeek({ scheduledStartAt: WINTER_NEXT_START, now: WINTER_NOW, timeZone: TZ });
    expect(result.bucket).toBe("NEXT");
  });

  it("one second before next Wednesday 06:00 is still CURRENT (half-open upper bound)", () => {
    const result = classifyRunWeek({ scheduledStartAt: "2026-01-21T04:59:59.000Z", now: WINTER_NOW, timeZone: TZ });
    expect(result.bucket).toBe("CURRENT");
  });

  it("following Wednesday exactly 06:00 is exactly FUTURE (half-open lower bound of the window after NEXT)", () => {
    const result = classifyRunWeek({ scheduledStartAt: WINTER_FOLLOWING_START, now: WINTER_NOW, timeZone: TZ });
    expect(result.bucket).toBe("FUTURE");
  });

  it("one second before the following Wednesday 06:00 is still NEXT (half-open upper bound)", () => {
    const result = classifyRunWeek({ scheduledStartAt: "2026-01-28T04:59:59.000Z", now: WINTER_NOW, timeZone: TZ });
    expect(result.bucket).toBe("NEXT");
  });

  it("returns the exact boundary instants alongside the bucket", () => {
    const result = classifyRunWeek({ scheduledStartAt: WINTER_CURRENT_START, now: WINTER_NOW, timeZone: TZ });
    expect(result.currentStart).toBe(WINTER_CURRENT_START);
    expect(result.nextStart).toBe(WINTER_NEXT_START);
    expect(result.followingStart).toBe(WINTER_FOLLOWING_START);
  });
});

describe("classifyRunWeek — half-open interval self-consistency (using the function's own boundaries)", () => {
  it("1ms before currentStart is PAST, currentStart itself is CURRENT", () => {
    const { currentStart } = classifyRunWeek({ scheduledStartAt: WINTER_CURRENT_START, now: WINTER_NOW, timeZone: TZ });
    const justBefore = new Date(new Date(currentStart).getTime() - 1).toISOString();
    expect(classifyRunWeek({ scheduledStartAt: justBefore, now: WINTER_NOW, timeZone: TZ }).bucket).toBe("PAST");
    expect(classifyRunWeek({ scheduledStartAt: currentStart, now: WINTER_NOW, timeZone: TZ }).bucket).toBe("CURRENT");
  });

  it("1ms before nextStart is CURRENT, nextStart itself is NEXT", () => {
    const { nextStart } = classifyRunWeek({ scheduledStartAt: WINTER_CURRENT_START, now: WINTER_NOW, timeZone: TZ });
    const justBefore = new Date(new Date(nextStart).getTime() - 1).toISOString();
    expect(classifyRunWeek({ scheduledStartAt: justBefore, now: WINTER_NOW, timeZone: TZ }).bucket).toBe("CURRENT");
    expect(classifyRunWeek({ scheduledStartAt: nextStart, now: WINTER_NOW, timeZone: TZ }).bucket).toBe("NEXT");
  });

  it("1ms before followingStart is NEXT, followingStart itself is FUTURE", () => {
    const { followingStart } = classifyRunWeek({ scheduledStartAt: WINTER_CURRENT_START, now: WINTER_NOW, timeZone: TZ });
    const justBefore = new Date(new Date(followingStart).getTime() - 1).toISOString();
    expect(classifyRunWeek({ scheduledStartAt: justBefore, now: WINTER_NOW, timeZone: TZ }).bucket).toBe("NEXT");
    expect(classifyRunWeek({ scheduledStartAt: followingStart, now: WINTER_NOW, timeZone: TZ }).bucket).toBe("FUTURE");
  });
});

describe("classifyRunWeek — exact NEXT start and rollover to CURRENT", () => {
  it("before rollover: a Run at next Wednesday 06:00 is NEXT", () => {
    const result = classifyRunWeek({ scheduledStartAt: WINTER_NEXT_START, now: WINTER_NOW, timeZone: TZ });
    expect(result.bucket).toBe("NEXT");
  });

  it("at rollover: the same scheduledStartAt becomes CURRENT once `now` itself reaches that Wednesday 06:00 — no schedule mutation involved", () => {
    const nowAtRollover = new Date(WINTER_NEXT_START);
    const result = classifyRunWeek({ scheduledStartAt: WINTER_NEXT_START, now: nowAtRollover, timeZone: TZ });
    expect(result.bucket).toBe("CURRENT");
  });
});

describe("classifyRunWeek — following start is FUTURE until its own rollover", () => {
  it("a Run at the following Wednesday 06:00 is FUTURE relative to the original now", () => {
    const result = classifyRunWeek({ scheduledStartAt: WINTER_FOLLOWING_START, now: WINTER_NOW, timeZone: TZ });
    expect(result.bucket).toBe("FUTURE");
  });

  it("becomes NEXT once `now` reaches the prior boundary (the following Wednesday is now next week's boundary)", () => {
    const nowAtNextRollover = new Date(WINTER_NEXT_START);
    const result = classifyRunWeek({ scheduledStartAt: WINTER_FOLLOWING_START, now: nowAtNextRollover, timeZone: TZ });
    expect(result.bucket).toBe("NEXT");
  });
});

describe("classifyRunWeek — winter (CET, UTC+1)", () => {
  it("reset local time remains 06:00 in CET", () => {
    const result = classifyRunWeek({ scheduledStartAt: WINTER_CURRENT_START, now: WINTER_NOW, timeZone: TZ });
    expect(result.currentStart).toBe(WINTER_CURRENT_START); // 06:00 CET == 05:00Z
  });
});

describe("classifyRunWeek — summer (CEST, UTC+2)", () => {
  it("reset local time remains 06:00 in CEST", () => {
    const result = classifyRunWeek({ scheduledStartAt: SUMMER_CURRENT_START, now: SUMMER_NOW, timeZone: TZ });
    expect(result.currentStart).toBe(SUMMER_CURRENT_START); // 06:00 CEST == 04:00Z
    expect(result.nextStart).toBe(SUMMER_NEXT_START);
  });
});

describe("classifyRunWeek — spring DST transition (2026-03-29, CET -> CEST)", () => {
  // Wednesday before the transition: 2026-03-25 06:00 CET = 2026-03-25T05:00:00Z.
  // Wednesday after the transition: 2026-04-01 06:00 CEST = 2026-04-01T04:00:00Z.
  const NOW_BEFORE_TRANSITION = new Date("2026-03-26T12:00:00.000Z"); // Thursday, still CET
  const CURRENT_START_BEFORE = "2026-03-25T05:00:00.000Z";
  const NEXT_START_AFTER = "2026-04-01T04:00:00.000Z";

  it("the Wednesday reset remains 06:00 local on both sides of the transition", () => {
    const result = classifyRunWeek({ scheduledStartAt: CURRENT_START_BEFORE, now: NOW_BEFORE_TRANSITION, timeZone: TZ });
    expect(result.currentStart).toBe(CURRENT_START_BEFORE);
    expect(result.nextStart).toBe(NEXT_START_AFTER);
  });

  it("a Run at 2026-04-01T04:00:00Z (NEXT's start, now in CEST) classifies NEXT, not PAST/CURRENT", () => {
    const result = classifyRunWeek({ scheduledStartAt: NEXT_START_AFTER, now: NOW_BEFORE_TRANSITION, timeZone: TZ });
    expect(result.bucket).toBe("NEXT");
  });

  it("is NOT exactly 168 UTC hours from currentStart to nextStart across the spring transition (would be a naive +7-day bug)", () => {
    const hours =
      (new Date(NEXT_START_AFTER).getTime() - new Date(CURRENT_START_BEFORE).getTime()) / (60 * 60 * 1000);
    expect(hours).toBe(167); // one hour "lost" to springing forward
    expect(hours).not.toBe(168);
  });
});

describe("classifyRunWeek — autumn DST transition (2026-10-25, CEST -> CET)", () => {
  // Wednesday before the transition: 2026-10-21 06:00 CEST = 2026-10-21T04:00:00Z.
  // Wednesday after the transition: 2026-10-28 06:00 CET = 2026-10-28T05:00:00Z.
  const NOW_BEFORE_TRANSITION = new Date("2026-10-22T12:00:00.000Z"); // Thursday, still CEST
  const CURRENT_START_BEFORE = "2026-10-21T04:00:00.000Z";
  const NEXT_START_AFTER = "2026-10-28T05:00:00.000Z";

  it("the Wednesday reset remains 06:00 local on both sides of the transition", () => {
    const result = classifyRunWeek({ scheduledStartAt: CURRENT_START_BEFORE, now: NOW_BEFORE_TRANSITION, timeZone: TZ });
    expect(result.currentStart).toBe(CURRENT_START_BEFORE);
    expect(result.nextStart).toBe(NEXT_START_AFTER);
  });

  it("a Run at 2026-10-28T05:00:00Z (NEXT's start, now in CET) classifies NEXT", () => {
    const result = classifyRunWeek({ scheduledStartAt: NEXT_START_AFTER, now: NOW_BEFORE_TRANSITION, timeZone: TZ });
    expect(result.bucket).toBe("NEXT");
  });

  it("is NOT exactly 168 UTC hours from currentStart to nextStart across the autumn transition (would be a naive +7-day bug)", () => {
    const hours =
      (new Date(NEXT_START_AFTER).getTime() - new Date(CURRENT_START_BEFORE).getTime()) / (60 * 60 * 1000);
    expect(hours).toBe(169); // one hour "gained" falling back
    expect(hours).not.toBe(168);
  });
});
