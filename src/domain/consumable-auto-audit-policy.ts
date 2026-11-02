import type {
  ConsumableAuditFailureCode,
  RunConsumableAuditRecord,
} from "@/repositories/run-consumable-audit.repository";

/** Timing rules of the automatic post-completion Consumables Audit (pure). */
export const CONSUMABLE_AUTO_AUDIT_POLICY = {
  /** Wait after Run completion before the first automatic attempt. */
  delayMinutes: 15,
  /** Wait between an attempt and the next one. */
  retryMinutes: 15,
  /**
   * Automatic attempts per report generation (reset when the log bot links a
   * new report). Covers transient failures — WCL down, last pulls not
   * uploaded yet — for about an hour after the first attempt; afterwards only
   * a manager can analyze.
   */
  maxAttempts: 4,
  /** Runs completed longer ago than this are never picked up automatically. */
  lookbackDays: 3,
  /** Bounded work per pass (each Run costs ~2 WCL requests). */
  maxRunsPerPass: 3,
} as const;

/**
 * Failures a retry cannot fix: the report is private/unknown, or Warcraft Logs
 * is not configured. The automatic audit stops right away (no WCL hammering);
 * a manager can still act. Every other outcome (WCL_UNAVAILABLE, no relevant
 * fights yet, an internal error) is retried up to `maxAttempts`.
 */
export const PERMANENT_AUTO_AUDIT_FAILURES: ReadonlySet<ConsumableAuditFailureCode> = new Set([
  "REPORT_NOT_FOUND",
  "NOT_CONFIGURED",
]);

const MINUTE = 60_000;

export type AutoAuditState =
  /** FIRST: never analyzed. NEW_REPORT: a report was linked after the latest analysis. */
  | { state: "SCHEDULED"; dueAt: string; reason: "FIRST" | "NEW_REPORT" }
  | { state: "GAVE_UP"; attempts: number; failure: ConsumableAuditFailureCode | null }
  | null;

/**
 * Where a Run stands with the automatic audit — the one rule for both the job
 * and the Run page. Null when it does not apply: not COMPLETED, completion
 * time unknown, no linked report, the latest analysis already covers every
 * linked report, or too old.
 *
 * A report linked after the latest successful analysis (e.g. a log-bot link
 * found only after the first audit) makes the Run due again.
 */
export function autoAuditState(input: {
  status: string;
  completedAt: string | null;
  /** When the newest report was linked to the Run; null = no report. */
  latestReportAttachedAt: string | null;
  audit: Pick<RunConsumableAuditRecord, "analyzedAt" | "autoAttempts" | "lastAttemptAt" | "lastFailure"> | null;
  now?: Date;
}): AutoAuditState {
  const policy = CONSUMABLE_AUTO_AUDIT_POLICY;
  const { audit, latestReportAttachedAt } = input;
  if (input.status !== "COMPLETED" || !input.completedAt || !latestReportAttachedAt) return null;
  const newReport = audit?.analyzedAt != null && Date.parse(latestReportAttachedAt) > Date.parse(audit.analyzedAt);
  if (audit?.analyzedAt && !newReport) return null;
  const completedAtMs = Date.parse(input.completedAt);
  if (input.now && input.now.getTime() - completedAtMs > policy.lookbackDays * 24 * 60 * MINUTE) return null;

  const attempts = audit?.autoAttempts ?? 0;
  const permanent =
    attempts > 0 && audit?.lastFailure != null && PERMANENT_AUTO_AUDIT_FAILURES.has(audit.lastFailure);
  if (permanent || attempts >= policy.maxAttempts) {
    return { state: "GAVE_UP", attempts, failure: audit?.lastFailure ?? null };
  }
  const firstDue = completedAtMs + policy.delayMinutes * MINUTE;
  const retryDue = audit ? Date.parse(audit.lastAttemptAt) + policy.retryMinutes * MINUTE : 0;
  return {
    state: "SCHEDULED",
    dueAt: new Date(Math.max(firstDue, retryDue)).toISOString(),
    reason: newReport ? "NEW_REPORT" : "FIRST",
  };
}
