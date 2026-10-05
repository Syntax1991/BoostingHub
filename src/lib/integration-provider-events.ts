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
 * Raider.IO is local URL parsing only — never an API health signal.
 * Do not persist the full pasted URL.
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
