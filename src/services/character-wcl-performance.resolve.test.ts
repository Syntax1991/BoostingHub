import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
} from "@/lib/wow-raid-catalog";

const listForCharacters = vi.fn();
const upsert = vi.fn();
const fetchZoneRankings = vi.fn();
const isConfigured = vi.fn();
const scheduled: Array<() => Promise<void>> = [];

vi.mock("@/lib/after-response", () => ({
  runAfterResponse: (task: () => Promise<void>) => {
    scheduled.push(task);
  },
}));

vi.mock("@/repositories/character-wcl-performance.repository", () => ({
  characterWclPerformanceRepository: {
    listForCharacters: (...args: unknown[]) => listForCharacters(...args),
    upsert: (...args: unknown[]) => upsert(...args),
  },
}));

vi.mock("@/integrations/warcraft-logs/warcraft-logs-api-client", () => ({
  warcraftLogsApiClient: {
    isConfigured: () => isConfigured(),
    fetchZoneRankings: (...args: unknown[]) => fetchZoneRankings(...args),
  },
}));

describe("resolveRosterWclPerformance", () => {
  beforeEach(() => {
    vi.resetModules();
    listForCharacters.mockReset();
    upsert.mockReset();
    fetchZoneRankings.mockReset();
    isConfigured.mockReset();
    isConfigured.mockReturnValue(true);
    listForCharacters.mockResolvedValue([]);
    upsert.mockResolvedValue(undefined);
    scheduled.length = 0;
  });

  it("returns empty when WCL is not configured", async () => {
    isConfigured.mockReturnValue(false);
    const { resolveRosterWclPerformance } = await import("@/services/character-wcl-performance.service");
    const map = await resolveRosterWclPerformance({
      difficulty: "HEROIC",
      contents: [
        {
          raidId: TIDEBOUND_GROTTO_RAID_ID,
          raidName: "The Tidebound Grotto",
          sortOrder: 1,
        },
        {
          raidId: VENOMOUS_ABYSS_RAID_ID,
          raidName: "The Venomous Abyss",
          sortOrder: 2,
        },
      ],
      boosters: [],
    });
    expect(map.size).toBe(0);
    expect(fetchZoneRankings).not.toHaveBeenCalled();
  });

  it("fetches per offered role; tank column can omit HPS when no tank parses", async () => {
    fetchZoneRankings.mockImplementation(async (input: { encounterId?: number; metric: string; role?: string }) => {
      if (input.metric === "hps") {
        return {
          status: "SUCCESS",
          rankings: {
            bestPerformanceAverage: input.encounterId === 3379 ? 80 : 88,
            medianPerformanceAverage: input.encounterId === 3379 ? 55 : 62,
          },
        };
      }
      // No tank parses for this resto/mw character.
      return { status: "NOT_FOUND" };
    });

    const { resolveRosterWclPerformance } = await import("@/services/character-wcl-performance.service");
    const map = await resolveRosterWclPerformance({
      difficulty: "HEROIC",
      contents: [
        {
          raidId: TIDEBOUND_GROTTO_RAID_ID,
          raidName: "The Tidebound Grotto",
          sortOrder: 1,
        },
        {
          raidId: VENOMOUS_ABYSS_RAID_ID,
          raidName: "The Venomous Abyss",
          sortOrder: 2,
        },
      ],
      boosters: [
        {
          signupId: "signup-1",
          offeredRoles: ["TANK", "HEALER"],
          character: {
            id: "char-1",
            wowClass: "DRUID",
            specialization: "Restoration",
            primaryRole: "HEALER",
            warcraftLogsId: "999",
          },
        },
      ],
      now: new Date("2026-09-20T12:00:00.000Z"),
    });

    const segments = map.get("signup-1");
    expect(segments).toHaveLength(2);
    expect(segments?.every((s) => s.roles.every((r) => r.role === "HEALER"))).toBe(true);
    expect(fetchZoneRankings.mock.calls.some((call) => call[0]?.role === "Tank")).toBe(true);
    expect(fetchZoneRankings.mock.calls.some((call) => call[0]?.metric === "hps")).toBe(true);
  });

  it("skips DPS fetch for Holy who also offered DPS (no healer DPS logs)", async () => {
    fetchZoneRankings.mockImplementation(async (input: { metric: string }) => ({
      status: "SUCCESS",
      rankings: {
        bestPerformanceAverage: input.metric === "hps" ? 72 : 40,
        medianPerformanceAverage: input.metric === "hps" ? 61 : 35,
      },
    }));

    const { resolveRosterWclPerformance } = await import("@/services/character-wcl-performance.service");
    const map = await resolveRosterWclPerformance({
      difficulty: "HEROIC",
      contents: [
        {
          raidId: VENOMOUS_ABYSS_RAID_ID,
          raidName: "The Venomous Abyss",
          sortOrder: 1,
        },
      ],
      boosters: [
        {
          signupId: "signup-h",
          offeredRoles: ["HEALER", "RANGED_DPS"],
          character: {
            id: "char-h",
            wowClass: "PRIEST",
            specialization: "Holy",
            primaryRole: "HEALER",
            warcraftLogsId: "222",
          },
        },
      ],
      now: new Date("2026-09-20T12:00:00.000Z"),
    });

    const roles = map.get("signup-h")?.[0]?.roles.map((r) => r.role) ?? [];
    expect(roles).toEqual(["HEALER"]);
    expect(fetchZoneRankings).toHaveBeenCalledTimes(1);
    expect(fetchZoneRankings.mock.calls[0]?.[0]).toMatchObject({ metric: "hps" });
  });

  it("fetches DPS for a real DPS spec who also offered healer", async () => {
    fetchZoneRankings.mockImplementation(async (input: { metric: string }) => ({
      status: "SUCCESS",
      rankings: {
        bestPerformanceAverage: input.metric === "hps" ? 20 : 90,
        medianPerformanceAverage: input.metric === "hps" ? 15 : 80,
      },
    }));

    const { resolveRosterWclPerformance } = await import("@/services/character-wcl-performance.service");
    const map = await resolveRosterWclPerformance({
      difficulty: "HEROIC",
      contents: [
        {
          raidId: VENOMOUS_ABYSS_RAID_ID,
          raidName: "The Venomous Abyss",
          sortOrder: 1,
        },
      ],
      boosters: [
        {
          signupId: "signup-s",
          offeredRoles: ["HEALER", "RANGED_DPS"],
          character: {
            id: "char-s",
            wowClass: "PRIEST",
            specialization: "Shadow",
            primaryRole: "RANGED_DPS",
            warcraftLogsId: "333",
          },
        },
      ],
      now: new Date("2026-09-20T12:00:00.000Z"),
    });

    const roles = map.get("signup-s")?.[0]?.roles.map((r) => r.role) ?? [];
    expect(roles).toEqual(["HEALER", "RANGED_DPS"]);
    expect(fetchZoneRankings).toHaveBeenCalledTimes(2);
  });

  it("hits fresh cache for role-only dps key", async () => {
    listForCharacters.mockResolvedValue([
      {
        id: "cache-1",
        characterId: "char-1",
        zoneId: 53,
        encounterId: 0,
        difficulty: 4,
        // Venomous shares zone 53 with Tidebound → raid-scoped cache key.
        metricKey: "dps@raid",
        bestPct: 91,
        avgPct: 70,
        fetchedAt: "2026-09-20T11:00:00.000Z",
      },
    ]);

    const { resolveRosterWclPerformance } = await import("@/services/character-wcl-performance.service");
    const map = await resolveRosterWclPerformance({
      difficulty: "HEROIC",
      contents: [
        {
          raidId: VENOMOUS_ABYSS_RAID_ID,
          raidName: "The Venomous Abyss",
          sortOrder: 1,
        },
      ],
      boosters: [
        {
          signupId: "signup-1",
          offeredRoles: ["RANGED_DPS"],
          character: {
            id: "char-1",
            wowClass: "MAGE",
            specialization: null,
            primaryRole: "RANGED_DPS",
            warcraftLogsId: "111",
          },
        },
      ],
      now: new Date("2026-09-20T12:00:00.000Z"),
    });

    expect(fetchZoneRankings).not.toHaveBeenCalled();
    expect(map.get("signup-1")?.[0]?.roles[0]).toMatchObject({ bestPct: 91, avgPct: 70 });
  });

  it("deferred: answers from the stale cache at once and refreshes after the response, once per key", async () => {
    const staleRow = {
      id: "cache-1",
      characterId: "char-1",
      zoneId: 53,
      encounterId: 0,
      difficulty: 4,
      metricKey: "dps@raid",
      bestPct: 50,
      avgPct: 40,
      fetchedAt: "2026-09-18T00:00:00.000Z", // older than the 12 h TTL
    };
    listForCharacters.mockResolvedValue([staleRow]);
    fetchZoneRankings.mockResolvedValue({
      status: "SUCCESS",
      rankings: { bestPerformanceAverage: 91, medianPerformanceAverage: 70, encounters: null },
    });
    const { resolveRosterWclPerformance } = await import("@/services/character-wcl-performance.service");
    const input = {
      deferRemoteFetch: true,
      difficulty: "HEROIC" as const,
      contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, raidName: "The Venomous Abyss", sortOrder: 1 }],
      boosters: [
        {
          signupId: "signup-1",
          offeredRoles: ["RANGED_DPS" as const],
          character: { id: "char-1", wowClass: "MAGE" as const, specialization: null, primaryRole: "RANGED_DPS" as const, warcraftLogsId: "111" },
        },
      ],
      now: new Date("2026-09-20T12:00:00.000Z"),
    };

    const map = await resolveRosterWclPerformance(input);
    // The render got the stale values without waiting on Warcraft Logs.
    expect(fetchZoneRankings).not.toHaveBeenCalled();
    expect(map.get("signup-1")?.[0]?.roles[0]).toMatchObject({ bestPct: 50, avgPct: 40 });
    expect(scheduled).toHaveLength(1);

    // A parallel view while the refresh is pending schedules nothing new.
    await resolveRosterWclPerformance(input);
    expect(scheduled).toHaveLength(1);

    // After the response: the refresh fetches and stores the fresh values.
    await scheduled[0]!();
    expect(fetchZoneRankings).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ characterId: "char-1", bestPct: 91, avgPct: 70 }));
  });

  it("falls back to role-wide cache when the spec-scoped row has no percentiles", async () => {
    listForCharacters.mockResolvedValue([
      {
        id: "cache-base",
        characterId: "char-tank",
        zoneId: 53,
        encounterId: 0,
        difficulty: 4,
        metricKey: "tank-dps@raid",
        bestPct: 72,
        avgPct: 54,
        fetchedAt: "2026-09-20T11:00:00.000Z",
      },
      {
        id: "cache-spec",
        characterId: "char-tank",
        zoneId: 53,
        encounterId: 0,
        difficulty: 4,
        metricKey: "tank-dps:Protection@raid",
        bestPct: null,
        avgPct: null,
        fetchedAt: "2026-09-20T11:00:00.000Z",
      },
    ]);

    const { resolveRosterWclPerformance } = await import("@/services/character-wcl-performance.service");
    const map = await resolveRosterWclPerformance({
      difficulty: "HEROIC",
      contents: [
        {
          raidId: VENOMOUS_ABYSS_RAID_ID,
          raidName: "The Venomous Abyss",
          sortOrder: 1,
        },
      ],
      boosters: [
        {
          signupId: "signup-tank",
          offeredRoles: ["TANK"],
          character: {
            id: "char-tank",
            wowClass: "WARRIOR",
            specialization: "Protection",
            primaryRole: "TANK",
            playableSpecs: [],
            warcraftLogsId: "444",
          },
        },
      ],
      now: new Date("2026-09-20T12:00:00.000Z"),
      allowRemoteFetch: false,
    });

    expect(map.get("signup-tank")?.[0]?.roles[0]).toMatchObject({
      role: "TANK",
      specLabel: "Protection",
      bestPct: 72,
      avgPct: 54,
    });
    expect(fetchZoneRankings).not.toHaveBeenCalled();
  });

  it("deferred: a fresh cache schedules no refresh", async () => {
    listForCharacters.mockResolvedValue([
      { id: "c", characterId: "char-1", zoneId: 53, encounterId: 0, difficulty: 4, metricKey: "dps@raid", bestPct: 91, avgPct: 70, fetchedAt: "2026-09-20T11:00:00.000Z" },
    ]);
    const { resolveRosterWclPerformance } = await import("@/services/character-wcl-performance.service");
    await resolveRosterWclPerformance({
      deferRemoteFetch: true,
      difficulty: "HEROIC",
      contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, raidName: "The Venomous Abyss", sortOrder: 1 }],
      boosters: [
        { signupId: "s", offeredRoles: ["RANGED_DPS"], character: { id: "char-1", wowClass: "MAGE", specialization: null, primaryRole: "RANGED_DPS", warcraftLogsId: "111" } },
      ],
      now: new Date("2026-09-20T12:00:00.000Z"),
    });
    expect(scheduled).toHaveLength(0);
    expect(fetchZoneRankings).not.toHaveBeenCalled();
  });
});
