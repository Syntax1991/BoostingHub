import { describe, expect, it } from "vitest";
import {
  filterWclPerformanceForGroupRole,
  formatWclPerformanceRaidLine,
  wclPercentileColor,
} from "@/lib/wcl-performance-display";
import { VENOMOUS_ABYSS_RAID_ID, TIDEBOUND_GROTTO_RAID_ID } from "@/lib/wow-raid-catalog";

describe("roster WCL performance display copy", () => {
  it("renders Bundle multi-role lines without collapsing raids", () => {
    const nymrissa = formatWclPerformanceRaidLine({
      raidId: TIDEBOUND_GROTTO_RAID_ID,
      raidName: "Nymrissa",
      roles: [
        { role: "TANK", specLabel: "Protection", bestPct: 80, avgPct: 55 },
        { role: "HEALER", specLabel: null, bestPct: 70, avgPct: 50 },
      ],
    });
    const venomous = formatWclPerformanceRaidLine({
      raidId: VENOMOUS_ABYSS_RAID_ID,
      raidName: "The Venomous Abyss",
      roles: [
        { role: "TANK", specLabel: "Protection", bestPct: 88, avgPct: 62 },
        { role: "HEALER", specLabel: null, bestPct: 75, avgPct: 58 },
      ],
    });

    expect(nymrissa).toContain("Nymrissa");
    expect(nymrissa).toContain("Tank (Protection)");
    expect(nymrissa).toContain("HPS");
    expect(venomous).toContain("The Venomous Abyss");
    expect(venomous).not.toMatch(/9\/9|4\/9/);
  });

  it("filters to the roster column role and drops empty raids", () => {
    const segments = [
      {
        raidId: TIDEBOUND_GROTTO_RAID_ID,
        raidName: "Nymrissa",
        roles: [
          { role: "TANK" as const, specLabel: null, bestPct: 40, avgPct: 30 },
          { role: "HEALER" as const, specLabel: "Restoration", bestPct: 80, avgPct: 55 },
        ],
      },
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        roles: [{ role: "HEALER" as const, specLabel: "Restoration", bestPct: 70, avgPct: 50 }],
      },
    ];

    const tankOnly = filterWclPerformanceForGroupRole(segments, "TANK");
    expect(tankOnly).toHaveLength(1);
    expect(tankOnly[0]?.roles.map((r) => r.role)).toEqual(["TANK"]);
    expect(tankOnly[0]?.roles.some((r) => r.role === "HEALER")).toBe(false);

    const healerOnly = filterWclPerformanceForGroupRole(segments, "HEALER");
    expect(healerOnly).toHaveLength(2);
    expect(healerOnly.every((s) => s.roles.every((r) => r.role === "HEALER"))).toBe(true);
  });
});

describe("wclPercentileColor", () => {
  it("maps WCL quality thresholds", () => {
    expect(wclPercentileColor(10)).toBe("#9d9d9d");
    expect(wclPercentileColor(25)).toBe("#1eff00");
    expect(wclPercentileColor(50)).toBe("#0070dd");
    expect(wclPercentileColor(75)).toBe("#a335ee");
    expect(wclPercentileColor(95)).toBe("#ff8000");
    expect(wclPercentileColor(99)).toBe("#e268a8");
    expect(wclPercentileColor(100)).toBe("#e5cc80");
  });
});
