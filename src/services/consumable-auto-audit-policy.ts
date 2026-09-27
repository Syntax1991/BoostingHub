import type { RunConsumableAuditRecord } from "@/repositories/run-consumable-audit.repository";

/** Timing rules of the automatic post-completion Consumables Audit (pure). */
export const CONSUMABLE_AUTO_AUDIT_POLICY = {
  /** Wait after Run completion before the first automatic attempt. */
  delayMinutes: 15,
  /** Wait between a failed attempt and the next one. */
  retryMinutes: 15,
  /** Automatic attempts per Run; afterwards only a manager can analyze. */
  maxAttempts: 2,
  /** Runs completed longer ago than this are never picked up automatically. */
  lookbackDays: 3,
  /** Bounded work per pass (each Run costs ~2 WCL requests). */
  maxRunsPerPass: 3,
} as const;

const MINUTE = 60_000;

export type AutoAuditState =
  | { state: "SCHEDULED"; dueAt: string }
  | { state: "GAVE_UP"; attempts: number }
  | null;

/**
 * Where a Run stands with the automatic audit (for display and for the job).
 * Null when it does not apply: not COMPLETED, completion time unknown, no
 * linked report, already analyzed, or too old.
 */
export function autoAuditState(input: {
  status: string;
  completedAt: string | null;
  hasReports: boolean;
  audit: Pick<RunConsumableAuditRecord, "analyzedAt" | "autoAttempts" | "lastAttemptAt"> | null;
  now?: Date;
}): AutoAuditState {
  const policy = CONSUMABLE_AUTO_AUDIT_POLICY;
  if (input.status !== "COMPLETED" || !input.completedAt || !input.hasReports) return null;
  if (input.audit?.analyzedAt) return null;
  const completedAtMs = Date.parse(input.completedAt);
  if (input.now && input.now.getTime() - completedAtMs > policy.lookbackDays * 24 * 60 * MINUTE) return null;
  const attempts = input.audit?.autoAttempts ?? 0;
  if (attempts >= policy.maxAttempts) return { state: "GAVE_UP", attempts };
  const firstDue = completedAtMs + policy.delayMinutes * MINUTE;
  const retryDue = input.audit ? Date.parse(input.audit.lastAttemptAt) + policy.retryMinutes * MINUTE : 0;
  return { state: "SCHEDULED", dueAt: new Date(Math.max(firstDue, retryDue)).toISOString() };
}
