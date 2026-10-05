import {
  INTEGRATION_EVENT_RETENTION_DAYS,
  safeIntegrationErrorCode,
  type IntegrationEventWriteInput,
} from "@/lib/integration-telemetry";
import { integrationEventRepository } from "@/repositories/integration-event.repository";

/**
 * System Health telemetry write API.
 * Authorization for reads belongs to later /manage/system surfaces.
 * Writers may be SYSTEM (schedulers/bots) or future ADMIN actions.
 */
export const integrationEventService = {
  async record(input: IntegrationEventWriteInput) {
    return integrationEventRepository.create({
      ...input,
      errorCode: input.errorCode ?? null,
    });
  },

  /** Convenience: derive a safe errorCode from an unknown failure. */
  async recordFailure(
    input: Omit<IntegrationEventWriteInput, "status" | "errorCode"> & {
      error?: unknown;
      errorCode?: string | null;
      status?: "WARNING" | "ERROR";
    },
  ) {
    return this.record({
      ...input,
      status: input.status ?? "ERROR",
      errorCode: input.errorCode ?? safeIntegrationErrorCode(input.error),
    });
  },

  /**
   * Purge telemetry older than the retention window.
   * Best-effort maintenance — callers should not fail their primary job on purge errors.
   * Deletes in batches of 5000 until the window is clear.
   */
  async purgeExpired(now: Date = new Date()): Promise<{ purged: number; retentionDays: number }> {
    const cutoff = new Date(now.getTime() - INTEGRATION_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const cutoffIso = cutoff.toISOString();
    let purged = 0;
    for (;;) {
      const batch = await integrationEventRepository.deleteOlderThan(cutoffIso);
      purged += batch;
      if (batch < 5000) break;
    }
    return { purged, retentionDays: INTEGRATION_EVENT_RETENTION_DAYS };
  },
};
