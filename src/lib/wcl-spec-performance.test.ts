import { describe, expect, it } from "vitest";
import { resolveSignupTileWclBest, wclBestForSpec } from "@/lib/wcl-spec-performance";
import type { WclPerformanceRaidSegment } from "@/lib/wcl-performance-display";

const segments: WclPerformanceRaidSegment[] = [
  {
    raidId: "manaforge",
    raidName: "Manaforge",
    roles: [
      { role: "HEALER", specLabel: "Restoration", bestPct: 61, avgPct: 50 },
      { role: "RANGED_DPS", specLabel: "Elemental", bestPct: 97, avgPct: 80 },
    ],
  },
];

describe("wclBestForSpec", () => {
  it("returns the percentile for the chosen spec only", () => {
    expect(wclBestForSpec(segments, "HEALER", "Restoration")).toBe(61);
    expect(wclBestForSpec(segments, "RANGED_DPS", "Elemental")).toBe(97);
  });

  it("does not return Elemental while choosing Restoration", () => {
    expect(wclBestForSpec(segments, "HEALER", "Restoration")).not.toBe(97);
  });
});

const offered = [
  { name: "Restoration", role: "HEALER" as const },
  { name: "Elemental", role: "RANGED_DPS" as const },
];

describe("resolveSignupTileWclBest", () => {
  it("single offered spec → that Best", () => {
    const result = resolveSignupTileWclBest({
      segments,
      offeredSpecs: [offered[0]!],
      selected: false,
      assignedRole: null,
      assignedSpec: null,
    });
    expect(result.bestPct).toBe(61);
    expect(result.specName).toBe("Restoration");
  });

  it("undrafted multi-spec → peak Best without inventing a primary", () => {
    const result = resolveSignupTileWclBest({
      segments,
      offeredSpecs: offered,
      selected: false,
      assignedRole: null,
      assignedSpec: null,
    });
    expect(result.bestPct).toBe(97);
    expect(result.specName).toBeNull();
  });

  it("selected alternate Elemental → Elemental Best, not Restoration", () => {
    const result = resolveSignupTileWclBest({
      segments,
      offeredSpecs: offered,
      selected: true,
      assignedRole: "RANGED_DPS",
      assignedSpec: "Elemental",
    });
    expect(result.bestPct).toBe(97);
    expect(result.specName).toBe("Elemental");
    expect(result.bestPct).not.toBe(61);
  });

  it("no cached segments → quiet (no placeholder)", () => {
    expect(
      resolveSignupTileWclBest({
        segments: [],
        offeredSpecs: offered,
        selected: false,
        assignedRole: null,
        assignedSpec: null,
      }).bestPct,
    ).toBeNull();
  });
});
