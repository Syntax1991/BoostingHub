import { describe, expect, it } from "vitest";
import {
  DEFAULT_RAID_ID_FILTER,
  matchesRaidIdFilter,
  raidIdSearchParam,
  resolveRaidIdFilter,
} from "@/lib/raid-id-filter";
import { classifyRunWeek } from "@/lib/wow-run-week";

/**
 * Raid-ID week filter (/runs, /my-runs `?id=`): windows come from
 * classifyRunWeek — Wednesday 06:00 Europe/Berlin, half-open, DST-safe.
 */

// Thursday 2026-10-22 12:00 CEST: current ID started Wed 2026-10-21 06:00 CEST (04:00Z).
const NOW = new Date("2026-10-22T10:00:00.000Z");

describe("raid-ID filter", () => {
  it("Current ID is the default; missing, repeated or unknown values fall back to it", () => {
    expect(DEFAULT_RAID_ID_FILTER).toBe("current");
    expect(resolveRaidIdFilter(undefined)).toBe("current");
    expect(resolveRaidIdFilter("bogus")).toBe("current");
    expect(resolveRaidIdFilter(["next", "all"])).toBe("current");
    expect(resolveRaidIdFilter("next")).toBe("next");
    expect(resolveRaidIdFilter("all")).toBe("all");
  });

  it("URL state round-trips, Current ID left out", () => {
    for (const filter of ["current", "next", "all"] as const) {
      expect(resolveRaidIdFilter(raidIdSearchParam(filter) ?? undefined)).toBe(filter);
    }
    expect(raidIdSearchParam("current")).toBeNull();
  });

  it("Current ID uses the Wednesday 06:00 Europe/Berlin reset — exact boundary included, earlier excluded", () => {
    expect(matchesRaidIdFilter("2026-10-21T04:00:00.000Z", "current", NOW)).toBe(true); // Wed 06:00 CEST
    expect(matchesRaidIdFilter("2026-10-21T03:59:59.999Z", "current", NOW)).toBe(false); // Wed 05:59:59 CEST
    // An earlier (already played) Run of the same ID still belongs to Current ID.
    expect(matchesRaidIdFilter("2026-10-21T18:00:00.000Z", "current", NOW)).toBe(true);
  });

  it("Next ID is exactly the following window; the DST change in between is honored", () => {
    // DST ends Sun 2026-10-25: the next reset is Wed 2026-10-28 06:00 CET = 05:00Z, not 04:00Z.
    expect(classifyRunWeek({ scheduledStartAt: NOW.toISOString(), now: NOW }).nextStart).toBe(
      "2026-10-28T05:00:00.000Z",
    );
    expect(matchesRaidIdFilter("2026-10-28T04:30:00.000Z", "current", NOW)).toBe(true); // Wed 05:30 CET
    expect(matchesRaidIdFilter("2026-10-28T04:30:00.000Z", "next", NOW)).toBe(false);
    expect(matchesRaidIdFilter("2026-10-28T05:00:00.000Z", "next", NOW)).toBe(true); // Wed 06:00 CET
    expect(matchesRaidIdFilter("2026-11-04T04:59:59.999Z", "next", NOW)).toBe(true);
    expect(matchesRaidIdFilter("2026-11-04T05:00:00.000Z", "next", NOW)).toBe(false); // the ID after next
    expect(matchesRaidIdFilter("2026-10-25T19:00:00.000Z", "next", NOW)).toBe(false); // Sunday: still current
  });

  it("spring-forward week: the reset after it is Wed 06:00 CEST", () => {
    const march = new Date("2027-03-26T12:00:00.000Z"); // Fri; DST starts Sun 2027-03-28
    expect(matchesRaidIdFilter("2027-03-31T03:59:00.000Z", "current", march)).toBe(true); // Wed 05:59 CEST
    expect(matchesRaidIdFilter("2027-03-31T04:00:00.000Z", "next", march)).toBe(true); // Wed 06:00 CEST
  });

  it("All removes the raid-ID restriction", () => {
    for (const at of ["2020-01-01T00:00:00.000Z", "2026-10-21T18:00:00.000Z", "2030-01-01T00:00:00.000Z"]) {
      expect(matchesRaidIdFilter(at, "all", NOW)).toBe(true);
    }
    expect(matchesRaidIdFilter("2026-11-20T18:00:00.000Z", "current", NOW)).toBe(false);
    expect(matchesRaidIdFilter("2026-11-20T18:00:00.000Z", "next", NOW)).toBe(false);
  });
});
