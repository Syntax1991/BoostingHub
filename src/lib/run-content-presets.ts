import {
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
  findRaidCatalogById,
  raidContentDisplayName,
} from "@/lib/wow-raid-catalog";

/**
 * Commercial Create products — not raw Raid rows.
 * Presets expand into RunRaidContent definitions; persisted contents remain
 * authoritative for existing Runs (never regenerate history from presets).
 */
export const RUN_CONTENT_PRESET_KEYS = ["VENOMOUS_ABYSS", "MIDNIGHT_S2_BUNDLE"] as const;
export type RunContentPresetKey = (typeof RUN_CONTENT_PRESET_KEYS)[number];

export type ExpandedRunContent = {
  raidId: string;
  sortOrder: number;
  plannedBossCount: number;
};

export type RunContentDisplay = {
  productKey: RunContentPresetKey | null;
  productLabel: string;
  summary: string;
  shortSummary: string;
  /** Compact title coverage — e.g. `8/8` or Bundle `9/9` (summed planned/total). */
  titleCoverage: string;
  /** Discord channel coverage token — e.g. `8of8` or Bundle `9of9`. */
  channelCoverage: string;
};

export type ContentIdentitySlice = {
  raidId: string;
  sortOrder: number;
  plannedBossCount: number;
};

const VENOMOUS_MIN = 1;
const VENOMOUS_MAX = 8;

export function listCreateRunContentPresets(): Array<{
  key: RunContentPresetKey;
  displayName: string;
}> {
  return [
    { key: "VENOMOUS_ABYSS", displayName: "The Venomous Abyss" },
    {
      key: "MIDNIGHT_S2_BUNDLE",
      displayName: "Season 2 Bundle — Tide + The Venomous Abyss",
    },
  ];
}

export function assertValidVenomousPlannedBossCount(value: number): number {
  if (!Number.isInteger(value) || value < VENOMOUS_MIN || value > VENOMOUS_MAX) {
    throw new Error(`Venomous planned boss count must be an integer from ${VENOMOUS_MIN} to ${VENOMOUS_MAX}.`);
  }
  return value;
}

/**
 * Expand a commercial preset into ordered RunRaidContent write specs.
 * Tidebound planned count is always 1 for the Bundle product.
 */
export function expandRunContentPreset(input: {
  preset: RunContentPresetKey;
  venomousPlannedBossCount: number;
}): ExpandedRunContent[] {
  const venomousPlannedBossCount = assertValidVenomousPlannedBossCount(input.venomousPlannedBossCount);

  if (input.preset === "VENOMOUS_ABYSS") {
    return [
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        sortOrder: 1,
        plannedBossCount: venomousPlannedBossCount,
      },
    ];
  }

  return [
    {
      raidId: TIDEBOUND_GROTTO_RAID_ID,
      sortOrder: 1,
      plannedBossCount: 1,
    },
    {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      sortOrder: 2,
      plannedBossCount: venomousPlannedBossCount,
    },
  ];
}

/**
 * Coverage tokens for title / Discord channel naming from authoritative contents.
 * Bundle sums Tide + Venomous (e.g. full Bundle → `9/9` / `9of9`); the
 * ordered content summary still lists each raid separately.
 */
export function projectRunContentCoverage(
  contents: ReadonlyArray<{
    raidId: string;
    sortOrder: number;
    plannedBossCount: number;
    totalBossCount: number;
  }>,
): { titleCoverage: string; channelCoverage: string; productKey: RunContentPresetKey | "CUSTOM" } {
  const ordered = [...contents].sort((a, b) => a.sortOrder - b.sortOrder);
  const productKey = classifyRunContents(ordered);

  if (productKey === "MIDNIGHT_S2_BUNDLE") {
    const planned = ordered.reduce((sum, row) => sum + row.plannedBossCount, 0);
    const total = ordered.reduce((sum, row) => sum + row.totalBossCount, 0);
    return {
      productKey,
      titleCoverage: `${planned}/${total}`,
      channelCoverage: `${planned}of${total}`,
    };
  }

  const primary = ordered[0];
  if (!primary) {
    return { productKey: "CUSTOM", titleCoverage: "0/0", channelCoverage: "0of0" };
  }

  return {
    productKey,
    titleCoverage: `${primary.plannedBossCount}/${primary.totalBossCount}`,
    channelCoverage: `${primary.plannedBossCount}of${primary.totalBossCount}`,
  };
}

