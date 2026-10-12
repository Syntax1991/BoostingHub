import { describe, expect, it } from "vitest";
import {
  isBeforeScheduleStart,
  nextScheduleDraftReleaseAt,
  scheduleDraftRelease,
  resolveScheduleStartBoundary,
  scheduleOccurrenceInWindowOf,
  scheduleTimeOfInstant,
} from "@/lib/community-schedule";

// Monday 12 Oct 2026 14:00 Berlin (CEST). Current raid ID: Wed 7 Oct 06:00 → Wed 14 Oct 06:00.
const MONDAY = new Date("2026-10-12T12:00:00.000Z");
const friday2000 = { weekday: "FRIDAY" as const, localStartTime: "20:00" };

describe("resolveScheduleStartBoundary", () => {
  it("Immediately: no boundary; first occurrence is the next upcoming one (Fri 16 Oct)", () => {
    const result = resolveScheduleStartBoundary({ ...friday2000, start: { mode: "IMMEDIATE" }, now: MONDAY });
    expect(result.firstWindowStartAt).toBeNull();
    expect(result.firstOccurrence.scheduledStartAt).toBe("2026-10-16T18:00:00.000Z");
  });

  it("Next raid ID equals Immediately when this raid ID's occurrence already passed", () => {
    const result = resolveScheduleStartBoundary({ ...friday2000, start: { mode: "NEXT_RAID_ID" }, now: MONDAY });
    expect(result.firstWindowStartAt).toBeNull();
    expect(result.firstOccurrence.scheduledStartAt).toBe("2026-10-16T18:00:00.000Z");
  });

  it("Next raid ID skips a still-upcoming occurrence of the current raid ID", () => {
    // Thursday 8 Oct: Fri 9 Oct (current raid ID) is still ahead.
    const thursday = new Date("2026-10-08T10:00:00.000Z");
    const result = resolveScheduleStartBoundary({ ...friday2000, start: { mode: "NEXT_RAID_ID" }, now: thursday });
    expect(result.firstWindowStartAt).toBe("2026-10-14T04:00:00.000Z");
    expect(result.firstOccurrence.scheduledStartAt).toBe("2026-10-16T18:00:00.000Z");
  });

  it("Skip first: boundary is the following raid ID (Wed 21 Oct), first occurrence Fri 23 Oct", () => {
    const result = resolveScheduleStartBoundary({ ...friday2000, start: { mode: "SKIP_FIRST" }, now: MONDAY });
    expect(result.firstWindowStartAt).toBe("2026-10-21T04:00:00.000Z");
    expect(result.firstOccurrence.scheduledStartAt).toBe("2026-10-23T18:00:00.000Z");
  });

  it("From date Tue 20 Oct: Fri 16 Oct is ineligible, Fri 23 Oct is the first occurrence", () => {
    const result = resolveScheduleStartBoundary({
      ...friday2000,
      start: { mode: "FROM_DATE", date: "2026-10-20" },
      now: MONDAY,
    });
    expect(result.firstWindowStartAt).toBe("2026-10-21T04:00:00.000Z");
    expect(result.firstOccurrence.scheduledStartAt).toBe("2026-10-23T18:00:00.000Z");
  });

  it("From a date on or before the upcoming occurrence: no boundary", () => {
    for (const date of ["2026-10-16", "2026-10-13", "2026-01-01"]) {
      const result = resolveScheduleStartBoundary({ ...friday2000, start: { mode: "FROM_DATE", date }, now: MONDAY });
      expect(result.firstWindowStartAt).toBeNull();
      expect(result.firstOccurrence.scheduledStartAt).toBe("2026-10-16T18:00:00.000Z");
    }
  });

  it("Wednesday 06:00 reset boundary: Wed 05:30 belongs to the previous raid ID, Wed 06:30 to the new one", () => {
    const early = resolveScheduleStartBoundary({
      weekday: "WEDNESDAY",
      localStartTime: "05:30",
      start: { mode: "FROM_DATE", date: "2026-10-21" },
      now: MONDAY,
    });
    // Wed 21 Oct 05:30 is still in the raid ID that started Wed 14 Oct 06:00.
    expect(early.firstOccurrence.scheduledStartAt).toBe("2026-10-21T03:30:00.000Z");
    expect(early.firstWindowStartAt).toBe("2026-10-14T04:00:00.000Z");

    const late = resolveScheduleStartBoundary({
      weekday: "WEDNESDAY",
      localStartTime: "06:30",
      start: { mode: "FROM_DATE", date: "2026-10-21" },
      now: MONDAY,
    });
    expect(late.firstOccurrence.scheduledStartAt).toBe("2026-10-21T04:30:00.000Z");
    expect(late.firstWindowStartAt).toBe("2026-10-21T04:00:00.000Z");
  });

  it("EU DST end (Sun 25 Oct): boundary and occurrence keep Berlin wall time", () => {
    const result = resolveScheduleStartBoundary({
      ...friday2000,
      start: { mode: "SKIP_FIRST" },
      now: new Date("2026-10-19T10:00:00.000Z"),
    });
    // Raid ID Wed 28 Oct 06:00 CET = 05:00Z; Fri 30 Oct 20:00 CET = 19:00Z.
    expect(result.firstWindowStartAt).toBe("2026-10-28T05:00:00.000Z");
    expect(result.firstOccurrence.scheduledStartAt).toBe("2026-10-30T19:00:00.000Z");
  });

  it("rejects malformed dates", () => {
    expect(() =>
      resolveScheduleStartBoundary({ ...friday2000, start: { mode: "FROM_DATE", date: "20.10.2026" }, now: MONDAY }),
    ).toThrow(RangeError);
  });
});

