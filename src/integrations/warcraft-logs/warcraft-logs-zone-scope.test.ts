import { describe, expect, it } from "vitest";
import { mapZoneRankings, scopeZoneRankingsToEncounters } from "@/integrations/warcraft-logs/warcraft-logs-api-client";

/** WCL `zoneRankings` JSON (zone 53): Venomous Abyss bosses + Nymrissa (3379) + Kith'ix (3513). */
const ZONE_53 = {
  bestPerformanceAverage: 80,
  medianPerformanceAverage: 60,
  rankings: [
    { encounter: { id: 3470, name: "Nek'zali" }, rankPercent: 70, medianPercent: 50, totalKills: 4 },
    { encounter: { id: 3445, name: "Entombed Sentinels" }, rankPercent: 60, medianPercent: 40, totalKills: 3 },
    { encounter: { id: 3497, name: "The Lost Explorers" }, rankPercent: null, medianPercent: null, totalKills: 0 },
    { encounter: { id: 3379, name: "Nymrissa" }, rankPercent: 99, medianPercent: 95, totalKills: 5 },
    { encounter: { id: 3513, name: "Kith'ix" }, rankPercent: 91, medianPercent: 75, totalKills: 2 },
  ],
};

describe("zone rankings per encounter", () => {
  it("maps the per-encounter rows of a zone payload", () => {
    const mapped = mapZoneRankings(ZONE_53)!;
    expect(mapped.bestPerformanceAverage).toBe(80);
    expect(mapped.encounters).toEqual([
      { encounterId: 3470, rankPercent: 70, medianPercent: 50 },
      { encounterId: 3445, rankPercent: 60, medianPercent: 40 },
      { encounterId: 3497, rankPercent: null, medianPercent: null },
      { encounterId: 3379, rankPercent: 99, medianPercent: 95 },
      { encounterId: 3513, rankPercent: 91, medianPercent: 75 },
    ]);
  });

  it("restricts Best/Avg to the raid's own encounters (other raids in the zone excluded)", () => {
    const scoped = scopeZoneRankingsToEncounters(mapZoneRankings(ZONE_53)!, [3470, 3445, 3497]);
    // Mean over encounters with a value: (70 + 60) / 2 and (50 + 40) / 2 — Nymrissa / Kith'ix not mixed in.
    expect(scoped.bestPerformanceAverage).toBe(65);
    expect(scoped.medianPerformanceAverage).toBe(45);
  });

  it("no ranked kill on the raid's encounters → no values", () => {
    const scoped = scopeZoneRankingsToEncounters(mapZoneRankings(ZONE_53)!, [3497, 4242]);
    expect(scoped.bestPerformanceAverage).toBeNull();
    expect(scoped.medianPerformanceAverage).toBeNull();
  });

  it("payload without per-encounter rows → zone-wide values unchanged (safe fallback)", () => {
    const mapped = mapZoneRankings({ bestPerformanceAverage: 80, medianPerformanceAverage: 60 })!;
    expect(mapped.encounters).toBeNull();
    expect(scopeZoneRankingsToEncounters(mapped, [3470])).toEqual(mapped);
  });
});
