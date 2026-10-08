/**
 * Bootstrap fixture for WoW raid reference content.
 *
 * The DATABASE (Raid / RaidBoss) is the runtime authority — read it through
 * `raidRepository.loadCatalog()`. This fixture only seeds missing rows
 * (`raidRepository.ensureReferenceRaids`, insert-only) and is the parity
 * reference in tests. Never read it for lockout, WCL or boss data at runtime.
 *
 * Stable BoostingHub UUIDs are historical identity — never overwrite an old raid
 * id when seasons change. Blizzard journal instance/encounter ids are the
 * external identity for lockout mapping (not localized display names).
 */
export type WowRaidCatalogBoss = {
  id: string;
  name: string;
  sortOrder: number;
  /** Blizzard journal encounter id(s). Preferred lockout match key. */
  blizzardEncounterIds: readonly number[];
  /**
   * Warcraft Logs encounter id(s) (`ReportFight.encounterID`). Verified via WCL
   * `worldData.zone(id).encounters` (zone 44 Manaforge Omega, zone 53 Venomous
   * Abyss). Attaches logged fights to the Run content they belong to.
   */
  warcraftLogsEncounterIds?: readonly number[];
};

export type WowRaidCatalogEntry = {
  id: string;
  name: string;
  season: string;
  /** Blizzard journal instance id (`instance.id` on Character Raid Encounters). */
  blizzardInstanceId: number;
  /**
   * Warcraft Logs zone id for roster Best/Avg percentiles.
   * Midnight S2: Venomous Abyss and Nymrissa share WCL zone 53; Nymrissa is
   * encounter-scoped via `warcraftLogsEncounterId`.
   */
  warcraftLogsZoneId?: number;
  /** When set, rankings are scoped to this WCL encounter within `warcraftLogsZoneId`. */
  warcraftLogsEncounterId?: number;
  /** Deterministic catalog order (seeded into `Raid.sortOrder`). */
  sortOrder: number;
  /** Explicit: Blizzard lockout refresh derives this raid (seeded into `Raid.trackLockouts`). */
  trackLockouts: boolean;
  /** Seeded into `Raid.isActive` (standalone Create Run product) for a missing Raid row. */
  availableForRuns: boolean;
  bosses: readonly WowRaidCatalogBoss[];
};

/** Historical TWW S3 raid — keep UUID stable for existing Runs. */
export const MANAFORGE_OMEGA_RAID_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Midnight Season 2 main raid — current BoostingHub lockout target. */
export const VENOMOUS_ABYSS_RAID_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * Midnight Season 2 lair (The Tidebound Grotto / Nymrissa Wavecaller).
 * Separate Blizzard instance from The Venomous Abyss — never merge lockouts.
 * Verified via Battle.net `GET /data/wow/journal-instance/1317` (EU static).
 */
export const TIDEBOUND_GROTTO_RAID_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export const NYMRISSA_WAVECALLER_BOSS_ID = "cc000001-cccc-4ccc-8ccc-cccccccccccc";

/** WCL zone id for Midnight Season 2 Venomous Abyss rankings (includes bundled Nymrissa). */
export const VENOMOUS_ABYSS_WARCRAFT_LOGS_ZONE_ID = 53;
/** WCL encounter id for Nymrissa Wavecaller within zone 53. */
export const NYMRISSA_WARCRAFT_LOGS_ENCOUNTER_ID = 3379;

