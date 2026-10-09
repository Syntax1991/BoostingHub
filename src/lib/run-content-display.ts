import {
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
  raidContentDisplayName,
} from "@/lib/wow-raid-catalog";

/**
 * Display projections of PERSISTED Run / Run Setup contents (labels, summary,
 * title + Discord channel coverage). Planning authority lives in the DB
 * Product catalog (`@/lib/product-selection`, `product-planning.service`);
 * nothing here decides what can be selected or created.
 */

export type ExpandedRunContent = {
  raidId: string;
  sortOrder: number;
  plannedBossCount: number;
};

export type RunContentDisplay = {
  productLabel: string;
  summary: string;
  shortSummary: string;
  /** Compact title coverage — planned/total summed over every content, e.g. `8/8`, `9/9`, `10/10`. */
  titleCoverage: string;
  /** Discord channel coverage token — e.g. `8of8`, `9of9`. */
  channelCoverage: string;
};

/**
 * Coverage tokens for title / Discord channel naming: planned and total boss
 * counts summed over every content (any number of contents, any order).
 */
export function projectRunContentCoverage(
  contents: ReadonlyArray<{
    raidId: string;
    sortOrder: number;
    plannedBossCount: number;
    totalBossCount: number;
  }>,
): { titleCoverage: string; channelCoverage: string } {
  const planned = contents.reduce((sum, row) => sum + row.plannedBossCount, 0);
  const total = contents.reduce((sum, row) => sum + row.totalBossCount, 0);
  return { titleCoverage: `${planned}/${total}`, channelCoverage: `${planned}of${total}` };
}

/**
 * PR4 legacy display label: the historical "Season 2 Bundle" wording for
 * exactly Tide 1 + Venomous, so labels of existing Runs (and their Discord
 * posts) do not change. Every other content set is labelled by its raid names.
 */
function legacyProductLabel(ordered: ReadonlyArray<{ raidId: string; raidName: string; plannedBossCount: number }>): string {
  if (ordered.length === 2) {
    const ids = new Set(ordered.map((row) => row.raidId));
    const tide = ordered.find((row) => row.raidId === TIDEBOUND_GROTTO_RAID_ID);
    if (ids.has(VENOMOUS_ABYSS_RAID_ID) && tide && tide.plannedBossCount === 1) return "Season 2 Bundle";
  }
  return ordered.map((row) => row.raidName).join(" · ") || "Unknown content";
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
  const coverage = projectRunContentCoverage(ordered);
  const summary = ordered
    .map((row) => `${raidContentDisplayName(row.raidId, row.raidName)} ${row.plannedBossCount}/${row.totalBossCount}`)
    .join(" · ");

  return {
    productLabel: legacyProductLabel(ordered),
    summary,
    shortSummary: summary,
    titleCoverage: coverage.titleCoverage,
    channelCoverage: coverage.channelCoverage,
  };
}
