import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRaidCatalog, effectiveWclRankingEncounterId, type CatalogRaid } from "@/lib/raid-catalog";
import { warcraftLogsApiClient } from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { characterWclPerformanceRepository } from "@/repositories/character-wcl-performance.repository";
import {
  RAID_SCOPED_METRIC_SUFFIX,
  resolveRosterWclPerformance,
  sharedZoneEncounterScope,
} from "@/services/character-wcl-performance.service";

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
    // Venomous shares zone 53 with Tide / Kith'ix → its zone query is restricted to its own bosses.
    const venomousCall = fetch.mock.calls.find(([args]) => args.encounterId == null)![0];
    expect(venomousCall.encounterIds).toEqual([3470, 3445]);
    const kithixCall = fetch.mock.calls.find(([args]) => args.encounterId === 3513)![0];
    expect(kithixCall.encounterIds).toBeUndefined();
  });
});

describe("sharedZoneEncounterScope", () => {
  it("multi-boss raid in a shared zone → its own encounter ids", () => {
    expect(sharedZoneEncounterScope(VENOMOUS, buildRaidCatalog([VENOMOUS, KITHIX, TIDEBOUND]))).toEqual([3470, 3445]);
  });

  it("alone in its zone → plain zone-wide (no change)", () => {
    expect(sharedZoneEncounterScope(VENOMOUS, buildRaidCatalog([VENOMOUS]))).toBeNull();
  });

  it("no zone or no boss mapping → none", () => {
    const catalog = buildRaidCatalog([VENOMOUS, KITHIX]);
    expect(sharedZoneEncounterScope({ ...VENOMOUS, wclZoneId: null }, catalog)).toBeNull();
    expect(sharedZoneEncounterScope({ ...VENOMOUS, bosses: [] }, catalog)).toBeNull();
  });

  it("raid-scoped values use their own cache key (old zone-wide rows are not reused)", async () => {
    vi.spyOn(warcraftLogsApiClient, "isConfigured").mockReturnValue(true);
    vi.spyOn(warcraftLogsApiClient, "fetchZoneRankings").mockResolvedValue({
      status: "SUCCESS",
      rankings: { bestPerformanceAverage: 65, medianPerformanceAverage: 45, encounters: [] },
    });
    const zoneWideRow = {
      id: "old",
      characterId: "c1",
      zoneId: 53,
      encounterId: 0,
      difficulty: 4,
      metricKey: "dps:Fire",
      bestPct: 99,
      avgPct: 99,
      fetchedAt: "2026-10-22T11:00:00.000Z",
    };
    vi.spyOn(characterWclPerformanceRepository, "listForCharacters").mockResolvedValue([zoneWideRow] as never);
    const upsert = vi.spyOn(characterWclPerformanceRepository, "upsert").mockResolvedValue(undefined as never);

    const result = await resolveRosterWclPerformance({
      difficulty: "HEROIC",
      contents: [{ raidId: VENOMOUS.id, raidName: VENOMOUS.name, sortOrder: 1 }],
      boosters: [
        {
          signupId: "s1",
          offeredRoles: ["RANGED_DPS"],
          character: { id: "c1", wowClass: "MAGE", specialization: "Fire", primaryRole: "RANGED_DPS", warcraftLogsId: "123" },
        },
      ],
      catalog: buildRaidCatalog([VENOMOUS, KITHIX]),
      now: new Date("2026-10-22T12:00:00.000Z"),
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ metricKey: `dps:Fire${RAID_SCOPED_METRIC_SUFFIX}`, bestPct: 65 }),
    );
    expect(JSON.stringify(result.get("s1"))).toContain("65");
    expect(JSON.stringify(result.get("s1"))).not.toContain("99");
  });
});

describe("roster segments mark zone vs encounter ranking", () => {
  afterEach(() => vi.restoreAllMocks());

  it("Venomous is zone (all bosses); Kith'ix is encounter (single boss)", async () => {
    vi.spyOn(warcraftLogsApiClient, "isConfigured").mockReturnValue(true);
    vi.spyOn(warcraftLogsApiClient, "fetchZoneRankings").mockResolvedValue({
      status: "SUCCESS",
      rankings: { bestPerformanceAverage: 94.4, medianPerformanceAverage: 66.2 },
    } as Awaited<ReturnType<typeof warcraftLogsApiClient.fetchZoneRankings>>);
    vi.spyOn(characterWclPerformanceRepository, "listForCharacters").mockResolvedValue([]);
    vi.spyOn(characterWclPerformanceRepository, "upsert").mockResolvedValue(undefined as never);

    const result = await resolveRosterWclPerformance({
      difficulty: "HEROIC",
      contents: [
        { raidId: TIDEBOUND.id, raidName: TIDEBOUND.name, sortOrder: 1 },
        { raidId: VENOMOUS.id, raidName: VENOMOUS.name, sortOrder: 2 },
        { raidId: KITHIX.id, raidName: KITHIX.name, sortOrder: 3 },
      ],
      boosters: [
        {
          signupId: "s1",
          offeredRoles: ["HEALER"],
          character: {
            id: "c1",
            wowClass: "DRUID",
            specialization: "Restoration",
            primaryRole: "HEALER",
            warcraftLogsId: "123",
          },
        },
      ],
      catalog: buildRaidCatalog([VENOMOUS, KITHIX, TIDEBOUND]),
      now: new Date("2026-10-22T12:00:00.000Z"),
    });

    const segments = result.get("s1") ?? [];
    expect(segments.map((s) => [s.raidId, s.rankingKind])).toEqual([
      [TIDEBOUND.id, "encounter"],
      [VENOMOUS.id, "zone"],
      [KITHIX.id, "encounter"],
    ]);
  });
});
