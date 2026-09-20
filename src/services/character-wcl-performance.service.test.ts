import { describe, expect, it } from "vitest";
import { formatWclPerformanceRaidLine } from "@/lib/wcl-performance-display";
import {
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
  VENOMOUS_ABYSS_WARCRAFT_LOGS_ZONE_ID,
  NYMRISSA_WARCRAFT_LOGS_ENCOUNTER_ID,
  findRaidCatalogById,
} from "@/lib/wow-raid-catalog";
import {
  buildMetricKey,
  rolesRelevantForWclPerformance,
  specNameForOfferedRole,
  WCL_DIFFICULTY,
} from "@/services/character-wcl-performance.service";
import { mapZoneRankings } from "@/integrations/warcraft-logs/warcraft-logs-api-client";

describe("mapZoneRankings", () => {
  it("maps best and median averages", () => {
    expect(
      mapZoneRankings({
        bestPerformanceAverage: 91.2,
        medianPerformanceAverage: 70.5,
      }),
    ).toEqual({
      bestPerformanceAverage: 91.2,
      medianPerformanceAverage: 70.5,
    });
  });

  it("returns null for malformed payloads", () => {
    expect(mapZoneRankings(null)).toBeNull();
    expect(mapZoneRankings("x")).toBeNull();
  });
});

describe("WCL catalog mapping", () => {
  it("maps Venomous to zone-wide rankings and Nymrissa to encounter-scoped", () => {
    const venomous = findRaidCatalogById(VENOMOUS_ABYSS_RAID_ID);
    const tidebound = findRaidCatalogById(TIDEBOUND_GROTTO_RAID_ID);
    expect(venomous?.warcraftLogsZoneId).toBe(VENOMOUS_ABYSS_WARCRAFT_LOGS_ZONE_ID);
    expect(venomous?.warcraftLogsEncounterId).toBeUndefined();
    expect(tidebound?.warcraftLogsZoneId).toBe(VENOMOUS_ABYSS_WARCRAFT_LOGS_ZONE_ID);
    expect(tidebound?.warcraftLogsEncounterId).toBe(NYMRISSA_WARCRAFT_LOGS_ENCOUNTER_ID);
  });
});

describe("specNameForOfferedRole / metric keys", () => {
  it("uses specialization only when it matches the offered role", () => {
    expect(specNameForOfferedRole("PALADIN", "Holy", "HEALER")).toBe("Holy");
    expect(specNameForOfferedRole("PALADIN", "Holy", "TANK")).toBeNull();
    expect(specNameForOfferedRole("PALADIN", "Protection", "TANK")).toBe("Protection");
    expect(specNameForOfferedRole("MAGE", null, "DPS")).toBeNull();
  });

  it("builds metric keys with optional spec", () => {
    expect(buildMetricKey("hps", "Holy")).toBe("hps:Holy");
    expect(buildMetricKey("tank-dps", null)).toBe("tank-dps");
  });

  it("maps run difficulty to WCL filters", () => {
    expect(WCL_DIFFICULTY.NORMAL).toBe(3);
    expect(WCL_DIFFICULTY.HEROIC).toBe(4);
    expect(WCL_DIFFICULTY.MYTHIC).toBe(5);
  });
});

describe("rolesRelevantForWclPerformance", () => {
  it("drops DPS for healer specs (no healer-damage percentiles)", () => {
    expect(
      rolesRelevantForWclPerformance({
        offeredRoles: ["HEALER", "DPS"],
        wowClass: "PRIEST",
        specialization: "Holy",
        primaryRole: "HEALER",
      }),
    ).toEqual(["HEALER"]);
  });

  it("keeps DPS only for real DPS specs", () => {
    expect(
      rolesRelevantForWclPerformance({
        offeredRoles: ["HEALER", "DPS"],
        wowClass: "PRIEST",
        specialization: "Shadow",
        primaryRole: "DPS",
      }),
    ).toEqual(["HEALER", "DPS"]);
  });

  it("keeps tank+healer for resto (tank column stays empty if no tank parses)", () => {
    expect(
      rolesRelevantForWclPerformance({
        offeredRoles: ["TANK", "HEALER"],
        wowClass: "DRUID",
        specialization: "Restoration",
        primaryRole: "HEALER",
      }),
    ).toEqual(["TANK", "HEALER"]);
  });

  it("falls back to primaryRole when nothing was offered", () => {
    expect(
      rolesRelevantForWclPerformance({
        offeredRoles: [],
        wowClass: "MAGE",
        specialization: null,
        primaryRole: "DPS",
      }),
    ).toEqual(["DPS"]);
  });
});

describe("formatWclPerformanceRaidLine", () => {
  it("formats with metric labels and optional spec", () => {
    const line = formatWclPerformanceRaidLine({
      raidId: VENOMOUS_ABYSS_RAID_ID,
      raidName: "The Venomous Abyss",
      roles: [
        { role: "TANK", specLabel: "Protection", bestPct: 88, avgPct: 62 },
        { role: "HEALER", specLabel: null, bestPct: 75, avgPct: 58 },
      ],
    });
    expect(line).toContain("The Venomous Abyss");
    expect(line).toContain("Tank (Protection) best 88% · avg 62%");
    expect(line).toContain("HPS best 75% · avg 58%");
  });
});
