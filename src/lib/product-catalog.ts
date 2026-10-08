import { TIDEBOUND_GROTTO_RAID_ID, VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";

/**
 * Sellable BoostingHub products (Product + ProductRaidContent).
 *
 * The DATABASE is the authority — read it through `productRepository`.
 * `PRODUCT_CATALOG_FIXTURE` only seeds missing rows (insert-only bootstrap)
 * and is the parity reference in tests. Run Setup / Create Run forms still use
 * `run-content-presets` in this phase.
 */
export type ProductBossCountMode = "FIXED" | "VARIABLE";

export type ProductRaidContentDefinition = {
  id: string;
  raidId: string;
  /** 1-based order within the product. */
  sortOrder: number;
  bossCountMode: ProductBossCountMode;
  /** FIXED: exact planned boss count. */
  fixedBossCount: number | null;
  /** VARIABLE: lowest selectable boss count. */
  minBossCount: number | null;
  /** VARIABLE: preselected boss count. */
  defaultBossCount: number | null;
};

export type ProductDefinition = {
  id: string;
  key: string;
  name: string;
  active: boolean;
  selectable: boolean;
  sortOrder: number;
  /** Ordered by `sortOrder`. */
  contents: readonly ProductRaidContentDefinition[];
};

export const VENOMOUS_ABYSS_PRODUCT_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
export const MIDNIGHT_S2_BUNDLE_PRODUCT_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";

export const PRODUCT_CATALOG_FIXTURE: readonly ProductDefinition[] = [
  {
    id: VENOMOUS_ABYSS_PRODUCT_ID,
    key: "VENOMOUS_ABYSS",
    name: "The Venomous Abyss",
    active: true,
    selectable: true,
    sortOrder: 1,
    contents: [
      {
        id: "dd000001-dddd-4ddd-8ddd-dddddddddddd",
        raidId: VENOMOUS_ABYSS_RAID_ID,
        sortOrder: 1,
        bossCountMode: "VARIABLE",
        fixedBossCount: null,
        minBossCount: 1,
        defaultBossCount: 8,
      },
    ],
  },
  {
    id: MIDNIGHT_S2_BUNDLE_PRODUCT_ID,
    key: "MIDNIGHT_S2_BUNDLE",
    name: "Season 2 Bundle — Tide + The Venomous Abyss",
    active: true,
    selectable: true,
    sortOrder: 2,
    contents: [
      {
        id: "dd000002-dddd-4ddd-8ddd-dddddddddddd",
        raidId: TIDEBOUND_GROTTO_RAID_ID,
        sortOrder: 1,
        bossCountMode: "FIXED",
        fixedBossCount: 1,
        minBossCount: null,
        defaultBossCount: null,
      },
      {
        id: "dd000003-dddd-4ddd-8ddd-dddddddddddd",
        raidId: VENOMOUS_ABYSS_RAID_ID,
        sortOrder: 2,
        bossCountMode: "VARIABLE",
        fixedBossCount: null,
        minBossCount: 1,
        defaultBossCount: 8,
      },
    ],
  },
];
