import { integrationEventService } from "@/services/integration-event.service";
import type { IntegrationEventStatus, WowRegion } from "@/models/enums";
import type { ParseRaiderIoCharacterUrlResult } from "@/lib/raiderio-character-url";

/** Best-effort — never throws into WCL / Raider.IO call paths. */
async function safeRecord(input: Parameters<typeof integrationEventService.record>[0]): Promise<void> {
  try {
    await integrationEventService.record(input);
  } catch {
    // Telemetry must not break imports / WCL.
  }
}

/**
 * Record WCL lookup/report outcomes.
 * NOT_FOUND → WARNING (expected/neutral absence — does not mean WCL DOWN).
 * NOT_CONFIGURED → WARNING with authOrConfig.
 * TEMPORARY_FAILURE → ERROR (upstream degradation).
 * SUCCESS → not recorded per-call (avoid flood); job summaries may SUCCESS.
 */
export async function recordWarcraftLogsOutcome(input: {
  operation: string;
  status: "SUCCESS" | "NOT_FOUND" | "NOT_CONFIGURED" | "UNSUPPORTED_REGION" | "TEMPORARY_FAILURE";
  region?: WowRegion | null;
  entityType?: string | null;
  entityId?: string | null;
  durationMs?: number | null;
}): Promise<void> {
  if (input.status === "SUCCESS") return;

  let status: IntegrationEventStatus = "WARNING";
  let errorCode: string = input.status;
  if (input.status === "TEMPORARY_FAILURE") {
    status = "ERROR";
    errorCode = "WCL_UNAVAILABLE";
  } else if (input.status === "NOT_CONFIGURED") {
    status = "WARNING";
    errorCode = "NOT_CONFIGURED";
  } else if (input.status === "NOT_FOUND") {
    status = "WARNING";
    errorCode = "NOT_FOUND";
  }

  await safeRecord({
    provider: "WARCRAFT_LOGS",
    operation: input.operation,
    status,
    errorCode,
    region: input.region ?? null,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    durationMs: input.durationMs ?? null,
    metadata: {
      authOrConfig: input.status === "NOT_CONFIGURED",
      reason: input.status,
    },
  });
}

export async function recordWarcraftLogsJobSummary(input: {
  operation: string;
  status: IntegrationEventStatus;
  durationMs: number;
  processed: number;
  succeeded: number;
  failed: number;
  errorCode?: string | null;
}): Promise<void> {
  await safeRecord({
    provider: "WARCRAFT_LOGS",
    operation: input.operation,
    status: input.status,
    durationMs: input.durationMs,
    errorCode: input.errorCode ?? null,
    metadata: {
      processed: input.processed,
      succeeded: input.succeeded,
      failed: input.failed,
    },
  });
}

/**
 * Local Raider.IO profile URL parse. Do not persist the full pasted URL.
 * Parse outcomes are user-input signals — not treated as provider outage in health roll-up.
 */
export async function recordRaiderIoParseResult(result: ParseRaiderIoCharacterUrlResult): Promise<void> {
  if (result.ok) {
    await safeRecord({
      provider: "RAIDER_IO",
      operation: "PARSE_URL",
      status: "SUCCESS",
      errorCode: "PARSE_SUCCESS",
      region: result.value.region,
      metadata: { parseFailure: null },
    });
    return;
  }
  await safeRecord({
    provider: "RAIDER_IO",
    operation: "PARSE_URL",
    status: "WARNING",
    errorCode: result.error.code,
    metadata: { parseFailure: result.error.code },
  });
}

/**
 * Soft Raider.IO API enrichment outcomes (equipped ilvl).
 * - SUCCESS: recorded so health recovers after TEMPORARY_FAILURE
 * - NOT_FOUND: not recorded (domain absence, not provider outage)
 * - TEMPORARY_FAILURE: WARNING — never fails Blizzard sync; access key absence is not NOT_CONFIGURED
 * Never persist access keys or query strings.
 */
export async function recordRaiderIoApiOutcome(input: {
  status: "SUCCESS" | "TEMPORARY_FAILURE";
  region?: WowRegion | null;
  durationMs?: number | null;
  reason?: string | null;
}): Promise<void> {
  if (input.status === "SUCCESS") {
    await safeRecord({
      provider: "RAIDER_IO",
      operation: "CHARACTER_EQUIPPED_ILVL",
      status: "SUCCESS",
      region: input.region ?? null,
      durationMs: input.durationMs ?? null,
    });
    return;
  }
  const reason = input.reason?.trim().slice(0, 120) || "TEMPORARY_FAILURE";
  await safeRecord({
    provider: "RAIDER_IO",
    operation: "CHARACTER_EQUIPPED_ILVL",
    status: "WARNING",
    errorCode: "RAIDER_IO_UNAVAILABLE",
    region: input.region ?? null,
    durationMs: input.durationMs ?? null,
    metadata: { reason },
  });
}
