/**
 * Outbound Warcraft Logs character profile URL from the stored character id.
 * Never derives from region/realm/name — `Character.warcraftLogsId` is the source of truth.
 */
export function getWarcraftLogsCharacterUrl(
  warcraftLogsId: string | null | undefined,
): string | null {
  if (typeof warcraftLogsId !== "string") {
    return null;
  }
  const id = warcraftLogsId.trim();
  if (!id) {
    return null;
  }
  return `https://www.warcraftlogs.com/character/id/${encodeURIComponent(id)}`;
}
