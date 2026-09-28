import { DomainError } from "@/lib/errors";
import { snowflakeTime } from "@/lib/discord-snowflake";
import { trustedWarcraftLogsReportAuthorIds, warcraftLogsReportChannelIds } from "@/lib/warcraft-logs/config";
import { runWarcraftLogsRepository } from "@/repositories/run-warcraft-logs.repository";
import { scheduledJobLockRepository } from "@/repositories/scheduled-job-lock.repository";
import {
  warcraftLogsDiscoveryRepository,
  type WarcraftLogsDiscoveryRecord,
} from "@/repositories/warcraft-logs-discovery.repository";
import { fetchReport, linkDiscoveredReport } from "@/services/run-warcraft-logs.service";
import { WCL_FIGHT_ASSIGNMENT_POLICY } from "@/services/wcl-fight-assignment";
import { WCL_DISCOVERY_POLICY, evaluateReportDiscovery } from "@/services/wcl-report-discovery";

/**
 * Warcraft Logs reports the trusted log bot posts in a dedicated log channel
 * (DISCORD_WCL_REPORT_CHANNEL_IDS). The bot only reports what it saw; this
 * service re-checks the source, records the link durably and — on its own
 * bounded, locked pass — matches it to Runs and links it (see
 * wcl-report-discovery.ts). Runs linked this way are then audited by the
 * existing automatic audit.
 */

/** Distinct from the character sync (837462, 1) and the auto-audit (837462, 2) locks. */
export const WCL_DISCOVERY_LOCK_KEY = { classId: 837462, objectId: 3 } as const;
/** Evaluations per pass (each costs at most one WCL metadata request). */
export const WCL_DISCOVERY_MAX_PER_PASS = 5;

export type DiscoveryPassResult =
  | { status: "SKIPPED_ALREADY_RUNNING" }
  | { status: "COMPLETED"; evaluated: Array<{ reportCode: string; status: string; outcome: string; linkedRuns: number }> };

export const warcraftLogsDiscoveryService = {
  /** Record one link from a dedicated log channel (idempotent per channel + message + report). */
  async record(
    input: { channelId: string; messageId: string; authorId: string; reportCode: string },
    now: Date = new Date(),
  ): Promise<{ status: "RECORDED" | "ALREADY_RECORDED" }> {
    if (!warcraftLogsReportChannelIds().includes(input.channelId)) {
      throw new DomainError("NOT_AUTHORIZED", "This channel is not a configured Warcraft Logs log channel.", 403);
    }
    if (!trustedWarcraftLogsReportAuthorIds().includes(input.authorId)) {
      throw new DomainError("NOT_AUTHORIZED", "This Discord author is not a trusted Warcraft Logs source.", 403);
    }
    const { created } = await warcraftLogsDiscoveryRepository.record({
      ...input,
      postedAt: new Date(snowflakeTime(input.messageId)).toISOString(),
      now: now.toISOString(),
    });
    if (created) {
      console.log("[wcl-discovery] recorded", { channelId: input.channelId, messageId: input.messageId, reportCode: input.reportCode });
    }
    return { status: created ? "RECORDED" : "ALREADY_RECORDED" };
  },

  /** Advance the durable read position of a configured log channel (forward-only). */
  async advanceCursor(input: { channelId: string; messageId: string }, now: Date = new Date()): Promise<void> {
    if (!warcraftLogsReportChannelIds().includes(input.channelId)) {
      throw new DomainError("NOT_AUTHORIZED", "This channel is not a configured Warcraft Logs log channel.", 403);
    }
    await warcraftLogsDiscoveryRepository.advanceCursor({ ...input, now: now.toISOString() });
  },

  /** One bounded pass over due discoveries. Overlapping passes are skipped. */
  async runDuePass(now: Date = new Date()): Promise<DiscoveryPassResult> {
    const handle = await scheduledJobLockRepository.tryAcquireLock(
      WCL_DISCOVERY_LOCK_KEY.classId,
      WCL_DISCOVERY_LOCK_KEY.objectId,
    );
    if (!handle) return { status: "SKIPPED_ALREADY_RUNNING" };
    try {
      const due = await warcraftLogsDiscoveryRepository.listDue(now.toISOString(), WCL_DISCOVERY_MAX_PER_PASS);
      const evaluated: Array<{ reportCode: string; status: string; outcome: string; linkedRuns: number }> = [];
      for (const discovery of due) {
        evaluated.push(await evaluateOne(discovery, now));
      }
      return { status: "COMPLETED", evaluated };
    } finally {
      await scheduledJobLockRepository.releaseLock(handle);
    }
  },
};

