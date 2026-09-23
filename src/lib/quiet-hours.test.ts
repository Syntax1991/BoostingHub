import { describe, expect, it } from "vitest";
import {
  findUtcInstantsForLocalWall,
  isInQuietHours,
  nextQuietHoursEndUtc,
  parseQuietHoursHm,
  zonedLocalWallToUtcIso,
} from "@/lib/quiet-hours";
import { resolveDiscordDelivery } from "@/services/notification-content";

describe("parseQuietHoursHm", () => {
  it("accepts HH:MM and rejects invalid shapes", () => {
    expect(parseQuietHoursHm("22:00")).toEqual({ hour: 22, minute: 0 });
    expect(parseQuietHoursHm("00:30")).toEqual({ hour: 0, minute: 30 });
    expect(parseQuietHoursHm("7:00")).toBeNull();
    expect(parseQuietHoursHm("24:00")).toBeNull();
    expect(parseQuietHoursHm("25:00")).toBeNull();
    expect(parseQuietHoursHm("7pm")).toBeNull();
    expect(parseQuietHoursHm("abc")).toBeNull();
  });
});

describe("isInQuietHours overnight 22:00→07:00", () => {
  const window = { start: "22:00", end: "07:00", timeZone: "Europe/Berlin" };

  it("is outside before start", () => {
    expect(
      isInQuietHours({
        ...window,
        now: new Date("2026-03-10T20:59:00.000Z"), // 21:59 CET
      }),
    ).toBe(false);
  });

  it("is quiet exactly at start", () => {
    expect(
      isInQuietHours({
        ...window,
        now: new Date("2026-03-10T21:00:00.000Z"), // 22:00 CET
      }),
    ).toBe(true);
  });

  it("is quiet before midnight", () => {
    expect(
      isInQuietHours({
        ...window,
        now: new Date("2026-03-10T22:30:00.000Z"), // 23:30 CET
      }),
    ).toBe(true);
  });

  it("is quiet after midnight", () => {
    expect(
      isInQuietHours({
        ...window,
        now: new Date("2026-03-10T04:00:00.000Z"), // 05:00 CET
      }),
    ).toBe(true);
  });

  it("is not quiet exactly at end", () => {
    expect(
      isInQuietHours({
        ...window,
        now: new Date("2026-03-10T06:00:00.000Z"), // 07:00 CET
      }),
    ).toBe(false);
  });
});

describe("isInQuietHours same-day 13:00→15:00", () => {
  const window = { start: "13:00", end: "15:00", timeZone: "UTC" };

  it("inside and outside", () => {
    expect(isInQuietHours({ ...window, now: new Date("2026-06-01T12:59:00.000Z") })).toBe(false);
    expect(isInQuietHours({ ...window, now: new Date("2026-06-01T13:00:00.000Z") })).toBe(true);
    expect(isInQuietHours({ ...window, now: new Date("2026-06-01T14:59:00.000Z") })).toBe(true);
    expect(isInQuietHours({ ...window, now: new Date("2026-06-01T15:00:00.000Z") })).toBe(false);
  });
});

describe("nextQuietHoursEndUtc", () => {
  it("resolves overnight end to next local morning in Europe/Berlin", () => {
    const end = nextQuietHoursEndUtc({
      now: new Date("2026-03-10T21:30:00.000Z"), // 22:30 CET
      timeZone: "Europe/Berlin",
      start: "22:00",
      end: "07:00",
    });
    expect(end).toBe("2026-03-11T06:00:00.000Z"); // 07:00 CET
  });

  it("resolves after-midnight overnight end to same local morning", () => {
    const end = nextQuietHoursEndUtc({
      now: new Date("2026-03-11T02:00:00.000Z"), // 03:00 CET
      timeZone: "Europe/Berlin",
      start: "22:00",
      end: "07:00",
    });
    expect(end).toBe("2026-03-11T06:00:00.000Z");
  });

  it("interprets America/New_York overnight", () => {
    const end = nextQuietHoursEndUtc({
      now: new Date("2026-01-15T04:00:00.000Z"), // 23:00 EST
      timeZone: "America/New_York",
      start: "22:00",
      end: "07:00",
    });
    expect(end).toBe("2026-01-15T12:00:00.000Z"); // 07:00 EST
  });

  it("uses UTC wall clock directly", () => {
    const end = nextQuietHoursEndUtc({
      now: new Date("2026-06-01T23:00:00.000Z"),
      timeZone: "UTC",
      start: "22:00",
      end: "07:00",
    });
    expect(end).toBe("2026-06-02T07:00:00.000Z");
  });
});

