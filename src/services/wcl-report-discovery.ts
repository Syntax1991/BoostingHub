import type { WarcraftLogsReportMetadata } from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import {
  WCL_FIGHT_ASSIGNMENT_POLICY,
  assignReportFights,
  type RunAssignmentCandidate,
} from "@/services/wcl-fight-assignment";

/**
 * Central discovery: a report link from a dedicated log channel carries no
 * Run. Which Runs it belongs to is decided exactly like the Consumables
 * Audit's fight assignment — absolute fight times inside a Run's window,
 * Run content and difficulty, roster overlap for overlapping windows — never
 * by "newest" or "closest" Run. A report is linked to every COMPLETED Run
 * that gets ASSIGNED or NEEDS_REVIEW fights (one report may hold several
 * Runs); the per-fight review on the Run page settles ambiguity. Pure.
 */
export const WCL_DISCOVERY_POLICY = {
  /** Spacing while something can still change (a Run in progress, the report still growing). */
  retryMinutes: 15,
  /** Backoff ceiling once nothing is moving. */
  maxBackoffHours: 6,
  /** A report whose last fight ended this long ago is considered complete. */
  reportIdleHours: 2,
  /** Give up / stop re-checking this long after the message was posted. */
  maxAgeDays: 3,
} as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type DiscoveryDecision = {
  status: "PENDING" | "MATCHED" | "NEEDS_REVIEW" | "IGNORED";
  /** Safe reason code for logs and the discovery row. */
  outcome:
    | "LINKED"
    | "NO_BOSS_FIGHTS_YET"
    | "NO_BOSS_FIGHTS"
    | "RUN_IN_PROGRESS"
    | "NO_MATCHING_RUN_YET"
    | "NO_MATCHING_RUN";
  /** COMPLETED Runs the report must be linked to (idempotent). */
  linkRunIds: string[];
  /** Null once settled: nothing will change any more. */
  nextAttemptInMs: number | null;
  perRun: Array<{ runId: string; assigned: number; needsReview: number }>;
};

export function evaluateReportDiscovery(input: {
  report: Pick<WarcraftLogsReportMetadata, "startTime" | "endTime" | "fights" | "actors">;
  /** Started IN_PROGRESS / COMPLETED Runs around the report (loadStartedCandidates). */
  candidates: RunAssignmentCandidate[];
  /** wclFightId → runId of this report's fights already ASSIGNED (e.g. by a manager). */
  assignedFights?: ReadonlyMap<number, string>;
  postedAtMs: number;
  nowMs: number;
  /** Evaluations so far (backoff). */
  attempts: number;
  policy?: typeof WCL_DISCOVERY_POLICY;
}): DiscoveryDecision {
  const policy = input.policy ?? WCL_DISCOVERY_POLICY;
  const { report, candidates, nowMs } = input;
  const tolerance = WCL_FIGHT_ASSIGNMENT_POLICY.toleranceSeconds * 1000;
  const expired = nowMs - input.postedAtMs > policy.maxAgeDays * 24 * HOUR;
  const reportIdle = nowMs - report.endTime >= policy.reportIdleHours * HOUR;
  // A Run still running whose start precedes the report's end may still own fights.
  const anyOpen = candidates.some(
    (run) => run.completedAtMs == null && run.startedAtMs != null && run.startedAtMs <= report.endTime + tolerance,
  );
  const retry = (): number =>
    anyOpen || !reportIdle
      ? policy.retryMinutes * MINUTE
      : Math.min(policy.maxBackoffHours * HOUR, policy.retryMinutes * MINUTE * 2 ** Math.min(input.attempts, 10));

  if (!report.fights.some((fight) => fight.encounterId > 0)) {
    return expired
      ? { status: "IGNORED", outcome: "NO_BOSS_FIGHTS", linkRunIds: [], nextAttemptInMs: null, perRun: [] }
      : { status: "PENDING", outcome: "NO_BOSS_FIGHTS_YET", linkRunIds: [], nextAttemptInMs: retry(), perRun: [] };
  }

  const perRun = candidates
    // Only a closed window gives a final assignment; open Runs still compete as "others".
    .filter((run) => run.completedAtMs != null && run.startedAtMs != null)
    .map((target) => {
      const assignedElsewhere = new Map(
        [...(input.assignedFights ?? new Map<number, string>())].filter(([, runId]) => runId !== target.runId),
      );
      const fights = assignReportFights({ report, target, others: candidates, assignedElsewhere });
      return {
        runId: target.runId,
        assigned: fights.filter((fight) => fight.status === "ASSIGNED").length,
        needsReview: fights.filter((fight) => fight.status === "NEEDS_REVIEW").length,
      };
    })
    .filter((row) => row.assigned > 0 || row.needsReview > 0);

  if (perRun.length === 0) {
    if (expired) return { status: "IGNORED", outcome: "NO_MATCHING_RUN", linkRunIds: [], nextAttemptInMs: null, perRun };
    return {
      status: "PENDING",
      outcome: anyOpen ? "RUN_IN_PROGRESS" : "NO_MATCHING_RUN_YET",
      linkRunIds: [],
      nextAttemptInMs: retry(),
      perRun,
    };
  }

  const settled = expired || (reportIdle && !anyOpen);
  return {
    status: perRun.some((row) => row.needsReview > 0) ? "NEEDS_REVIEW" : "MATCHED",
    outcome: "LINKED",
    linkRunIds: perRun.map((row) => row.runId),
    // Keep re-checking while the report grows or a Run is open: a later Run in
    // the same report must still be found.
    nextAttemptInMs: settled ? null : retry(),
    perRun,
  };
}
