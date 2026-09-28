import { scheduledJobLockRepository } from "@/repositories/scheduled-job-lock.repository";
import {
  runConsumableAuditRepository,
  type ConsumableAuditFailureCode,
} from "@/repositories/run-consumable-audit.repository";
import { runWarcraftLogsRepository } from "@/repositories/run-warcraft-logs.repository";
import { analyzeRun } from "@/services/run-consumable-audit.service";
import { rescanRun } from "@/services/run-warcraft-logs.service";
import {
  autoAuditState,
  CONSUMABLE_AUTO_AUDIT_POLICY,
  PERMANENT_AUTO_AUDIT_FAILURES,
} from "@/services/consumable-auto-audit-policy";

/**
 * Automatic Consumables Audit after a Run is COMPLETED. The last pulls are
 * often uploaded to Warcraft Logs after the Run ends, so the audit waits a
 * while, then re-fetches the linked reports, assigns fights (ambiguous ones
 * stay in manager review) and analyzes the ASSIGNED fights as a system action.
 * Triggered by the Discord bot's timer through the Bot API. What is due is
 * decided by `autoAuditState` from persisted timestamps only — no timers.
 */

/** Distinct from SCHEDULED_CHARACTER_SYNC_LOCK_KEY (837462, 1). */
export const CONSUMABLE_AUTO_AUDIT_LOCK_KEY = { classId: 837462, objectId: 2 } as const;

const MINUTE = 60_000;

export type AutoAuditRunOutcome =
  | { runId: string; status: "ANALYZED"; fights: number }
  | { runId: string; status: "FAILED"; failure: ConsumableAuditFailureCode; retryable: boolean }
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
      const completed = await runConsumableAuditRepository.listCompletedRunsBetween(
        new Date(now.getTime() - policy.lookbackDays * 24 * 60 * MINUTE).toISOString(),
        new Date(now.getTime() - policy.delayMinutes * MINUTE).toISOString(),
      );
      const latestAttachedAt = await runWarcraftLogsRepository.latestAttachedAtByRunIds(
        completed.map((run) => run.id),
      );
      const audits = new Map(
        (await runConsumableAuditRepository.listByRunIds([...latestAttachedAt.keys()])).map(
          (row) => [row.runId, row] as const,
        ),
      );
      const due = completed
        .flatMap((run) => {
          const state = autoAuditState({
            status: "COMPLETED",
            completedAt: run.completedAt,
            latestReportAttachedAt: latestAttachedAt.get(run.id) ?? null,
            audit: audits.get(run.id) ?? null,
            now,
          });
          return state?.state === "SCHEDULED" && Date.parse(state.dueAt) <= now.getTime()
            ? [{ runId: run.id, dueAt: state.dueAt, reason: state.reason }]
            : [];
        })
        // Earliest due first; the Run id keeps the order stable.
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.runId.localeCompare(b.runId));

      const runs: AutoAuditRunOutcome[] = [];
      for (const item of due.slice(0, policy.maxRunsPerPass)) {
        runs.push(await auditOneRun(item.runId, item.reason, now));
      }
      return { status: "COMPLETED", due: due.length, runs };
    } finally {
      await scheduledJobLockRepository.releaseLock(handle);
    }
  },
};

async function auditOneRun(runId: string, reason: "FIRST" | "NEW_REPORT", now: Date): Promise<AutoAuditRunOutcome> {
  try {
    const run = await runConsumableAuditRepository.findRunContext(runId);
    if (!run || run.status !== "COMPLETED") return { runId, status: "ERROR" };
    const reports = (await runWarcraftLogsRepository.listAssociations(run.id)).map((row) => row.report.code);
    console.log("[consumable-auto-audit] start", { runId, reports, reason });
    // Count the attempt first so a crash mid-way can never loop forever.
    await runConsumableAuditRepository.incrementAutoAttempts(run.id, now.toISOString());
    const scanned = await rescanRun(run, null, now);
    if (scanned.status === "FAILED") {
      await runConsumableAuditRepository.recordFailedAttempt({
        runId: run.id,
        failure: scanned.failure,
        attemptedAt: now.toISOString(),
      });
      return failed(runId, reports, scanned.failure);
    }
    const result = await analyzeRun(run, null, () => now, { skipCooldown: true, auto: true });
    if (result.status !== "ANALYZED") return failed(runId, reports, result.failure);
    console.log("[consumable-auto-audit] analyzed", { runId, reports, fights: result.fights });
    return { runId, status: "ANALYZED", fights: result.fights };
  } catch (error) {
    // Counted as an attempt already; retried on a later pass like a transient failure.
    console.error("[consumable-auto-audit] error", { runId, retryable: true }, error);
    return { runId, status: "ERROR" };
  }
}

function failed(runId: string, reports: string[], failure: ConsumableAuditFailureCode): AutoAuditRunOutcome {
  const retryable = !PERMANENT_AUTO_AUDIT_FAILURES.has(failure);
  console.warn("[consumable-auto-audit] failed", { runId, reports, failure, retryable });
  return { runId, status: "FAILED", failure, retryable };
}
