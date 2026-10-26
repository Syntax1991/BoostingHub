import { describe, expect, it } from "vitest";
import {
  formatWclSpecChip,
  formatWclSpecTooltip,
  resolveSignupTileWclBest,
  wclAvgForSpec,
  wclBestForSpec,
} from "@/lib/wcl-spec-performance";
import type { WclPerformanceRaidSegment } from "@/lib/wcl-performance-display";
import {
  TIDEBOUND_GROTTO_RAID_ID,
  UNBINDING_KITHIX_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
} from "@/lib/wow-raid-catalog";

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

/**
 * Lirâsorâ regression fixture — Season 2 Bundle order (Tide first, then Venomous).
 * Tide = single-boss encounter Best % 100; Venomous = zone Best Perf. Avg 94.4
 * over all bosses. Tile must prefer the zone average, not Tide's one boss.
 */
const lirasoraSegments: WclPerformanceRaidSegment[] = [
  {
    raidId: TIDEBOUND_GROTTO_RAID_ID,
    raidName: "Tide",
    rankingKind: "encounter",
    roles: [{ role: "HEALER", specLabel: "Restoration", bestPct: 100, avgPct: 42 }],
  },
  {
    raidId: VENOMOUS_ABYSS_RAID_ID,
    raidName: "The Venomous Abyss",
    rankingKind: "zone",
    roles: [{ role: "HEALER", specLabel: "Restoration", bestPct: 94.4, avgPct: 67 }],
  },
  {
    raidId: UNBINDING_KITHIX_RAID_ID,
    raidName: "The Unbinding of Kith'ix",
    rankingKind: "encounter",
    roles: [{ role: "HEALER", specLabel: "Restoration", bestPct: 93, avgPct: 88 }],
  },
];

const restorationOnly = [{ name: "Restoration", role: "HEALER" as const }];
const restoAndBalance = [
  { name: "Restoration", role: "HEALER" as const },
  { name: "Balance", role: "RANGED_DPS" as const },
];

describe("wclBestForSpec", () => {
  it("returns zoneRankings.bestPerformanceAverage for the chosen spec only", () => {
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
  it("single offered spec → that Best Perf. Avg", () => {
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

  it("undrafted multi-spec → peak Best Perf. Avg without inventing a primary", () => {
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

  it("selected alternate Elemental → Elemental Best Perf. Avg, not Restoration", () => {
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

describe("Lirâsorâ — Best Perf. Avg vs max boss/raid Best", () => {
  it("Bundle Tide-first: tile uses Venomous all-boss Best Perf. Avg 94.4, not Tide single-boss 100", () => {
    const result = resolveSignupTileWclBest({
      segments: lirasoraSegments,
      offeredSpecs: restorationOnly,
      selected: true,
      assignedRole: "HEALER",
      assignedSpec: "Restoration",
    });
    expect(result.bestPct).toBe(94.4);
    expect(result.bestPct).not.toBe(100);
    expect(result.bestPct).not.toBe(93);
  });

  it("prefers zone (all bosses) over encounter (one boss) even when Tide is first in content order", () => {
    expect(wclBestForSpec(lirasoraSegments, "HEALER", "Restoration")).toBe(94.4);
    expect(wclBestForSpec(lirasoraSegments, "HEALER", "Restoration")).not.toBe(100);
  });

  it("does not invent a Best Perf. Avg from a lone 100 boss parse row", () => {
    // Cached segment already stores zone Best Perf. Avg; a separate encounter row
    // with 100 must not appear as the tile metric when Venomous avg is 94.4.
    const withBossNoise: WclPerformanceRaidSegment[] = [
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        roles: [
          { role: "HEALER", specLabel: "Restoration", bestPct: 94.4, avgPct: 67 },
          // Spurious role noise must not replace the Restoration Best Perf. Avg.
          { role: "TANK", specLabel: "Guardian", bestPct: 100, avgPct: 100 },
        ],
      },
    ];
    expect(wclBestForSpec(withBossNoise, "HEALER", "Restoration")).toBe(94.4);
    expect(
      resolveSignupTileWclBest({
        segments: withBossNoise,
        offeredSpecs: restorationOnly,
        selected: true,
        assignedRole: "HEALER",
        assignedSpec: "Restoration",
      }).bestPct,
    ).toBe(94.4);
  });

  it("selected Restoration does not fall back to a stronger Balance score", () => {
    const dual: WclPerformanceRaidSegment[] = [
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        roles: [
          { role: "HEALER", specLabel: "Restoration", bestPct: 94.4, avgPct: 67 },
          { role: "RANGED_DPS", specLabel: "Balance", bestPct: 99, avgPct: 80 },
        ],
      },
    ];
    const result = resolveSignupTileWclBest({
      segments: dual,
      offeredSpecs: restoAndBalance,
      selected: true,
      assignedRole: "HEALER",
      assignedSpec: "Restoration",
    });
    expect(result.bestPct).toBe(94.4);
    expect(result.bestPct).not.toBe(99);
  });

  it("keeps medianPerformanceAverage separate from Best Perf. Avg", () => {
    expect(wclBestForSpec(lirasoraSegments, "HEALER", "Restoration")).toBe(94.4);
    expect(wclAvgForSpec(lirasoraSegments, "HEALER", "Restoration")).toBe(67);
    expect(wclAvgForSpec(lirasoraSegments, "HEALER", "Restoration")).not.toBe(94.4);
  });

  it("tooltip labels Best Perf. Avg / Median Perf. Avg per raid (not boss Best)", () => {
    const tooltip = formatWclSpecTooltip(lirasoraSegments, "HEALER", "Restoration");
    expect(tooltip).toContain("Tide");
    expect(tooltip).toContain("Best Perf. Avg: 100");
    expect(tooltip).toContain("Median Perf. Avg: 42");
    expect(tooltip).toContain("The Venomous Abyss");
    expect(tooltip).toContain("Best Perf. Avg: 94.4");
    expect(tooltip).toContain("Median Perf. Avg: 67");
    expect(tooltip).toContain("The Unbinding of Kith'ix");
    expect(tooltip).toContain("Best Perf. Avg: 93");
    expect(tooltip).toContain("Median Perf. Avg: 88");
    expect(tooltip).not.toMatch(/\nBest: /);
    expect(tooltip).not.toMatch(/\nAverage: /);
  });

  it("compact tile chip formats Best Perf. Avg without inventing placeholders", () => {
    expect(formatWclSpecChip(94.4)?.text).toBe("94");
    expect(formatWclSpecChip(100)?.text).toBe("100");
    expect(formatWclSpecChip(null)).toBeNull();
  });

  it("missing bestPerformanceAverage → quiet (no N/A placeholder)", () => {
    const empty: WclPerformanceRaidSegment[] = [
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        roles: [{ role: "HEALER", specLabel: "Restoration", bestPct: null, avgPct: null }],
      },
    ];
    expect(
      resolveSignupTileWclBest({
        segments: empty,
        offeredSpecs: restorationOnly,
        selected: true,
        assignedRole: "HEALER",
        assignedSpec: "Restoration",
      }).bestPct,
    ).toBeNull();
  });
});
