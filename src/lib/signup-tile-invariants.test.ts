import { describe, expect, it } from "vitest";
import { resolveOfferedSpecs } from "@/lib/signup-offered-specs";
import {
  offeredSpecsForTile,
  signupMatchesRoleFilter,
  tileVisibleSpecs,
  uniqueSignupTiles,
} from "@/lib/signup-tile-invariants";
import { wclAvgForSpec, wclBestForSpec } from "@/lib/wcl-spec-performance";
import type { WclPerformanceRaidSegment } from "@/lib/wcl-performance-display";
import { getWarcraftLogsCharacterUrl } from "@/lib/warcraft-logs";

const stormhowlInput = {
  wowClass: "SHAMAN" as const,
  primarySpecialization: "Restoration",
  playableSpecs: ["Elemental"],
  offeredRoles: ["HEALER", "RANGED_DPS"] as const,
};

const segments: WclPerformanceRaidSegment[] = [
  {
    raidId: "abyss",
    raidName: "The Venomous Abyss",
    roles: [
      { role: "HEALER", specLabel: "Restoration", bestPct: 61, avgPct: 54 },
      { role: "RANGED_DPS", specLabel: "Elemental", bestPct: 97, avgPct: 82 },
    ],
  },
];

describe("signup tile — one Character = one tile", () => {
  it("single-spec Character → one offered choice", () => {
    const specs = offeredSpecsForTile({
      wowClass: "WARRIOR",
      primarySpecialization: "Protection",
      playableSpecs: [],
      offeredRoles: ["TANK"],
    });
    expect(specs).toEqual([{ name: "Protection", role: "TANK" }]);
  });

  it("multi-spec Character → one tile with two spec choices", () => {
    const specs = resolveOfferedSpecs(stormhowlInput);
    expect(specs).toHaveLength(2);
    expect(specs.map((s) => s.name).sort()).toEqual(["Elemental", "Restoration"]);
  });

  it("Elemental → RANGED_DPS and Restoration → HEALER", () => {
    const specs = resolveOfferedSpecs(stormhowlInput);
    expect(specs.find((s) => s.name === "Elemental")?.role).toBe("RANGED_DPS");
    expect(specs.find((s) => s.name === "Restoration")?.role).toBe("HEALER");
  });

  it("uniqueSignupTiles never duplicates by signup id", () => {
    const rows = [
      { id: "a", name: "Stormhowl" },
      { id: "a", name: "Stormhowl" },
      { id: "b", name: "Ironvein" },
    ];
    expect(uniqueSignupTiles(rows)).toEqual([
      { id: "a", name: "Stormhowl" },
      { id: "b", name: "Ironvein" },
    ]);
  });

  it("role filters keep aggregated Character visible once (not duplicated)", () => {
    const roles = ["HEALER", "RANGED_DPS"] as const;
    expect(signupMatchesRoleFilter(roles, "HEALER")).toBe(true);
    expect(signupMatchesRoleFilter(roles, "RANGED_DPS")).toBe(true);
    expect(signupMatchesRoleFilter(roles, "MELEE_DPS")).toBe(false);
  });

  it("selected spec updates visible tile specs without adding another choice", () => {
    const offered = resolveOfferedSpecs(stormhowlInput);
    expect(tileVisibleSpecs(offered, false, null)).toHaveLength(2);
    expect(tileVisibleSpecs(offered, true, "Elemental")).toEqual([
      { name: "Elemental", role: "RANGED_DPS" },
    ]);
  });
});

describe("signup tile — per-spec WCL", () => {
  it("per-spec Best is correct and never mixed", () => {
    expect(wclBestForSpec(segments, "RANGED_DPS", "Elemental")).toBe(97);
    expect(wclBestForSpec(segments, "HEALER", "Restoration")).toBe(61);
    expect(wclBestForSpec(segments, "HEALER", "Restoration")).not.toBe(97);
  });

  it("per-spec Avg is correct for tooltip/modal", () => {
    expect(wclAvgForSpec(segments, "RANGED_DPS", "Elemental")).toBe(82);
    expect(wclAvgForSpec(segments, "HEALER", "Restoration")).toBe(54);
  });

  it("WCL absent → no percentile (no placeholder)", () => {
    expect(wclBestForSpec([], "HEALER", "Restoration")).toBeNull();
    expect(wclAvgForSpec([], "HEALER", "Restoration")).toBeNull();
  });

  it("WCL link uses existing character-id destination", () => {
    expect(getWarcraftLogsCharacterUrl("12345678")).toBe(
      "https://www.warcraftlogs.com/character/id/12345678",
    );
    expect(getWarcraftLogsCharacterUrl(null)).toBeNull();
    expect(getWarcraftLogsCharacterUrl("")).toBeNull();
  });
});
