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

  it("fetches per-raid × per-offered-role and keeps multi-role segments", async () => {
    fetchZoneRankings.mockImplementation(async (input: { encounterId?: number; metric: string; role?: string }) => {
      if (input.encounterId === 3379 && input.metric === "dps" && input.role === "Tank") {
        return {
          status: "SUCCESS",
          rankings: { bestPerformanceAverage: 80, medianPerformanceAverage: 55 },
        };
      }
      if (input.encounterId === 3379 && input.metric === "hps") {
        return {
          status: "SUCCESS",
          rankings: { bestPerformanceAverage: 70, medianPerformanceAverage: 50 },
        };
      }
      if (!input.encounterId && input.metric === "dps" && input.role === "Tank") {
        return {
          status: "SUCCESS",
          rankings: { bestPerformanceAverage: 88, medianPerformanceAverage: 62 },
        };
      }
      if (!input.encounterId && input.metric === "hps") {
        return {
          status: "SUCCESS",
          rankings: { bestPerformanceAverage: 75, medianPerformanceAverage: 58 },
        };
      }
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
            wowClass: "PALADIN",
            specialization: "Protection",
            warcraftLogsId: "999",
          },
        },
      ],
      now: new Date("2026-09-20T12:00:00.000Z"),
    });

    const segments = map.get("signup-1");
    expect(segments).toHaveLength(2);
    expect(segments?.[0]?.raidName).toBe("Nymrissa");
    expect(segments?.[0]?.roles.map((r) => r.role)).toEqual(["TANK", "HEALER"]);
    expect(segments?.[0]?.roles[0]?.specLabel).toBe("Protection");
    expect(segments?.[0]?.roles[1]?.specLabel).toBeNull();
    expect(segments?.[1]?.raidName).toBe("The Venomous Abyss");
    expect(segments?.[1]?.roles[0]?.bestPct).toBe(88);
    expect(upsert).toHaveBeenCalled();
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