describe("DST spring-forward / fall-back", () => {
  it("Europe/Berlin spring-forward nonexistent 02:30 → first valid at/after", () => {
    // 2026-03-29 02:00 → 03:00 CEST; 02:30 does not exist.
    const iso = zonedLocalWallToUtcIso(
      { year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
      "Europe/Berlin",
      { preferLaterOnAmbiguity: true },
    );
    expect(iso).toBe("2026-03-29T01:00:00.000Z"); // 03:00 CEST
  });

  it("Europe/Berlin fall-back ambiguous 02:30 prefers later occurrence", () => {
    // 2026-10-25 03:00 → 02:00 CET; 02:30 occurs twice.
    const matches = findUtcInstantsForLocalWall(
      { year: 2026, month: 10, day: 25, hour: 2, minute: 30 },
      "Europe/Berlin",
    );
    expect(matches.length).toBe(2);
    const iso = zonedLocalWallToUtcIso(
      { year: 2026, month: 10, day: 25, hour: 2, minute: 30 },
      "Europe/Berlin",
      { preferLaterOnAmbiguity: true },
    );
    expect(iso).toBe(matches[matches.length - 1]!.toISOString());
    expect(iso).toBe("2026-10-25T01:30:00.000Z"); // later = CET
  });

  it("America/New_York spring-forward nonexistent 02:30 → first valid", () => {
    // 2026-03-08 02:00 → 03:00 EDT
    const iso = zonedLocalWallToUtcIso(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
      "America/New_York",
      { preferLaterOnAmbiguity: true },
    );
    expect(iso).toBe("2026-03-08T07:00:00.000Z"); // 03:00 EDT
  });

  it("America/New_York fall-back ambiguous 01:30 prefers later", () => {
    // 2026-11-01 02:00 → 01:00 EST
    const matches = findUtcInstantsForLocalWall(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
      "America/New_York",
    );
    expect(matches.length).toBe(2);
    const iso = zonedLocalWallToUtcIso(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
      "America/New_York",
      { preferLaterOnAmbiguity: true },
    );
    expect(iso).toBe(matches[matches.length - 1]!.toISOString());
  });
});

describe("resolveDiscordDelivery quiet hours", () => {
  const base = {
    discordDmEnabled: true,
    eventDmEnabled: true,
    discordUserId: "123",
    timeZone: "Europe/Berlin",
    quietHours: { enabled: true, start: "22:00", end: "07:00" },
  };

  it("outside quiet hours → PENDING deliverAfter null", () => {
    const result = resolveDiscordDelivery({
      ...base,
      now: new Date("2026-03-10T12:00:00.000Z"),
    });
    expect(result).toEqual({
      status: "PENDING",
      discordUserId: "123",
      discordDeliverAfter: null,
    });
  });

  it("inside quiet hours → PENDING with future deliverAfter", () => {
    const result = resolveDiscordDelivery({
      ...base,
      now: new Date("2026-03-10T21:30:00.000Z"),
    });
    expect(result.status).toBe("PENDING");
    expect(result.discordUserId).toBe("123");
    expect(result.discordDeliverAfter).toBe("2026-03-11T06:00:00.000Z");
  });

  it("master OFF stays SKIPPED with null deliverAfter even during quiet hours", () => {
    expect(
      resolveDiscordDelivery({
        ...base,
        discordDmEnabled: false,
        now: new Date("2026-03-10T21:30:00.000Z"),
      }),
    ).toEqual({ status: "SKIPPED", discordUserId: null, discordDeliverAfter: null });
  });
});
