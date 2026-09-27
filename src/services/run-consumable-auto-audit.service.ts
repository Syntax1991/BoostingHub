import { scheduledJobLockRepository } from "@/repositories/scheduled-job-lock.repository";
import {
  runConsumableAuditRepository,
  type ConsumableAuditFailureCode,
} from "@/repositories/run-consumable-audit.repository";
import { runWarcraftLogsRepository } from "@/repositories/run-warcraft-logs.repository";
import { analyzeRun } from "@/services/run-consumable-audit.service";
import { rescanRun } from "@/services/run-warcraft-logs.service";
import { CONSUMABLE_AUTO_AUDIT_POLICY } from "@/services/consumable-auto-audit-policy";

/**
 * Automatic Consumables Audit after a Run is COMPLETED. The last pulls are
 * often uploaded to Warcraft Logs after the Run ends, so the audit waits a
 * while, then re-fetches the linked reports, assigns fights (ambiguous ones
 * stay in manager review) and analyzes the ASSIGNED fights as a system action.
 * Triggered by the Discord bot's timer through the Bot API.
 */

/** Distinct from SCHEDULED_CHARACTER_SYNC_LOCK_KEY (837462, 1). */
export const CONSUMABLE_AUTO_AUDIT_LOCK_KEY = { classId: 837462, objectId: 2 } as const;

const MINUTE = 60_000;

export type AutoAuditRunOutcome =
  | { runId: string; status: "ANALYZED"; fights: number }
  | { runId: string; status: "FAILED"; failure: ConsumableAuditFailureCode }
  | { runId: string; status: "ERROR" };

export type AutoAuditPassResult =
  | { status: "SKIPPED_ALREADY_RUNNING" }
  | { status: "COMPLETED"; due: number; runs: AutoAuditRunOutcome[] };

export const runConsumableAutoAuditService = {
  /** One bounded pass. Overlapping passes are skipped via an advisory lock. */
  async runDuePass(now: Date = new Date()): Promise<AutoAuditPassResult> {
    const handle = await scheduledJobLockRepository.tryAcquireLock(
      CONSUMABLE_AUTO_AUDIT_LOCK_KEY.classId,
      CONSUMABLE_AUTO_AUDIT_LOCK_KEY.objectId,
    );
    if (!handle) return { status: "SKIPPED_ALREADY_RUNNING" };
    try {
      const policy = CONSUMABLE_AUTO_AUDIT_POLICY;
      const runIds = await runConsumableAuditRepository.listCompletedRunIdsBetween(
        new Date(now.getTime() - policy.lookbackDays * 24 * 60 * MINUTE).toISOString(),
        new Date(now.getTime() - policy.delayMinutes * MINUTE).toISOString(),
      );
      const withReports = await runWarcraftLogsRepository.runIdsWithReports(runIds);
      const audits = new Map(
        (await runConsumableAuditRepository.listByRunIds([...withReports])).map((row) => [row.runId, row] as const),
      );
      const due = [...withReports].filter((runId) => {
        const audit = audits.get(runId) ?? null;
        if (audit?.analyzedAt) return false;
        if ((audit?.autoAttempts ?? 0) >= policy.maxAttempts) return false;
        return !audit || now.getTime() - Date.parse(audit.lastAttemptAt) >= policy.retryMinutes * MINUTE;
      });

      const runs: AutoAuditRunOutcome[] = [];
      for (const runId of due.slice(0, policy.maxRunsPerPass)) {
        runs.push(await auditOneRun(runId, now));
      }
      return { status: "COMPLETED", due: due.length, runs };
    } finally {
      await scheduledJobLockRepository.releaseLock(handle);
    }
  },
};

async function auditOneRun(runId: string, now: Date): Promise<AutoAuditRunOutcome> {
  try {
    const run = await runConsumableAuditRepository.findRunContext(runId);
    if (!run || run.status !== "COMPLETED") return { runId, status: "ERROR" };
    // Count the attempt first so a crash mid-way can never loop forever.
    await runConsumableAuditRepository.incrementAutoAttempts(run.id, now.toISOString());
    const scanned = await rescanRun(run, null, now);
    if (scanned.status === "FAILED") {
      await runConsumableAuditRepository.recordFailedAttempt({
        runId: run.id,
        failure: scanned.failure,
        attemptedAt: now.toISOString(),
      });
      return { runId, status: "FAILED", failure: scanned.failure };
    }
    const result = await analyzeRun(run, null, () => now, { skipCooldown: true, auto: true });
    return result.status === "ANALYZED"
      ? { runId, status: "ANALYZED", fights: result.fights }
      : { runId, status: "FAILED", failure: result.failure };
  } catch (error) {
    console.error(`[consumable-auto-audit] run ${runId} failed`, error);
    return { runId, status: "ERROR" };
  }
}
