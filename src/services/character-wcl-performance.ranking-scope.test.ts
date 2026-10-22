import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRaidCatalog, effectiveWclRankingEncounterId, type CatalogRaid } from "@/lib/raid-catalog";
import { warcraftLogsApiClient } from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { characterWclPerformanceRepository } from "@/repositories/character-wcl-performance.repository";
import { resolveRosterWclPerformance } from "@/services/character-wcl-performance.service";

const ZONE = 53;

function raid(overrides: Partial<CatalogRaid> & Pick<CatalogRaid, "id" | "name">): CatalogRaid {
  return {
    season: "Midnight Season 2",
    availableForRuns: true,
    sortOrder: 1,
    trackLockouts: true,
    blizzardInstanceId: null,
    wclZoneId: ZONE,
    wclRankingEncounterId: null,
    bosses: [],
    ...overrides,
  };
}

function boss(raidId: string, sortOrder: number, wclEncounterIds: number[]) {
  return { id: `${raidId}-b${sortOrder}`, raidId, name: `Boss ${sortOrder}`, sortOrder, blizzardEncounterIds: [], wclEncounterIds };
}

/** A lair added in the Raid Catalog after the zone was resolved: one boss mapped, raid ranking left empty. */
const KITHIX = raid({ id: "kithix", name: "The Unbinding of Kith'ix", bosses: [boss("kithix", 1, [3513])] });
const VENOMOUS = raid({
  id: "venomous",
  name: "The Venomous Abyss",
  bosses: [boss("venomous", 1, [3470]), boss("venomous", 2, [3445])],
});
const TIDEBOUND = raid({ id: "tide", name: "The Tidebound Grotto", wclRankingEncounterId: 3379, bosses: [boss("tide", 1, [3379])] });

describe("effectiveWclRankingEncounterId", () => {
  it("single-boss raid in a shared zone → ranked by its only encounter (not zone-wide)", () => {
    expect(effectiveWclRankingEncounterId(KITHIX)).toBe(3513);
  });

  it("multi-boss raid stays zone-wide", () => {
    expect(effectiveWclRankingEncounterId(VENOMOUS)).toBeNull();
  });

  it("a stored ranking encounter always wins", () => {
    expect(effectiveWclRankingEncounterId(TIDEBOUND)).toBe(3379);
    expect(effectiveWclRankingEncounterId({ ...KITHIX, wclRankingEncounterId: 9999 })).toBe(9999);
  });

  it("no derivation without a zone, without a boss mapping, or with several ids", () => {
    expect(effectiveWclRankingEncounterId({ ...KITHIX, wclZoneId: null })).toBeNull();
    expect(effectiveWclRankingEncounterId({ ...KITHIX, bosses: [boss("kithix", 1, [])] })).toBeNull();
    expect(effectiveWclRankingEncounterId({ ...KITHIX, bosses: [boss("kithix", 1, [3513, 3514])] })).toBeNull();
  });
});

describe("roster WCL performance ranking scope", () => {
  afterEach(() => vi.restoreAllMocks());

  it("Kith'ix and Venomous Abyss are fetched separately (encounter vs zone-wide)", async () => {
    vi.spyOn(warcraftLogsApiClient, "isConfigured").mockReturnValue(true);
    const fetch = vi.spyOn(warcraftLogsApiClient, "fetchZoneRankings").mockResolvedValue({
      status: "SUCCESS",
      rankings: { bestPerformanceAverage: 90, medianPerformanceAverage: 70 },
    } as Awaited<ReturnType<typeof warcraftLogsApiClient.fetchZoneRankings>>);
    vi.spyOn(characterWclPerformanceRepository, "listForCharacters").mockResolvedValue([]);
    vi.spyOn(characterWclPerformanceRepository, "upsert").mockResolvedValue(undefined as never);

    await resolveRosterWclPerformance({
      difficulty: "HEROIC",
      contents: [
        { raidId: VENOMOUS.id, raidName: VENOMOUS.name, sortOrder: 1 },
        { raidId: KITHIX.id, raidName: KITHIX.name, sortOrder: 2 },
      ],
      boosters: [
        {
          signupId: "s1",
          offeredRoles: ["RANGED_DPS"],
          character: { id: "c1", wowClass: "MAGE", specialization: "Fire", primaryRole: "RANGED_DPS", warcraftLogsId: "123" },
        },
      ],
      catalog: buildRaidCatalog([VENOMOUS, KITHIX, TIDEBOUND]),
      now: new Date("2026-10-22T12:00:00.000Z"),
    });

    const scopes = fetch.mock.calls.map(([args]) => `${args.zoneId}:${args.encounterId ?? "zone"}`).sort();
    expect(scopes).toEqual(["53:3513", "53:zone"]);
  });
});
