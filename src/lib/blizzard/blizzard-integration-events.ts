import { integrationEventService } from "@/services/integration-event.service";
import type { IntegrationEventStatus, WowRegion } from "@/models/enums";

/** Minimal scheduler result shape for telemetry — avoids circular imports. */
export type ScheduledSyncPassSnapshot = {
  status: "COMPLETED" | "SKIPPED_ALREADY_RUNNING";
  totalCandidates: number;
  refreshed: number;
  failed: number;
  profileUnavailable: number;
  rateLimited: number;
  skippedInProgress: number;
  skippedBackoff: number;
  durationMs: number;
};

/** Map Blizzard API client context strings to IntegrationEvent.operation. */
export function blizzardOperationFromContext(context: string): string {
  switch (context) {
    case "client-credentials":
      return "CLIENT_CREDENTIALS";
    case "account-profile":
      return "ACCOUNT_PROFILE";
    case "character-status":
      return "CHARACTER_STATUS";
    case "character-summary":
      return "CHARACTER_SUMMARY";
    case "character-raid-encounters":
      return "RAID_ENCOUNTERS";
    case "token-exchange":
      return "TOKEN_EXCHANGE";
    case "userinfo":
      return "USERINFO";
    default:
      return context.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").slice(0, 120) || "BLIZZARD_REQUEST";
  }
}

/**
 * Whether a Blizzard HTTP/context failure should write IntegrationEvent telemetry.
 * Character 404s are expected/neutral for pool sync — they stay on Character rows.
 * Auth, rate limits, upstream, and credentials failures are system-health signals.
 */
export function shouldRecordBlizzardBoundaryFailure(input: {
  context: string;
  httpStatus: number | null;
  errorCode: string;
}): boolean {
  if (input.context === "client-credentials" || input.context === "token-exchange") {
    return true;
  }
  if (input.errorCode === "TIMEOUT" || input.errorCode === "INVALID_JSON") {
    return true;
  }
  if (input.httpStatus === 401 || input.httpStatus === 403 || input.httpStatus === 429) {
    return true;
  }
  if (input.httpStatus != null && input.httpStatus >= 500) {
    return true;
  }
  // 404 on character profile endpoints: Character sync state owns diagnosis.
  if (input.httpStatus === 404) {
    return input.context === "account-profile" || input.context === "client-credentials";
  }
  return true;
}

export function classifyBlizzardHttpFailure(status: number): {
  errorCode: string;
  status: "WARNING" | "ERROR";
} {
  if (status === 429) return { errorCode: "HTTP_429", status: "WARNING" };
  if (status === 404) return { errorCode: "HTTP_404", status: "WARNING" };
  if (status === 401) return { errorCode: "HTTP_401", status: "ERROR" };
  if (status === 403) return { errorCode: "HTTP_403", status: "ERROR" };
  if (status >= 500) return { errorCode: `HTTP_${status}`, status: "ERROR" };
  return { errorCode: `HTTP_${status}`, status: "ERROR" };
}

/** Best-effort — never throws into Blizzard call paths. */
export async function recordBlizzardBoundaryFailure(input: {
  context: string;
  httpStatus?: number | null;
  errorCode: string;
  status?: "WARNING" | "ERROR";
  durationMs?: number | null;
  region?: WowRegion | null;
  entityType?: string | null;
  entityId?: string | null;
}): Promise<void> {
  const httpStatus = input.httpStatus ?? null;
  if (
    !shouldRecordBlizzardBoundaryFailure({
      context: input.context,
      httpStatus,
      errorCode: input.errorCode,
    })
  ) {
    return;
  }
  try {
    await integrationEventService.recordFailure({
      provider: "BLIZZARD",
      operation: blizzardOperationFromContext(input.context),
      status: input.status ?? "ERROR",
      errorCode: input.errorCode,
      httpStatus,
      durationMs: input.durationMs ?? null,
      region: input.region ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: httpStatus != null ? { httpStatus } : null,
    });
  } catch {
    // Telemetry must not break Blizzard traffic.
  }
}

export function scheduledSyncPassStatus(result: ScheduledSyncPassSnapshot): IntegrationEventStatus {
  if (result.status === "SKIPPED_ALREADY_RUNNING") return "WARNING";
  if (result.failed > 0 || result.rateLimited > 0) return "WARNING";
  return "SUCCESS";
}

export async function recordScheduledSyncPass(
  result: ScheduledSyncPassSnapshot,
  extra?: { errorCode?: string | null; authOrConfig?: boolean },
): Promise<void> {
  try {
    const status = extra?.authOrConfig
      ? "ERROR"
      : scheduledSyncPassStatus(result);
    await integrationEventService.record({
      provider: "BLIZZARD",
      operation: "SCHEDULED_SYNC_PASS",
      status,
      durationMs: result.durationMs,
      errorCode: extra?.errorCode ?? (result.status === "SKIPPED_ALREADY_RUNNING" ? "ALREADY_RUNNING" : null),
      metadata: {
        totalCandidates: result.totalCandidates,
        processed:
          result.refreshed + result.failed + result.rateLimited + result.skippedInProgress,
        succeeded: result.refreshed,
        failed: result.failed,
        profileUnavailable: result.profileUnavailable,
        rateLimited: result.rateLimited,
        backoffSkipped: result.skippedBackoff,
        skipped: result.skippedInProgress,
        authOrConfig: Boolean(extra?.authOrConfig),
        reason: result.status === "SKIPPED_ALREADY_RUNNING" ? "ALREADY_RUNNING" : null,
      },
    });
  } catch {
    // Telemetry must not fail the scheduler.
  }
}
