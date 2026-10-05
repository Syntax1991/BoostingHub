import type { IntegrationEventStatus, IntegrationProvider } from "@/models/enums";
import { INTEGRATION_PROVIDERS } from "@/models/enums";

export const SYSTEM_HEALTH_STATES = [
  "HEALTHY",
  "DEGRADED",
  "DOWN",
  "NOT_CONFIGURED",
  "UNKNOWN",
] as const;
export type SystemHealthState = (typeof SYSTEM_HEALTH_STATES)[number];

export type ProviderHealthInput = {
  provider: IntegrationProvider;
  configured: boolean;
  /** Newest-first recent events for this provider (already bounded). */
  recentStatuses: readonly IntegrationEventStatus[];
};

/**
 * Deterministic provider health roll-up.
 * - not configured → NOT_CONFIGURED
 * - no recent events → UNKNOWN
 * - any ERROR in the recent window → DEGRADED (or DOWN if the newest event is ERROR
 *   and there is no later SUCCESS/WARNING — newest-first: index 0 is newest)
 * - WARNING without ERROR → DEGRADED
 * - only SUCCESS → HEALTHY
 */
export function deriveProviderHealth(input: ProviderHealthInput): SystemHealthState {
  if (!input.configured) return "NOT_CONFIGURED";
  if (input.recentStatuses.length === 0) return "UNKNOWN";

  const newest = input.recentStatuses[0]!;
  const hasError = input.recentStatuses.includes("ERROR");
  const hasWarning = input.recentStatuses.includes("WARNING");

  if (hasError) {
    // Newest failure with no newer recovery signal → DOWN; otherwise DEGRADED.
    return newest === "ERROR" ? "DOWN" : "DEGRADED";
  }
  if (hasWarning || newest === "WARNING") return "DEGRADED";
  return "HEALTHY";
}

export const SYSTEM_HEALTH_PROVIDER_ORDER: readonly IntegrationProvider[] = INTEGRATION_PROVIDERS;

export const SYSTEM_HEALTH_PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  BLIZZARD: "Blizzard",
  WARCRAFT_LOGS: "Warcraft Logs",
  DISCORD: "Discord",
  RAIDER_IO: "Raider.IO Import",
  SYSTEM: "System",
  BACKUP: "Backup",
};
