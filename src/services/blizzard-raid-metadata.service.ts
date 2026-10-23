import { blizzardApiClient } from "@/integrations/blizzard/blizzard-api-client";
import { isBlizzardConfigured } from "@/lib/blizzard/config";
import type { BlizzardJournalInstance, BlizzardJournalInstanceRef } from "@/lib/blizzard/types";
import type { CatalogBoss, CatalogRaid } from "@/lib/raid-catalog";
import { catalogMatchKey } from "@/services/warcraft-logs-raid-metadata.service";

/**
 * Blizzard id discovery for Raid Catalog raids, from the Adventure Journal
 * (Game Data API). Lockouts are derived from the character encounters API,
 * which keys raids by journal instance id and bosses by journal encounter id —
 * so these ids must come from Blizzard itself, never from Warcraft Logs'
 * `journalID` (it differed for The Unbinding of Kith'ix: 3271 vs Blizzard 2896).
 *
 * Safety: only exact (normalized) name matches, RAID instances only; never
 * guesses when zero or several candidates exist. Callers persist results;
 * Battle.net outages must not fail Raid writes.
 */

export type BlizzardRaidMetadataResolution =
  | {
      status: "RESOLVED";
      blizzardInstanceId: number;
      /** Boss id → its journal encounter id. Bosses without a clear match are left out. */
      encounterMappings: ReadonlyArray<{ bossId: string; blizzardEncounterIds: number[] }>;
    }
  | { status: "UNRESOLVED"; reason: "NO_MATCH" | "AMBIGUOUS" | "NOT_RAID" | "NOT_CONFIGURED" | "UNAVAILABLE" };

/** The journal instance whose name matches the raid exactly; null when none or several do. */
export function resolveJournalInstanceId(
  raidName: string,
  instances: readonly BlizzardJournalInstanceRef[],
): { id: number } | { unresolved: "NO_MATCH" | "AMBIGUOUS" } {
  const key = catalogMatchKey(raidName);
  const hits = instances.filter((instance) => catalogMatchKey(instance.name) === key);
  if (hits.length === 1) return { id: hits[0]!.id };
  return { unresolved: hits.length === 0 ? "NO_MATCH" : "AMBIGUOUS" };
}

/**
 * Journal encounter per catalog boss: exact unique name match; a raid with one
 * boss and an instance with one encounter map to each other even when the
 * names differ (single-boss raids are often named after the event, e.g.
 * "The Unbinding of Kith'ix" → encounter "Kith'ix").
 */
export function resolveJournalEncounters(
  bosses: readonly Pick<CatalogBoss, "id" | "name">[],
  instance: Pick<BlizzardJournalInstance, "encounters">,
): Array<{ bossId: string; blizzardEncounterIds: number[] }> {
  if (bosses.length === 1 && instance.encounters.length === 1) {
    return [{ bossId: bosses[0]!.id, blizzardEncounterIds: [instance.encounters[0]!.id] }];
  }
  return bosses.flatMap((boss) => {
    const hits = instance.encounters.filter((encounter) => catalogMatchKey(encounter.name) === catalogMatchKey(boss.name));
    return hits.length === 1 ? [{ bossId: boss.id, blizzardEncounterIds: [hits[0]!.id] }] : [];
  });
}

export type DiscoverBlizzardRaidMetadataOptions = {
  /** Injected for tests. */
  fetchIndex?: () => Promise<BlizzardJournalInstanceRef[]>;
  fetchInstance?: (instanceId: number) => Promise<BlizzardJournalInstance | null>;
};

/**
 * Resolve the journal instance (by raid name; else the stored id, if it is a
 * real journal instance) and its encounters. Does not write to the DB.
 */
export async function discoverBlizzardRaidMetadata(
  raid: Pick<CatalogRaid, "id" | "name" | "blizzardInstanceId" | "bosses">,
  options: DiscoverBlizzardRaidMetadataOptions = {},
): Promise<BlizzardRaidMetadataResolution> {
  const injected = options.fetchIndex != null && options.fetchInstance != null;
  if (!injected && !isBlizzardConfigured()) return { status: "UNRESOLVED", reason: "NOT_CONFIGURED" };
  // Journal ids are global; the EU endpoint serves them like any other region.
  const fetchIndex = options.fetchIndex ?? (() => blizzardApiClient.getJournalInstanceIndex("EU"));
  const fetchInstance = options.fetchInstance ?? ((id: number) => blizzardApiClient.getJournalInstance("EU", id));

  try {
    const byName = resolveJournalInstanceId(raid.name, await fetchIndex());
    if ("unresolved" in byName && byName.unresolved === "AMBIGUOUS") {
      return { status: "UNRESOLVED", reason: "AMBIGUOUS" };
    }
    const instanceId = "id" in byName ? byName.id : raid.blizzardInstanceId;
    if (instanceId == null) return { status: "UNRESOLVED", reason: "NO_MATCH" };

    const instance = await fetchInstance(instanceId).catch(() => null);
    if (!instance) return { status: "UNRESOLVED", reason: "NO_MATCH" };
    if (instance.category !== "RAID") return { status: "UNRESOLVED", reason: "NOT_RAID" };
    return {
      status: "RESOLVED",
      blizzardInstanceId: instance.id,
      encounterMappings: resolveJournalEncounters(raid.bosses, instance),
    };
  } catch (error) {
    console.error("[blizzard-raid-metadata] journal lookup failed", { raidId: raid.id }, error);
    return { status: "UNRESOLVED", reason: "UNAVAILABLE" };
  }
}