/**
 * Classify persisted contents by raid identity (not length alone).
 * Display still honors persisted sortOrder via projectRunContentDisplay.
 */
export function classifyRunContents(
  contents: readonly ContentIdentitySlice[],
): RunContentPresetKey | "CUSTOM" {
  const ordered = [...contents].sort((a, b) => a.sortOrder - b.sortOrder);
  if (ordered.length === 0) return "CUSTOM";

  if (
    ordered.length === 1 &&
    ordered[0]!.raidId === VENOMOUS_ABYSS_RAID_ID
  ) {
    return "VENOMOUS_ABYSS";
  }

  if (ordered.length === 2) {
    const ids = new Set(ordered.map((row) => row.raidId));
    if (ids.has(TIDEBOUND_GROTTO_RAID_ID) && ids.has(VENOMOUS_ABYSS_RAID_ID) && ids.size === 2) {
      const tidebound = ordered.find((row) => row.raidId === TIDEBOUND_GROTTO_RAID_ID)!;
      if (tidebound.plannedBossCount === 1) {
        return "MIDNIGHT_S2_BUNDLE";
      }
    }
  }

  return "CUSTOM";
}

function bossSegment(name: string, planned: number, total: number): string {
  return `${name} ${planned}/${total}`;
}

function contentDisplayName(raidId: string, raidName: string): string {
  return raidContentDisplayName(raidId, raidName);
}

export function projectRunContentDisplay(
  contents: ReadonlyArray<{
    raidId: string;
    raidName: string;
    sortOrder: number;
    plannedBossCount: number;
    totalBossCount: number;
  }>,
): RunContentDisplay {
  const ordered = [...contents].sort((a, b) => a.sortOrder - b.sortOrder);
  const productKey = classifyRunContents(ordered);
  const key = productKey === "CUSTOM" ? null : productKey;
  const coverage = projectRunContentCoverage(ordered);

  const productLabel =
    key === "MIDNIGHT_S2_BUNDLE"
      ? "Season 2 Bundle"
      : key === "VENOMOUS_ABYSS"
        ? "The Venomous Abyss"
        : ordered.map((row) => row.raidName).join(" · ") || "Unknown content";

  const summary = ordered
    .map((row) =>
      bossSegment(contentDisplayName(row.raidId, row.raidName), row.plannedBossCount, row.totalBossCount),
    )
    .join(" · ");

  return {
    productKey: key,
    productLabel,
    summary,
    shortSummary: summary,
    titleCoverage: coverage.titleCoverage,
    channelCoverage: coverage.channelCoverage,
  };
}

export function venomousBossMaxFromCatalog(): number {
  return findRaidCatalogById(VENOMOUS_ABYSS_RAID_ID)?.bosses.length ?? VENOMOUS_MAX;
}

/** Title coverage for Create/Edit previews — matches server `projectRunContentDisplay` tokens. */
export function titleCoverageFromPreset(input: {
  preset: RunContentPresetKey;
  venomousPlannedBossCount: number;
  venomousTotalBossCount?: number;
}): string {
  const venomousTotal = input.venomousTotalBossCount ?? venomousBossMaxFromCatalog();
  const tideboundTotal = findRaidCatalogById(TIDEBOUND_GROTTO_RAID_ID)?.bosses.length ?? 1;
  const expanded = expandRunContentPreset(input);
  const rows = expanded.map((row) => ({
    ...row,
    totalBossCount:
      row.raidId === VENOMOUS_ABYSS_RAID_ID
        ? venomousTotal
        : row.raidId === TIDEBOUND_GROTTO_RAID_ID
          ? tideboundTotal
          : venomousTotal,
  }));
  return projectRunContentCoverage(rows).titleCoverage;
}
