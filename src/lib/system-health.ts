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

/** Newest-first IntegrationEvent signal used for provider roll-up. */
export type ProviderHealthEvent = {
  status: IntegrationEventStatus;
  operation: string;
  errorCode?: string | null;
};

export type ProviderHealthInput = {
  provider: IntegrationProvider;
  configured: boolean;
  /** Newest-first recent events for this provider (already bounded). */
  recentEvents: readonly ProviderHealthEvent[];
};

/**
 * Prefer these aggregate operations as the current operational truth when present.
 * Individual older failures remain in the event table / Character Ops.
 */
export const PROVIDER_AUTHORITATIVE_OPERATIONS: Partial<Record<IntegrationProvider, string>> = {
  BLIZZARD: "SCHEDULED_SYNC_PASS",
  WARCRAFT_LOGS: "AUTO_AUDIT_PASS",
  DISCORD: "SYNC_ONCE",
  BACKUP: "DATABASE_BACKUP",
};

/**
 * Domain-neutral / user-input outcomes that must not mark the provider unhealthy.
 * They stay visible in the event table.
 */
export function isDomainNeutralHealthEvent(
  provider: IntegrationProvider,
  event: ProviderHealthEvent,
): boolean {
  if (provider === "WARCRAFT_LOGS") {
    // Missing report/character is expected product state, not WCL outage.
    return event.errorCode === "NOT_FOUND";
  }
  if (provider === "RAIDER_IO") {
    // Local URL parse outcomes and missing RIO profiles are not provider outages.
    return event.operation === "PARSE_URL" || event.errorCode === "NOT_FOUND";
  }
  if (provider === "BLIZZARD") {
    // Character-level 404 telemetry (if present) is owned by Character Operations.
    return event.errorCode === "HTTP_404" || event.errorCode === "PROFILE_UNAVAILABLE";
  }
  return false;
}

function statusToHealth(status: IntegrationEventStatus): SystemHealthState {
  if (status === "SUCCESS") return "HEALTHY";
  if (status === "WARNING") return "DEGRADED";
  return "DOWN";
}

/**
 * Deterministic, recovery-aware provider health.
 *
 * Current operational state wins:
 * - not configured → NOT_CONFIGURED
 * - no recent events → UNKNOWN
 * - Blizzard/Backup: authoritative aggregate is roll-up truth when present
 *   (Character-level failures stay visible in Character Ops / event table)
 * - other providers: aggregate wins when at least as new as other signals;
 *   a newer non-aggregate failure after that aggregate still marks unhealthy
 * - only domain-neutral signals → HEALTHY (configured, no current outage)
 *
 * Older ERROR/WARNING never keeps a provider DEGRADED after a later SUCCESS.
 */
export function deriveProviderHealth(input: ProviderHealthInput): SystemHealthState {
  if (!input.configured) return "NOT_CONFIGURED";
  if (input.recentEvents.length === 0) return "UNKNOWN";

  const authoritativeOp = PROVIDER_AUTHORITATIVE_OPERATIONS[input.provider];
  const aggregateIndex = authoritativeOp
    ? input.recentEvents.findIndex((event) => event.operation === authoritativeOp)
    : -1;
  const aggregate = aggregateIndex >= 0 ? input.recentEvents[aggregateIndex] : undefined;

  const relevantIndex = input.recentEvents.findIndex(
    (event) => !isDomainNeutralHealthEvent(input.provider, event),
  );
  const relevant = relevantIndex >= 0 ? input.recentEvents[relevantIndex] : undefined;

  // Newest-first: lower index is newer.
  // Blizzard/Backup aggregates are the operational truth whenever present
  // (Character-level failures stay in Character Ops / event table).
  // Other providers: aggregate wins only when at least as new as other signals.
  const preferAggregateWheneverPresent =
    input.provider === "BLIZZARD" || input.provider === "BACKUP";
  if (
    aggregate &&
    (preferAggregateWheneverPresent || relevantIndex < 0 || aggregateIndex <= relevantIndex)
  ) {
    return statusToHealth(aggregate.status);
  }
  if (relevant) {
    return statusToHealth(relevant.status);
  }
  return "HEALTHY";
}

export const SYSTEM_HEALTH_PROVIDER_ORDER: readonly IntegrationProvider[] = INTEGRATION_PROVIDERS;

export const SYSTEM_HEALTH_PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  BLIZZARD: "Blizzard",
  WARCRAFT_LOGS: "Warcraft Logs",
  DISCORD: "Discord",
  /** Local URL parse + optional soft API ilvl enrichment (key optional). */
  RAIDER_IO: "Raider.IO",
  SYSTEM: "System",
  BACKUP: "Backup",
};
