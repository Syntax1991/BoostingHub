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

  it("fetches only the specialization role when multi-role (no heal+dps mix)", async () => {
    fetchZoneRankings.mockImplementation(async (input: { encounterId?: number; metric: string; role?: string }) => {
      if (input.metric === "dps" && input.role === "Tank") {
        return {
          status: "SUCCESS",
          rankings: {
            bestPerformanceAverage: input.encounterId === 3379 ? 80 : 88,
            medianPerformanceAverage: input.encounterId === 3379 ? 55 : 62,
          },
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
            primaryRole: "TANK",
            warcraftLogsId: "999",
          },
        },
      ],
      now: new Date("2026-09-20T12:00:00.000Z"),
    });

    const segments = map.get("signup-1");
    expect(segments).toHaveLength(2);
    expect(segments?.[0]?.raidName).toBe("Nymrissa");
    expect(segments?.[0]?.roles.map((r) => r.role)).toEqual(["TANK"]);
    expect(segments?.[0]?.roles[0]?.specLabel).toBe("Protection");
    expect(segments?.[1]?.raidName).toBe("The Venomous Abyss");
    expect(segments?.[1]?.roles).toHaveLength(1);
    expect(segments?.[1]?.roles[0]?.bestPct).toBe(88);
    expect(fetchZoneRankings.mock.calls.every((call) => call[0]?.metric !== "hps")).toBe(true);
    expect(upsert).toHaveBeenCalled();
  });

  it("uses HPS only for a healer who also offered DPS", async () => {
    fetchZoneRankings.mockResolvedValue({
      status: "SUCCESS",
      rankings: { bestPerformanceAverage: 72, medianPerformanceAverage: 61 },
    });

    const { resolveRosterWclPerformance } = await import("@/services/character-wcl-performance.service");
    await resolveRosterWclPerformance({
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

    expect(fetchZoneRankings).toHaveBeenCalledTimes(1);
    expect(fetchZoneRankings.mock.calls[0]?.[0]).toMatchObject({ metric: "hps" });
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
