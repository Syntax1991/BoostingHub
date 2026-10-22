/** Display helpers for the Raid Catalog admin (pure, client-safe). */
import { effectiveWclRankingEncounterId, type CatalogRaid } from "@/lib/raid-catalog";

export function formatIdList(ids: readonly number[]): string {
  return ids.length === 0 ? "—" : ids.join(", ");
}

/** Editable text form of an id list ("2849, 3379"). */
export function idListInputValue(ids: readonly number[]): string {
  return ids.join(", ");
}

export function formatBlizzard(raid: { blizzardInstanceId: number | null }): string {
  return raid.blizzardInstanceId == null ? "Not mapped" : `Instance ${raid.blizzardInstanceId}`;
}

export function formatWarcraftLogs(
  raid: Pick<CatalogRaid, "wclZoneId" | "wclRankingEncounterId" | "bosses">,
): string {
  if (raid.wclZoneId == null) return "Not resolved";
  const encounter = effectiveWclRankingEncounterId(raid);
  return encounter == null
    ? `Connected · Zone ${raid.wclZoneId}`
    : `Connected · Zone ${raid.wclZoneId} · Encounter ${encounter}`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Legacy `Raid.isActive` wording: offered as a raid choice when creating or editing a Run.
 * Off covers both historical raids and bundle-only content (Tide), so never call it "Historical".
 */
export function runAvailabilityLabel(availableForRuns: boolean): string {
  return availableForRuns ? "Available for new Runs" : "Not offered for new Runs";
}