const MINUTE = 60_000;

async function evaluateOne(discovery: WarcraftLogsDiscoveryRecord, now: Date) {
  const nowIso = now.toISOString();
  const expired = now.getTime() - Date.parse(discovery.postedAt) > WCL_DISCOVERY_POLICY.maxAgeDays * 24 * 60 * MINUTE;
  const save = async (status: WarcraftLogsDiscoveryRecord["status"], outcome: string, linkedRunIds: string[], nextInMs: number | null) => {
    await warcraftLogsDiscoveryRepository.saveEvaluation({
      id: discovery.id,
      status,
      outcome,
      linkedRunIds,
      nextAttemptAt: nextInMs == null ? null : new Date(now.getTime() + nextInMs).toISOString(),
      attemptedAt: nowIso,
    });
    const log = { reportCode: discovery.reportCode, messageId: discovery.messageId, status, outcome, linkedRuns: linkedRunIds, settled: nextInMs == null };
    (status === "IGNORED" || status === "NEEDS_REVIEW" ? console.warn : console.log)("[wcl-discovery] evaluated", log);
    return { reportCode: discovery.reportCode, status, outcome, linkedRuns: linkedRunIds.length };
  };

  try {
    const fetched = await fetchReport(discovery.reportCode, { reuseCached: true, now });
    if ("failure" in fetched) {
      // WCL answers "not found" alike for a missing, a private and a not-yet-visible report,
      // so that is retried like an outage (back off) and only given up at the age limit.
      if (expired) {
        const linked = discovery.status === "MATCHED" || discovery.status === "NEEDS_REVIEW";
        return save(linked ? discovery.status : "IGNORED", `EXPIRED_${fetched.failure}`, [], null);
      }
      const backoff = Math.min(
        WCL_DISCOVERY_POLICY.maxBackoffHours * 60 * MINUTE,
        WCL_DISCOVERY_POLICY.retryMinutes * MINUTE * 2 ** Math.min(discovery.attempts, 10),
      );
      return save(discovery.status === "IGNORED" ? "PENDING" : discovery.status, fetched.failure, [], backoff);
    }
    const { report } = fetched;
    const policy = WCL_FIGHT_ASSIGNMENT_POLICY;
    const pad = (policy.openWindowMaxHours * 3600 + policy.toleranceSeconds) * 1000;
    const candidates = await runWarcraftLogsRepository.loadStartedCandidates({
      startedFrom: new Date(Date.parse(report.startAt) - pad).toISOString(),
      startedTo: new Date(Date.parse(report.endAt) + policy.toleranceSeconds * 1000).toISOString(),
    });
    const decision = evaluateReportDiscovery({
      report: report.metadata,
      candidates,
      assignedFights: await runWarcraftLogsRepository.assignedElsewhere(report.id, ""),
      postedAtMs: Date.parse(discovery.postedAt),
      nowMs: now.getTime(),
      attempts: discovery.attempts,
      previousStatus: discovery.status,
    });
    for (const runId of decision.linkRunIds) {
      const { created } = await linkDiscoveredReport({
        runId,
        reportId: report.id,
        discordMessageId: discovery.messageId,
        discordAuthorId: discovery.authorId,
        now,
      });
      if (created) console.log("[wcl-discovery] linked", { reportCode: discovery.reportCode, runId });
    }
    return save(decision.status, decision.outcome, decision.linkRunIds, decision.nextAttemptInMs);
  } catch (error) {
    console.error("[wcl-discovery] evaluation failed", { reportCode: discovery.reportCode, messageId: discovery.messageId }, error);
    return save(discovery.status, "INTERNAL_ERROR", [], expired ? null : WCL_DISCOVERY_POLICY.retryMinutes * MINUTE);
  }
}
