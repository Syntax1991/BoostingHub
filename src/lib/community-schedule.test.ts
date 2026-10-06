import { describe, expect, it } from "vitest";
import {
  compareScheduleOccurrences,
  parseCommunityLocalStartTime,
  resolveScheduleSlotOccurrence,
} from "@/lib/community-schedule";
import { zonedParts } from "@/lib/datetime";

const TZ = "Europe/Berlin";

// Thursday 2026-01-15 12:00 UTC — winter CET week
// CURRENT: Wed 14 Jan 06:00 CET → Wed 21 Jan 06:00 CET
const WINTER_NOW = new Date("2026-01-15T12:00:00.000Z");

// Thursday 2026-07-16 12:00 UTC — summer CEST week
// CURRENT: Wed 15 Jul 06:00 CEST → Wed 22 Jul 06:00 CEST
const SUMMER_NOW = new Date("2026-07-16T12:00:00.000Z");

// Spring DST 2026: clocks spring forward Sun 29 Mar 02:00 → 03:00
// Use a Thursday after that transition in the same raid-ID week.
// Raid week CURRENT for now=Thu 2026-04-02: Wed 2026-04-01 06:00 CEST
const SPRING_NOW = new Date("2026-04-02T12:00:00.000Z");

// Autumn DST 2026: clocks fall back Sun 25 Oct 03:00 → 02:00
// Raid week CURRENT for now=Thu 2026-10-29: Wed 2026-10-28 06:00 CET
const AUTUMN_NOW = new Date("2026-10-29T12:00:00.000Z");

function localWall(iso: string) {
  const parts = zonedParts(new Date(iso), TZ);
  return {
    weekday: parts.weekday,
    hour: parts.hour,
    minute: parts.minute,
    date: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
  };
}

describe("parseCommunityLocalStartTime", () => {
  it("accepts HH:mm", () => {
    expect(parseCommunityLocalStartTime("19:45")).toBe("19:45");
    expect(parseCommunityLocalStartTime("00:00")).toBe("00:00");
    expect(parseCommunityLocalStartTime("23:59")).toBe("23:59");
  });

  it("rejects invalid times", () => {
    expect(() => parseCommunityLocalStartTime("24:00")).toThrow();
    expect(() => parseCommunityLocalStartTime("9:45")).toThrow();
    expect(() => parseCommunityLocalStartTime("19:5")).toThrow();
    expect(() => parseCommunityLocalStartTime("abc")).toThrow();
  });
});

describe("resolveScheduleSlotOccurrence — normal weeks", () => {
  it("winter CET: Friday 19:45 stays 19:45 local in CURRENT", () => {
    const result = resolveScheduleSlotOccurrence({
      weekday: "FRIDAY",
      localStartTime: "19:45",
      window: "CURRENT",
      now: WINTER_NOW,
      timeZone: TZ,
    });
    const wall = localWall(result.scheduledStartAt);
    expect(wall.weekday).toBe("Fri");
    expect(wall.hour).toBe(19);
    expect(wall.minute).toBe(45);
    expect(wall.date).toBe("2026-01-16");
    expect(result.window).toBe("CURRENT");
  });

  it("summer CEST: Friday 19:45 stays 19:45 local in CURRENT", () => {
    const result = resolveScheduleSlotOccurrence({
      weekday: "FRIDAY",
      localStartTime: "19:45",
      window: "CURRENT",
      now: SUMMER_NOW,
      timeZone: TZ,
    });
    const wall = localWall(result.scheduledStartAt);
    expect(wall.weekday).toBe("Fri");
    expect(wall.hour).toBe(19);
    expect(wall.minute).toBe(45);
    expect(wall.date).toBe("2026-07-17");
  });

  it("CURRENT vs NEXT project different concrete dates for the same slot", () => {
    const current = resolveScheduleSlotOccurrence({
      weekday: "SATURDAY",
      localStartTime: "18:00",
      window: "CURRENT",
      now: WINTER_NOW,
      timeZone: TZ,
    });
    const next = resolveScheduleSlotOccurrence({
      weekday: "SATURDAY",
      localStartTime: "18:00",
      window: "NEXT",
      now: WINTER_NOW,
      timeZone: TZ,
    });
    expect(current.localDate).toBe("2026-01-17");
    expect(next.localDate).toBe("2026-01-24");
    expect(localWall(current.scheduledStartAt).hour).toBe(18);
    expect(localWall(next.scheduledStartAt).hour).toBe(18);
  });
});

