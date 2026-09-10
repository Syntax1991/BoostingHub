/**
 * Production-safe WoW raid reference content.
 *
 * This is system catalog data, not a demo fixture. Dev seed may still create
 * users, characters, and example Runs around these stable identifiers.
 * Run creation must never hard-code demo Run IDs.
 *
 * `blizzardInstanceId` maps Character Raid Encounters `instance.id` (journal
 * instance). Boss rows may optionally list Blizzard encounter ids; when absent,
 * derivation falls back to normalized encounter names.
 */
export type WowRaidCatalogBoss = {
  id: string;
  name: string;
  sortOrder: number;
  /** Blizzard journal encounter id(s) when known. */
  blizzardEncounterIds?: readonly number[];
};

export type WowRaidCatalogEntry = {
  id: string;
  name: string;
  season: string;
  /** Blizzard journal instance id for Character Raids Encounters. */
  blizzardInstanceId: number;
  bosses: readonly WowRaidCatalogBoss[];
};

export const WOW_RAID_CATALOG: readonly WowRaidCatalogEntry[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Manaforge Omega",
    season: "The War Within Season 3",
    // Journal instance id used by Character Raids Encounters (`instance.id`).
    blizzardInstanceId: 1296,
    bosses: [
      { id: "ab000001-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Plexus Sentinel", sortOrder: 1 },
      { id: "ab000002-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Loom'ithar", sortOrder: 2 },
      { id: "ab000003-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Soulbinder Naazindhri", sortOrder: 3 },
      { id: "ab000004-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Forgeweaver Araz", sortOrder: 4 },
      { id: "ab000005-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "The Soul Hunters", sortOrder: 5 },
      { id: "ab000006-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Fractillus", sortOrder: 6 },
      { id: "ab000007-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Nexus-King Salhadaar", sortOrder: 7 },
      {
        id: "ab000008-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Dimensius",
        sortOrder: 8,
      },
    ],
  },
];

export function findRaidCatalogByBlizzardInstanceId(instanceId: number): WowRaidCatalogEntry | null {
  return WOW_RAID_CATALOG.find((raid) => raid.blizzardInstanceId === instanceId) ?? null;
}

export function findRaidCatalogByName(name: string): WowRaidCatalogEntry | null {
  const needle = normalizeRaidName(name);
  return WOW_RAID_CATALOG.find((raid) => normalizeRaidName(raid.name) === needle) ?? null;
}

export function normalizeRaidName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}