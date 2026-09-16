import type { CharacterWarcraftLogsBatchSummary } from "@/services/character-warcraft-logs.service";

/**
 * Concise, safe bulk WCL discovery copy for the Characters page.
 * Never includes secrets, GraphQL errors, or Character IDs.
 */
export function formatBulkWarcraftLogsDiscoveryMessage(
  summary: CharacterWarcraftLogsBatchSummary,
): string {
  const linked = summary.linked + summary.alreadyLinked;

  if (summary.temporaryFailure > 0 || summary.skippedAfterFailure > 0) {
    return `${linked} linked before Warcraft Logs became unavailable · ${summary.skippedAfterFailure} skipped.`;
  }

  if (linked > 0 && summary.notFound === 0 && summary.mismatch === 0 && summary.unsupportedRegion === 0) {
    return `${linked} Warcraft Logs character${linked === 1 ? "" : "s"} linked.`;
  }

  const parts: string[] = [];
  if (linked > 0) parts.push(`${linked} linked`);
  if (summary.notFound > 0) parts.push(`${summary.notFound} not found`);
  if (summary.mismatch > 0) parts.push(`${summary.mismatch} mismatch`);
  if (summary.unsupportedRegion > 0) {
    parts.push(`${summary.unsupportedRegion} unsupported region`);
  }

  if (parts.length === 0) {
    return "No Warcraft Logs characters were linked.";
  }

  return `${parts.join(" · ")}.`;
}
