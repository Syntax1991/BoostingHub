import { describe, expect, it } from "vitest";
import { formatWclPerformanceRaidLine } from "@/lib/wcl-performance-display";
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
});