describe("isBeforeScheduleStart / scheduleOccurrenceInWindowOf", () => {
  it("null boundary never excludes (legacy behavior)", () => {
    expect(isBeforeScheduleStart(null, "2026-10-14T04:00:00.000Z")).toBe(false);
  });

  it("excludes only windows strictly before the boundary", () => {
    const boundary = "2026-10-21T04:00:00.000Z";
    expect(isBeforeScheduleStart(boundary, "2026-10-14T04:00:00.000Z")).toBe(true);
    expect(isBeforeScheduleStart(boundary, "2026-10-21T04:00:00.000Z")).toBe(false);
    expect(isBeforeScheduleStart(boundary, "2026-10-28T05:00:00.000Z")).toBe(false);
  });

  it("finds the slot occurrence in the raid ID containing an instant", () => {
    const occurrence = scheduleOccurrenceInWindowOf({ ...friday2000, instant: new Date("2026-10-20T10:00:00.000Z") });
    expect(occurrence.windowStartAt).toBe("2026-10-14T04:00:00.000Z");
    expect(occurrence.scheduledStartAt).toBe("2026-10-16T18:00:00.000Z");
  });
});

describe("scheduleDraftRelease (Monday 12:00 Europe/Berlin → following Wednesday reset)", () => {
  it.each([
    // [now, releaseAt, targetWindowStartAt]
    ["Mon 12 Oct 11:59 Berlin → previous release (5 Oct) still governs", "2026-10-12T09:59:00.000Z", "2026-10-05T10:00:00.000Z", "2026-10-07T04:00:00.000Z"],
    ["Mon 12 Oct 12:00 Berlin exactly → releases Wed 14 Oct", "2026-10-12T10:00:00.000Z", "2026-10-12T10:00:00.000Z", "2026-10-14T04:00:00.000Z"],
    ["Tue 13 Oct catch-up → same target", "2026-10-13T08:00:00.000Z", "2026-10-12T10:00:00.000Z", "2026-10-14T04:00:00.000Z"],
    ["Thu 15 Oct (after Wed reset) catch-up → still the released raid ID", "2026-10-15T08:00:00.000Z", "2026-10-12T10:00:00.000Z", "2026-10-14T04:00:00.000Z"],
    ["Sun 18 Oct → still last Monday's release", "2026-10-18T20:00:00.000Z", "2026-10-12T10:00:00.000Z", "2026-10-14T04:00:00.000Z"],
    ["DST end week: Mon 26 Oct 12:00 CET = 11:00Z → Wed 28 Oct 06:00 CET", "2026-10-26T11:00:00.000Z", "2026-10-26T11:00:00.000Z", "2026-10-28T05:00:00.000Z"],
    ["DST end week: Mon 26 Oct 11:30Z (12:30 CET) → released", "2026-10-26T11:30:00.000Z", "2026-10-26T11:00:00.000Z", "2026-10-28T05:00:00.000Z"],
    ["DST end week: Mon 26 Oct 10:30Z (11:30 CET) → not yet", "2026-10-26T10:30:00.000Z", "2026-10-19T10:00:00.000Z", "2026-10-21T04:00:00.000Z"],
    ["DST start week: Mon 29 Mar 2027 12:00 CEST = 10:00Z → Wed 31 Mar 06:00 CEST", "2027-03-29T10:00:00.000Z", "2027-03-29T10:00:00.000Z", "2027-03-31T04:00:00.000Z"],
    ["Mon 22 Mar 2027 12:00 CET (before DST start Sun 28) → Wed 24 Mar 06:00 CET", "2027-03-22T11:00:00.000Z", "2027-03-22T11:00:00.000Z", "2027-03-24T05:00:00.000Z"],
  ])("%s", (_label, now, releaseAt, target) => {
    expect(scheduleDraftRelease(new Date(now))).toEqual({ releaseAt, targetWindowStartAt: target });
  });

  it("next release for display", () => {
    expect(nextScheduleDraftReleaseAt(new Date("2026-10-12T10:00:00.000Z"))).toBe("2026-10-19T10:00:00.000Z");
    expect(nextScheduleDraftReleaseAt(new Date("2026-10-20T08:00:00.000Z"))).toBe("2026-10-26T11:00:00.000Z");
  });
});

describe("scheduleTimeOfInstant (Europe/Berlin)", () => {
  it.each([
    ["CEST Friday evening", "2026-10-16T18:00:00.000Z", "FRIDAY", "20:00"],
    ["CET Friday evening (after DST end)", "2026-10-30T19:00:00.000Z", "FRIDAY", "20:00"],
    ["UTC Saturday late → Berlin Sunday 00:30", "2026-10-17T22:30:00.000Z", "SUNDAY", "00:30"],
    ["DST start week (CEST)", "2027-04-02T18:15:00.000Z", "FRIDAY", "20:15"],
  ])("%s", (_label, instant, weekday, localStartTime) => {
    expect(scheduleTimeOfInstant(instant)).toEqual({ weekday, localStartTime });
  });
});
