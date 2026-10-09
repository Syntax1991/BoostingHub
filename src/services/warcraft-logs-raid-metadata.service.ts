import {
  warcraftLogsApiClient,
  type WarcraftLogsCatalogEncounter,
  type WarcraftLogsCatalogZone,
} from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import type { CatalogBoss, CatalogRaid } from "@/lib/raid-catalog";
import { normalizeRaidName } from "@/lib/wow-raid-catalog";

/**
 * Deterministic Warcraft Logs catalog metadata discovery for Content Catalog raids.
 * Uses the existing WCL GraphQL client (`worldData.zones`) — never scrapes HTML.
 *
 * Safety: only exact (normalized) matches; never guesses when zero or multiple
 * candidates exist. Callers persist results; WCL outages must not fail Raid writes.
 */

export type WclRaidMetadataResolution =
  | {
      status: "RESOLVED";
      wclZoneId: number;
      wclRankingEncounterId: number | null;
      /** Boss id → WCL encounter ids (and optional Blizzard journal ids) to fill when empty. */
      encounterMappings: ReadonlyArray<{
        bossId: string;
        wclEncounterIds: number[];
        blizzardEncounterIds: number[] | null;
      }>;
    }
  | { status: "UNRESOLVED"; reason: "NO_MATCH" | "AMBIGUOUS" | "NOT_CONFIGURED" | "UNAVAILABLE" };

/** Strip a leading English definite article after {@link normalizeRaidName}. */
export function catalogMatchKey(value: string): string {
  return normalizeRaidName(value).replace(/^the\s+/, "");
}

function exactZoneMatches(zones: readonly WarcraftLogsCatalogZone[], raidName: string): WarcraftLogsCatalogZone[] {
  const key = catalogMatchKey(raidName);
  return zones.filter((zone) => catalogMatchKey(zone.name) === key);
}

function exactEncounterMatches(
  zones: readonly WarcraftLogsCatalogZone[],
  name: string,
): Array<{ zone: WarcraftLogsCatalogZone; encounter: WarcraftLogsCatalogEncounter }> {
  const key = catalogMatchKey(name);
  const hits: Array<{ zone: WarcraftLogsCatalogZone; encounter: WarcraftLogsCatalogEncounter }> = [];
  for (const zone of zones) {
    for (const encounter of zone.encounters) {
      if (catalogMatchKey(encounter.name) === key) hits.push({ zone, encounter });
    }
  }
  return hits;
}

/**
 * Pure resolution against an already-fetched WCL zone catalog.
 * Exported for unit tests with mocked zone payloads.
 */
export function resolveWarcraftLogsRaidMetadata(
  raid: Pick<CatalogRaid, "name" | "bosses">,
  zones: readonly WarcraftLogsCatalogZone[],
): WclRaidMetadataResolution {
  const zoneHits = exactZoneMatches(zones, raid.name);

  let zone: WarcraftLogsCatalogZone | null = null;
  if (zoneHits.length === 1) {
    zone = zoneHits[0]!;
  } else if (zoneHits.length > 1) {
    return { status: "UNRESOLVED", reason: "AMBIGUOUS" };
  }

  // When the raid name does not match a zone (e.g. Tidebound under Venomous zone),
  // derive the zone only if every boss with a clear encounter match points at one zone.
  const bossHits: Array<{
    boss: CatalogBoss;
    zone: WarcraftLogsCatalogZone;
    encounter: WarcraftLogsCatalogEncounter;
  }> = [];
  let ambiguousBoss = false;
  for (const boss of raid.bosses) {
    const hits = exactEncounterMatches(zones, boss.name);
    if (hits.length === 0) continue;
    if (hits.length > 1) {
      ambiguousBoss = true;
      continue;
    }
    bossHits.push({ boss, zone: hits[0]!.zone, encounter: hits[0]!.encounter });
  }

  if (!zone) {
    const zonesFromBosses = [...new Set(bossHits.map((hit) => hit.zone.id))];
    if (ambiguousBoss || zonesFromBosses.length > 1) {
      return { status: "UNRESOLVED", reason: "AMBIGUOUS" };
    }
    if (zonesFromBosses.length === 1) {
      zone = bossHits[0]!.zone;
    }
  }

  if (!zone) {
    return { status: "UNRESOLVED", reason: "NO_MATCH" };
  }

  const encounterMappings: Array<{
    bossId: string;
    wclEncounterIds: number[];
    blizzardEncounterIds: number[] | null;
  }> = [];

  for (const boss of raid.bosses) {
    // Prefer matches inside the resolved zone; fall back to global exact match.
    const inZone = zone.encounters.filter((encounter) => catalogMatchKey(encounter.name) === catalogMatchKey(boss.name));
    const global = exactEncounterMatches(zones, boss.name);
    let encounter: WarcraftLogsCatalogEncounter | null = null;
    if (inZone.length === 1) {
      encounter = inZone[0]!;
    } else if (inZone.length === 0 && global.length === 1 && global[0]!.zone.id === zone.id) {
      encounter = global[0]!.encounter;
    } else if (inZone.length > 1 || global.length > 1) {
      // Leave this boss unresolved; do not guess.
      continue;
    }
    if (!encounter) continue;
    encounterMappings.push({
      bossId: boss.id,
      wclEncounterIds: [encounter.id],
      blizzardEncounterIds: encounter.journalId != null ? [encounter.journalId] : null,
    });
  }

  // Single-encounter raid inside a shared zone → ranking encounter is that fight.
  // Multi-boss raids leave ranking null (zone-wide rankings).
  const rankingEncounterId =
    raid.bosses.length === 1 && encounterMappings.length === 1
      ? (encounterMappings[0]!.wclEncounterIds[0] ?? null)
      : null;

  // Single-boss raid with no encounter rows yet: if the raid name matched the zone
  // and that zone has exactly one encounter, use it as the ranking scope.
  const rankingFromSingletonZone =
    rankingEncounterId == null && raid.bosses.length === 0 && zone.encounters.length === 1
      ? zone.encounters[0]!.id
      : rankingEncounterId;

  return {
    status: "RESOLVED",
    wclZoneId: zone.id,
    wclRankingEncounterId: rankingFromSingletonZone,
    encounterMappings,
  };
}

