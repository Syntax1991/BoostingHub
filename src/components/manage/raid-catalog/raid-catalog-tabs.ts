/** Raid Catalog sections, represented in the URL (`?tab=`) so refresh, back/forward and deep links keep them. */
export const RAID_CATALOG_TABS = ["raids", "presets"] as const;

export type RaidCatalogTab = (typeof RAID_CATALOG_TABS)[number];

/** Missing, repeated or unknown `?tab=` values fall back to Raids. */
export function resolveRaidCatalogTab(value: string | string[] | undefined): RaidCatalogTab {
  return RAID_CATALOG_TABS.find((tab) => tab === value) ?? "raids";
}

export function raidCatalogTabHref(tab: RaidCatalogTab): string {
  return `/manage/raid-catalog?tab=${tab}`;
}