describe("resolveScheduleSlotOccurrence — DST transitions", () => {
  it("spring DST week: Friday 19:45 remains 19:45 local", () => {
    const result = resolveScheduleSlotOccurrence({
      weekday: "FRIDAY",
      localStartTime: "19:45",
      window: "CURRENT",
      now: SPRING_NOW,
      timeZone: TZ,
    });
    const wall = localWall(result.scheduledStartAt);
    expect(wall.hour).toBe(19);
    expect(wall.minute).toBe(45);
    expect(wall.weekday).toBe("Fri");
  });

  it("autumn DST week: Friday 19:45 remains 19:45 local", () => {
    const result = resolveScheduleSlotOccurrence({
      weekday: "FRIDAY",
      localStartTime: "19:45",
      window: "CURRENT",
      now: AUTUMN_NOW,
      timeZone: TZ,
    });
    const wall = localWall(result.scheduledStartAt);
    expect(wall.hour).toBe(19);
    expect(wall.minute).toBe(45);
    expect(wall.weekday).toBe("Fri");
  });
});

describe("resolveScheduleSlotOccurrence — raid-ID boundary", () => {
  it("Tuesday near end of CURRENT week stays in CURRENT", () => {
    const result = resolveScheduleSlotOccurrence({
      weekday: "TUESDAY",
      localStartTime: "22:00",
      window: "CURRENT",
      now: WINTER_NOW,
      timeZone: TZ,
    });
    expect(result.localDate).toBe("2026-01-20");
    expect(localWall(result.scheduledStartAt).hour).toBe(22);
  });

  it("Wednesday after reset (19:45) is the window-start Wednesday", () => {
    const result = resolveScheduleSlotOccurrence({
      weekday: "WEDNESDAY",
      localStartTime: "19:45",
      window: "CURRENT",
      now: WINTER_NOW,
      timeZone: TZ,
    });
    expect(result.localDate).toBe("2026-01-14");
    expect(localWall(result.scheduledStartAt)).toMatchObject({
      weekday: "Wed",
      hour: 19,
      minute: 45,
    });
  });

  it("Wednesday before 06:00 is still in CURRENT via the ending Tuesday→Wed edge case", () => {
    // Wed 05:00 is after previous Tue and before next Wed 06:00 — lands on ending Wed.
    const result = resolveScheduleSlotOccurrence({
      weekday: "WEDNESDAY",
      localStartTime: "05:00",
      window: "CURRENT",
      now: WINTER_NOW,
      timeZone: TZ,
    });
    expect(result.localDate).toBe("2026-01-21");
    expect(localWall(result.scheduledStartAt)).toMatchObject({
      weekday: "Wed",
      hour: 5,
      minute: 0,
    });
  });
});

describe("compareScheduleOccurrences", () => {
  it("sorts by occurrence time then stable slot id", () => {
    const rows = [
      { scheduledStartAt: "2026-01-16T18:45:00.000Z", slotId: "b" },
      { scheduledStartAt: "2026-01-16T18:45:00.000Z", slotId: "a" },
      { scheduledStartAt: "2026-01-16T17:00:00.000Z", slotId: "c" },
    ];
    rows.sort(compareScheduleOccurrences);
    expect(rows.map((r) => r.slotId)).toEqual(["c", "a", "b"]);
  });
});