export type DiscoverRaidMetadataOptions = {
  /** When true, overwrite existing raid/boss WCL fields with a fresh resolution. */
  force?: boolean;
  /** Injected for tests. */
  fetchZones?: () => ReturnType<typeof warcraftLogsApiClient.fetchZones>;
};

export type DiscoverRaidMetadataResult = {
  resolution: WclRaidMetadataResolution;
  /** Raid-level fields to persist (nulls mean leave unresolved / clear only when force). */
  raidPatch: { wclZoneId: number | null; wclRankingEncounterId: number | null } | null;
  encounterPatches: ReadonlyArray<{
    bossId: string;
    wclEncounterIds: number[];
    blizzardEncounterIds: number[] | null;
  }>;
};

/**
 * Fetch WCL zones and resolve metadata for one catalog raid.
 * Does not write to the DB — the Content Catalog service applies patches.
 */
export async function discoverWarcraftLogsRaidMetadata(
  raid: CatalogRaid,
  options: DiscoverRaidMetadataOptions = {},
): Promise<DiscoverRaidMetadataResult> {
  const fetchZones = options.fetchZones ?? (() => warcraftLogsApiClient.fetchZones());
  const force = options.force === true;

  let zonesResult: Awaited<ReturnType<typeof warcraftLogsApiClient.fetchZones>>;
  try {
    zonesResult = await fetchZones();
  } catch (error) {
    console.error("[wcl-raid-metadata] zone fetch threw", { raidId: raid.id }, error);
    return {
      resolution: { status: "UNRESOLVED", reason: "UNAVAILABLE" },
      raidPatch: null,
      encounterPatches: [],
    };
  }

  if (zonesResult.status === "NOT_CONFIGURED") {
    return {
      resolution: { status: "UNRESOLVED", reason: "NOT_CONFIGURED" },
      raidPatch: null,
      encounterPatches: [],
    };
  }
  if (zonesResult.status === "TEMPORARY_FAILURE") {
    console.error("[wcl-raid-metadata] zone fetch failed", {
      raidId: raid.id,
      message: zonesResult.message,
    });
    return {
      resolution: { status: "UNRESOLVED", reason: "UNAVAILABLE" },
      raidPatch: null,
      encounterPatches: [],
    };
  }

  const resolution = resolveWarcraftLogsRaidMetadata(raid, zonesResult.zones);
  if (resolution.status !== "RESOLVED") {
    return { resolution, raidPatch: null, encounterPatches: [] };
  }

  const raidAlreadyMapped = raid.wclZoneId != null;
  const raidPatch =
    force || !raidAlreadyMapped
      ? {
          wclZoneId: resolution.wclZoneId,
          wclRankingEncounterId: resolution.wclRankingEncounterId,
        }
      : null;

  const encounterPatches = resolution.encounterMappings.filter((mapping) => {
    const boss = raid.bosses.find((row) => row.id === mapping.bossId);
    if (!boss) return false;
    if (force) return true;
    // Only fill empty WCL mappings; never erase seeded/manual ids on soft discovery.
    return boss.wclEncounterIds.length === 0;
  });

  return { resolution, raidPatch, encounterPatches };
}
