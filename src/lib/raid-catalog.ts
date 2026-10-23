import { WOW_RAID_CATALOG, type WowRaidCatalogEntry } from "@/lib/wow-raid-catalog";

/**
 * Raid content catalog as read from the database (Raid + RaidBoss rows).
 *
 * The database is the runtime authority for raids, bosses, Blizzard / WCL ids
 * and lockout tracking. `WOW_RAID_CATALOG` is only the bootstrap fixture that
 * seeds missing rows (and the parity reference in tests).
 *
 * Blizzard encounter ids and WCL encounter ids are separate external
 * identities and are never mixed.
 */
export type CatalogBoss = {
  /** Stable RaidBoss UUID — the identity stored in `CharacterRaidLockout.killedBossIds`. */
  id: string;
  raidId: string;
  name: string;
  sortOrder: number;
  blizzardEncounterIds: readonly number[];
  wclEncounterIds: readonly number[];
};

export type CatalogRaid = {
  id: string;
  name: string;
  season: string;
  /** Legacy `Raid.isActive`: standalone Create Run product availability. */
  availableForRuns: boolean;
  sortOrder: number;
  /** Blizzard lockout refresh derives this raid. */
  trackLockouts: boolean;
  blizzardInstanceId: number | null;
  wclZoneId: number | null;
  wclRankingEncounterId: number | null;
  /** Ordered by `sortOrder`. */
  bosses: readonly CatalogBoss[];
};

export type RaidCatalog = {
  /** Every raid (historical included), ordered by `sortOrder`, then name. */
  raids: readonly CatalogRaid[];
  /** Raids whose Blizzard lockouts are tracked, in catalog order. */
  lockoutRaids: readonly CatalogRaid[];
  findById(raidId: string): CatalogRaid | null;
  /** Boss count of an explicit raid id (0 when unknown). */
  bossTotal(raidId: string): number;
  /** WCL `ReportFight.encounterID` → owning raid id. */
  raidIdByWclEncounterId: ReadonlyMap<number, string>;
};

/**
 * WCL encounter to rank a raid by. The stored `wclRankingEncounterId` wins;
 * otherwise a raid with exactly one boss and exactly one WCL encounter id is
 * ranked by that fight — the same rule discovery applies, but also when the
 * boss was added / mapped after the raid's zone was resolved (e.g. a lair
 * like The Unbinding of Kith'ix inside a shared zone). Null → zone-wide.
 */
export function effectiveWclRankingEncounterId(
  raid: Pick<CatalogRaid, "wclZoneId" | "wclRankingEncounterId" | "bosses">,
): number | null {
  if (raid.wclRankingEncounterId != null) return raid.wclRankingEncounterId;
  if (raid.wclZoneId == null) return null;
  const [onlyBoss, ...others] = raid.bosses;
  if (!onlyBoss || others.length > 0 || onlyBoss.wclEncounterIds.length !== 1) return null;
  return onlyBoss.wclEncounterIds[0] ?? null;
}

/** Parse a stored JSON number array (`RaidBoss.blizzardEncounterIds` / `wclEncounterIds`). */
export function parseEncounterIds(value: unknown): number[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is number => typeof item === "number" && Number.isInteger(item),
    );
  } catch {
    return [];
  }
}

export function serializeEncounterIds(values: readonly number[]): string {
  return JSON.stringify([...values]);
}

function compareRaids(a: CatalogRaid, b: CatalogRaid): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

export function buildRaidCatalog(raids: readonly CatalogRaid[]): RaidCatalog {
  const ordered = [...raids]
    .map((raid) => ({
      ...raid,
      bosses: [...raid.bosses].sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .sort(compareRaids);
  const byId = new Map(ordered.map((raid) => [raid.id, raid]));
  const raidIdByWclEncounterId = new Map<number, string>();
  for (const raid of ordered) {
    for (const boss of raid.bosses) {
      for (const encounterId of boss.wclEncounterIds) {
        if (!raidIdByWclEncounterId.has(encounterId))
          raidIdByWclEncounterId.set(encounterId, raid.id);
      }
    }
  }
  return {
    raids: ordered,
    lockoutRaids: ordered.filter((raid) => raid.trackLockouts),
    findById: (raidId) => byId.get(raidId) ?? null,
    bossTotal: (raidId) => byId.get(raidId)?.bosses.length ?? 0,
    raidIdByWclEncounterId,
  };
}

/** Bootstrap-fixture entry → catalog raid shape (catalog order is the sortOrder). */
export function catalogRaidFromFixture(entry: WowRaidCatalogEntry): CatalogRaid {
  return {
    id: entry.id,
    name: entry.name,
    season: entry.season,
    availableForRuns: entry.availableForRuns,
    sortOrder: entry.sortOrder,
    trackLockouts: entry.trackLockouts,
    blizzardInstanceId: entry.blizzardInstanceId,
    wclZoneId: entry.warcraftLogsZoneId ?? null,
    wclRankingEncounterId: entry.warcraftLogsEncounterId ?? null,
    bosses: entry.bosses.map((boss) => ({
      id: boss.id,
      raidId: entry.id,
      name: boss.name,
      sortOrder: boss.sortOrder,
      blizzardEncounterIds: [...boss.blizzardEncounterIds],
      wclEncounterIds: [...(boss.warcraftLogsEncounterIds ?? [])],
    })),
  };
}

/**
 * Catalog built from the bootstrap fixture. For tests of pure helpers and for
 * parity checks only — runtime readers load the catalog from the database.
 */
export function fixtureRaidCatalog(): RaidCatalog {
  return buildRaidCatalog(WOW_RAID_CATALOG.map(catalogRaidFromFixture));
}

/** Admin-facing integration status of one catalog raid (derived — nothing stored). */
export type RaidIntegrationStatus = {
  /** Linked to a Blizzard journal instance. */
  blizzardLinked: boolean;
  bossTotal: number;
  /** Bosses with a Blizzard journal encounter id. */
  bossesMapped: number;
  /** READY: tracked + linked + every boss mapped. */
  lockouts: "READY" | "INCOMPLETE" | "NOT_TRACKED";
  /** MAPPED: WCL zone + every boss has a WCL encounter id. */
  warcraftLogs: "MAPPED" | "NEEDS_MAPPING";
};

export function raidIntegrationStatus(
  raid: Pick<CatalogRaid, "blizzardInstanceId" | "trackLockouts" | "wclZoneId" | "bosses">,
): RaidIntegrationStatus {
  const bossTotal = raid.bosses.length;
  const bossesMapped = raid.bosses.filter((boss) => boss.blizzardEncounterIds.length > 0).length;
  const blizzardLinked = raid.blizzardInstanceId != null;
  const allMapped = bossTotal > 0 && bossesMapped === bossTotal;
  return {
    blizzardLinked,
    bossTotal,
    bossesMapped,
    lockouts: !raid.trackLockouts
      ? "NOT_TRACKED"
      : blizzardLinked && allMapped
        ? "READY"
        : "INCOMPLETE",
    warcraftLogs:
      raid.wclZoneId != null &&
      bossTotal > 0 &&
      raid.bosses.every((boss) => boss.wclEncounterIds.length > 0)
        ? "MAPPED"
        : "NEEDS_MAPPING",
  };
}
