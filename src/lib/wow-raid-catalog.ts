/**
 * Production-safe WoW raid reference content.
 *
 * This is system catalog data, not a demo fixture. Dev seed may still create
 * users, characters, and example Runs around these stable identifiers.
 * Run creation must never hard-code demo Run IDs.
 */
export type WowRaidCatalogBoss = {
  id: string;
  name: string;
  sortOrder: number;
};

export type WowRaidCatalogEntry = {
  id: string;
  name: string;
  season: string;
  bosses: readonly WowRaidCatalogBoss[];
};

export const WOW_RAID_CATALOG: readonly WowRaidCatalogEntry[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Manaforge Omega",
    season: "The War Within Season 3",
    bosses: [
      { id: "ab000001-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Plexus Sentinel", sortOrder: 1 },
      { id: "ab000002-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Loom'ithar", sortOrder: 2 },
      { id: "ab000003-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Soulbinder Naazindhri", sortOrder: 3 },
      { id: "ab000004-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Forgeweaver Araz", sortOrder: 4 },
      { id: "ab000005-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "The Soul Hunters", sortOrder: 5 },
      { id: "ab000006-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Fractillus", sortOrder: 6 },
      { id: "ab000007-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Nexus-King Salhadaar", sortOrder: 7 },
      { id: "ab000008-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Dimensius", sortOrder: 8 },
    ],
  },
];