export const WOW_RAID_CATALOG: readonly WowRaidCatalogEntry[] = [
  {
    id: MANAFORGE_OMEGA_RAID_ID,
    name: "Manaforge Omega",
    season: "The War Within Season 3",
    // Live Character Raid Encounters instance.id (was incorrectly 1296 = Liberation of Undermine).
    blizzardInstanceId: 1302,
    sortOrder: 1,
    trackLockouts: false,
    // Historical: superseded by The Venomous Abyss. Kept in the catalog (and
    // its Raid/RaidBoss rows kept in the database) forever so existing Runs,
    // lockout history, and Discord/embed data keep resolving this raid's
    // name — only NEW Run creation/selection is blocked, via availableForRuns.
    availableForRuns: false,
    bosses: [
      {
        id: "ab000001-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Plexus Sentinel",
        sortOrder: 1,
        blizzardEncounterIds: [2684],
        warcraftLogsEncounterIds: [3129],
      },
      {
        id: "ab000002-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Loom'ithar",
        sortOrder: 2,
        blizzardEncounterIds: [2686],
        warcraftLogsEncounterIds: [3131],
      },
      {
        id: "ab000003-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Soulbinder Naazindhri",
        sortOrder: 3,
        blizzardEncounterIds: [2685],
        warcraftLogsEncounterIds: [3130],
      },
      {
        id: "ab000004-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Forgeweaver Araz",
        sortOrder: 4,
        blizzardEncounterIds: [2687],
        warcraftLogsEncounterIds: [3132],
      },
      {
        id: "ab000005-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "The Soul Hunters",
        sortOrder: 5,
        blizzardEncounterIds: [2688],
        warcraftLogsEncounterIds: [3122],
      },
      {
        id: "ab000006-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Fractillus",
        sortOrder: 6,
        blizzardEncounterIds: [2747],
        warcraftLogsEncounterIds: [3133],
      },
      {
        id: "ab000007-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Nexus-King Salhadaar",
        sortOrder: 7,
        blizzardEncounterIds: [2690],
        warcraftLogsEncounterIds: [3134],
      },
      {
        id: "ab000008-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Dimensius, the All-Devouring",
        sortOrder: 8,
        blizzardEncounterIds: [2691],
        warcraftLogsEncounterIds: [3135],
      },
    ],
  },
  {
    id: VENOMOUS_ABYSS_RAID_ID,
    name: "The Venomous Abyss",
    season: "Midnight Season 2",
    // Live EU Character Raid Encounters instance.id (de_DE: Der Giftige Abgrund).
    blizzardInstanceId: 1320,
    warcraftLogsZoneId: VENOMOUS_ABYSS_WARCRAFT_LOGS_ZONE_ID,
    sortOrder: 2,
    trackLockouts: true,
    availableForRuns: true,
    bosses: [
      {
        id: "bb000001-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Nek'zali the Soulcoiler",
        sortOrder: 1,
        blizzardEncounterIds: [2888],
        warcraftLogsEncounterIds: [3470],
      },
      {
        id: "bb000002-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Entombed Sentinels",
        sortOrder: 2,
        blizzardEncounterIds: [2874],
        warcraftLogsEncounterIds: [3445],
      },
      {
        id: "bb000003-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "The Lost Explorers",
        sortOrder: 3,
        blizzardEncounterIds: [2894],
        warcraftLogsEncounterIds: [3497],
      },
      {
        id: "bb000004-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Vashnik the Malignant",
        sortOrder: 4,
        blizzardEncounterIds: [2882],
        warcraftLogsEncounterIds: [3455],
      },
      {
        id: "bb000005-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Sszorak",
        sortOrder: 5,
        blizzardEncounterIds: [2871],
        warcraftLogsEncounterIds: [3420],
      },
      {
        id: "bb000006-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "The Twin Fangs",
        sortOrder: 6,
        blizzardEncounterIds: [2887],
        warcraftLogsEncounterIds: [3421],
      },
      {
        id: "bb000007-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "The Coiled Altar",
        sortOrder: 7,
        blizzardEncounterIds: [2883],
        warcraftLogsEncounterIds: [3429],
      },
      {
        id: "bb000008-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Ula'tek",
        sortOrder: 8,
        blizzardEncounterIds: [2895],
        warcraftLogsEncounterIds: [3492],
      },
    ],
  },
  {
    id: TIDEBOUND_GROTTO_RAID_ID,
    name: "The Tidebound Grotto",
    season: "Midnight Season 2",
    // Verified Battle.net journal-instance id (en_US: The Tidebound Grotto).
    blizzardInstanceId: 1317,
    // Nymrissa is bundled under Venomous Abyss on WCL — encounter-scoped rankings.
    warcraftLogsZoneId: VENOMOUS_ABYSS_WARCRAFT_LOGS_ZONE_ID,
    warcraftLogsEncounterId: NYMRISSA_WARCRAFT_LOGS_ENCOUNTER_ID,
    sortOrder: 3,
    trackLockouts: true,
    // Real raid identity for Bundle RunRaidContent — not a standalone Create product.
    availableForRuns: false,
    bosses: [
      {
        id: NYMRISSA_WAVECALLER_BOSS_ID,
        name: "Nymrissa Wavecaller",
        sortOrder: 1,
        // Verified Battle.net journal encounter id on instance 1317.
        blizzardEncounterIds: [2849],
        warcraftLogsEncounterIds: [3379],
      },
    ],
  },
];

/** Short product-facing raid label (Tidebound → Tide). */
export function raidContentDisplayName(raidId: string, raidName: string): string {
  if (raidId === TIDEBOUND_GROTTO_RAID_ID) return "Tide";
  return raidName;
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
