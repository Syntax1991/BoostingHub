/** Display helpers for the Content Catalog admin (pure, client-safe). */

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

export function formatWarcraftLogs(raid: { wclZoneId: number | null; wclRankingEncounterId: number | null }): string {
  if (raid.wclZoneId == null) return "Not resolved";
  return raid.wclRankingEncounterId == null
    ? `Connected · Zone ${raid.wclZoneId}`
    : `Connected · Zone ${raid.wclZoneId} · Encounter ${raid.wclRankingEncounterId}`;
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
