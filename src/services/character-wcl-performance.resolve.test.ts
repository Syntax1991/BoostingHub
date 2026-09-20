import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
} from "@/lib/wow-raid-catalog";

const listForCharacters = vi.fn();
const upsert = vi.fn();
const fetchZoneRankings = vi.fn();
const isConfigured = vi.fn();

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

  it("uses HPS for healer role and DPS for dps role when both offered", async () => {
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
          offeredRoles: ["HEALER", "DPS"],
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
    expect(roles).toEqual(["HEALER", "DPS"]);
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
        metricKey: "dps",
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
          offeredRoles: ["DPS"],
          character: {
            id: "char-1",
            wowClass: "MAGE",
            specialization: null,
            primaryRole: "DPS",
            warcraftLogsId: "111",
          },
        },
      ],
      now: new Date("2026-09-20T12:00:00.000Z"),
    });

    expect(fetchZoneRankings).not.toHaveBeenCalled();
    expect(map.get("signup-1")?.[0]?.roles[0]).toMatchObject({ bestPct: 91, avgPct: 70 });
  });
});
