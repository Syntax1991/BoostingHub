/**
 * Production-safe WoW raid reference content.
 *
 * Stable BoostingHub UUIDs are historical identity — never overwrite an old raid
 * id when seasons change. Blizzard journal instance/encounter ids are the
 * external identity for lockout mapping (not localized display names).
 *
 * `currentForLockouts` is the explicit lockout-refresh target. Do not infer it
 * from array order, boss count, or newest DB row.
 */
export type WowRaidCatalogBoss = {
  id: string;
  name: string;
  sortOrder: number;
  /** Blizzard journal encounter id(s). Preferred lockout match key. */
  blizzardEncounterIds: readonly number[];
};

export type WowRaidCatalogEntry = {
  id: string;
  name: string;
  season: string;
  /** Blizzard journal instance id (`instance.id` on Character Raid Encounters). */
  blizzardInstanceId: number;
  /** Explicit: Blizzard lockout refresh derives this raid. */
  currentForLockouts: boolean;
  /** When true, `ensureReferenceRaids` marks the Raid active for Run creation. */
  availableForRuns: boolean;
  bosses: readonly WowRaidCatalogBoss[];
};

/** Historical TWW S3 raid — keep UUID stable for existing Runs. */
export const MANAFORGE_OMEGA_RAID_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Midnight Season 2 main raid — current BoostingHub lockout target. */
export const VENOMOUS_ABYSS_RAID_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export const WOW_RAID_CATALOG: readonly WowRaidCatalogEntry[] = [
  {
    id: MANAFORGE_OMEGA_RAID_ID,
    name: "Manaforge Omega",
    season: "The War Within Season 3",
    // Live Character Raid Encounters instance.id (was incorrectly 1296 = Liberation of Undermine).
    blizzardInstanceId: 1302,
    currentForLockouts: false,
    availableForRuns: true,
    bosses: [
      {
        id: "ab000001-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Plexus Sentinel",
        sortOrder: 1,
        blizzardEncounterIds: [2684],
      },
      {
        id: "ab000002-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Loom'ithar",
        sortOrder: 2,
        blizzardEncounterIds: [2686],
      },
      {
        id: "ab000003-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Soulbinder Naazindhri",
        sortOrder: 3,
        blizzardEncounterIds: [2685],
      },
      {
        id: "ab000004-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Forgeweaver Araz",
        sortOrder: 4,
        blizzardEncounterIds: [2687],
      },
      {
        id: "ab000005-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "The Soul Hunters",
        sortOrder: 5,
        blizzardEncounterIds: [2688],
      },
      {
        id: "ab000006-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Fractillus",
        sortOrder: 6,
        blizzardEncounterIds: [2747],
      },
      {
        id: "ab000007-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Nexus-King Salhadaar",
        sortOrder: 7,
        blizzardEncounterIds: [2690],
      },
      {
        id: "ab000008-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Dimensius, the All-Devouring",
        sortOrder: 8,
        blizzardEncounterIds: [2691],
      },
    ],
  },
  {
    id: VENOMOUS_ABYSS_RAID_ID,
    name: "The Venomous Abyss",
    season: "Midnight Season 2",
    // Live EU Character Raid Encounters instance.id (de_DE: Der Giftige Abgrund).
    blizzardInstanceId: 1320,
    currentForLockouts: true,
    availableForRuns: true,
    bosses: [
      {
        id: "bb000001-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Nek'zali the Soulcoiler",
        sortOrder: 1,
        blizzardEncounterIds: [2888],
      },
      {
        id: "bb000002-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Entombed Sentinels",
        sortOrder: 2,
        blizzardEncounterIds: [2874],
      },
      {
        id: "bb000003-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "The Lost Explorers",
        sortOrder: 3,
        blizzardEncounterIds: [2894],
      },
      {
        id: "bb000004-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Vashnik the Malignant",
        sortOrder: 4,
        blizzardEncounterIds: [2882],
      },
      {
        id: "bb000005-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Sszorak",
        sortOrder: 5,
        blizzardEncounterIds: [2871],
      },
      {
        id: "bb000006-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "The Twin Fangs",
        sortOrder: 6,
        blizzardEncounterIds: [2887],
      },
      {
        id: "bb000007-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "The Coiled Altar",
        sortOrder: 7,
        blizzardEncounterIds: [2883],
      },
      {
        id: "bb000008-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Ula'tek",
        sortOrder: 8,
        blizzardEncounterIds: [2895],
      },
    ],
  },
];

export function getCurrentLockoutRaids(): readonly WowRaidCatalogEntry[] {
  return WOW_RAID_CATALOG.filter((raid) => raid.currentForLockouts);
}

export function getCurrentLockoutRaid(): WowRaidCatalogEntry | null {
  return getCurrentLockoutRaids()[0] ?? null;
}

export function findRaidCatalogById(id: string): WowRaidCatalogEntry | null {
  return WOW_RAID_CATALOG.find((raid) => raid.id === id) ?? null;
}

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
