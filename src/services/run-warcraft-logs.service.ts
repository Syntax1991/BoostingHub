import {
  assertCanViewRunConsumableAudit,
  canViewRunConsumableAudit,
  type AuthenticatedUser,
} from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { trustedWarcraftLogsReportAuthorIds } from "@/lib/warcraft-logs/config";
import { warcraftLogsApiClient } from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import {
  runConsumableAuditRepository,
  type ConsumableAuditFailureCode,
  type RunConsumableAuditRunContext,
} from "@/repositories/run-consumable-audit.repository";
import {
  runWarcraftLogsRepository,
  type RunWarcraftLogsFightRecord,
  type WarcraftLogsReportRecord,
  type WarcraftLogsReportSource,
} from "@/repositories/run-warcraft-logs.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import {
  WCL_FIGHT_ASSIGNMENT_POLICY,
  assignReportFights,
  type WclFightReason,
  type WclFightStatus,
} from "@/services/wcl-fight-assignment";
import { overlapFightKey, realPullsOfRun } from "@/services/wcl-report-overlap";

/**
 * Report → fight → Run association for the Run Consumables Audit.
 * ADMIN and the Run's RAID_LEAD only (canViewRunConsumableAudit = canManageRun),
 * enforced here before any database read of associations or any WCL request.
 */

/** Metadata fetched this recently for another Run is reused instead of re-fetched. */
export const WCL_REPORT_METADATA_REUSE_SECONDS = 600;
/** Minimum spacing between WCL-triggering actions for one Run (shared rate limit). */
export const WCL_RUN_ACTION_COOLDOWN_SECONDS = 60;

export type WclAssociationFailure = Extract<
  ConsumableAuditFailureCode,
  "NOT_CONFIGURED" | "REPORT_NOT_FOUND" | "WCL_UNAVAILABLE"
>;

export type ScanSummary = { assigned: number; needsReview: number; ignored: number };

export type RunWarcraftLogsFightView = {
  id: string;
  reportCode: string;
  wclFightId: number;
  encounterName: string;
  /** "Ula'tek · Pull 3 (wipe)" within this Run's list. */
  label: string;
  kill: boolean;
  startAt: string;
  endAt: string;
  status: WclFightStatus;
  manual: boolean;
  reasons: WclFightReason[];
  rosterMatched: number | null;
  rosterSize: number | null;
};

export type RunWarcraftLogsView = {
  runWindow: { startedAt: string | null; completedAt: string | null };
  toleranceSeconds: number;
  reports: Array<{
    code: string;
    title: string | null;
    url: string;
    startAt: string;
    endAt: string;
    lastScannedAt: string | null;
    /** When the report was linked to this Run. */
    attachedAt: string;
    attachedByName: string | null;
    /** MANUAL or DISCORD_BOT (posted by the trusted log bot in the Run channel). */
    source: WarcraftLogsReportSource;
    assigned: number;
    needsReview: number;
    ignored: number;
    /** Wall-clock span of this Run's ASSIGNED fights in the report. */
    assignedFrom: string | null;
    assignedTo: string | null;
    /** Other Runs using the same report — valid, not an error. */
    sharedWithRuns: number;
    /**
     * This report's ASSIGNED fights another linked report also logged (two
     * loggers of one raid). Valid — the Consumables audit counts each pull once.
     */
    overlappingFights: number;
  }>;
  fights: RunWarcraftLogsFightView[];
  needsReview: number;
};

export function warcraftLogsReportUrl(code: string): string {
  return `https://www.warcraftlogs.com/reports/${encodeURIComponent(code)}`;
}

async function loadAuthorizedCompletedRun(user: AuthenticatedUser, runId: string) {
  const run = await runConsumableAuditRepository.findRunContext(runId);
  if (!run) throw new DomainError("NOT_FOUND", "Run was not found.", 404);
  assertCanViewRunConsumableAudit(user, run);
  if (run.status !== "COMPLETED") {
    throw new DomainError(
      "CONSUMABLE_AUDIT_RUN_NOT_COMPLETED",
      "Warcraft Logs reports can be linked once the run is completed.",
      409,
    );
  }
  return run;
}

async function assertCooldown(runId: string, now: Date): Promise<void> {
  const [audit, associations] = await Promise.all([
    runConsumableAuditRepository.findByRunId(runId),
    runWarcraftLogsRepository.listAssociations(runId),
  ]);
  const last = Math.max(
    audit ? Date.parse(audit.lastAttemptAt) : 0,
    ...associations.flatMap((row) => (row.lastScannedAt ? [Date.parse(row.lastScannedAt)] : [])),
  );
  const elapsed = now.getTime() - last;
  if (elapsed < WCL_RUN_ACTION_COOLDOWN_SECONDS * 1000) {
    throw new DomainError(
      "CONSUMABLE_AUDIT_REFRESH_COOLDOWN",
      `Warcraft Logs was queried for this run moments ago. Try again in ${Math.ceil(
        (WCL_RUN_ACTION_COOLDOWN_SECONDS * 1000 - elapsed) / 1000,
      )}s.`,
      429,
    );
  }
}

export async function fetchReport(
  code: string,
  options: { reuseCached: boolean; now: Date },
): Promise<{ report: WarcraftLogsReportRecord } | { failure: WclAssociationFailure }> {
  if (options.reuseCached) {
    const cached = await runWarcraftLogsRepository.findReportByCode(code);
    if (cached && options.now.getTime() - Date.parse(cached.fetchedAt) < WCL_REPORT_METADATA_REUSE_SECONDS * 1000) {
      return { report: cached };
    }
  }
  if (!warcraftLogsApiClient.isConfigured()) return { failure: "NOT_CONFIGURED" };
  const result = await warcraftLogsApiClient.fetchReportMetadata(code);
  if (result.status === "NOT_FOUND") return { failure: "REPORT_NOT_FOUND" };
  if (result.status === "NOT_CONFIGURED") return { failure: "NOT_CONFIGURED" };
  if (result.status !== "SUCCESS") return { failure: "WCL_UNAVAILABLE" };
  return { report: await runWarcraftLogsRepository.upsertReport(result.report, options.now.toISOString()) };
}

/** Assign one report's fights for one Run and persist atomically. Database-only. */
async function scan(
  run: RunConsumableAuditRunContext,
  report: WarcraftLogsReportRecord,
  userId: string | null,
  now: Date,
): Promise<ScanSummary> {
  const policy = WCL_FIGHT_ASSIGNMENT_POLICY;
  const pad = (policy.openWindowMaxHours * 3600 + policy.toleranceSeconds) * 1000;
  const { target, others } = await runWarcraftLogsRepository.loadAssignmentCandidates({
    targetRunId: run.id,
    startedFrom: new Date(Date.parse(report.startAt) - pad).toISOString(),
    startedTo: new Date(Date.parse(report.endAt) + policy.toleranceSeconds * 1000).toISOString(),
  });
  const assignments = assignReportFights({
    report: report.metadata,
    target,
    others,
    assignedElsewhere: await runWarcraftLogsRepository.assignedElsewhere(report.id, run.id),
    raidIdByWclEncounter: (await raidRepository.loadCatalog()).raidIdByWclEncounterId,
  });
  await runWarcraftLogsRepository.applyScan({
    runId: run.id,
    reportId: report.id,
    createdById: userId,
    assignments,
    scannedAt: now.toISOString(),
  });
  const fights = (await runWarcraftLogsRepository.listRunFights(run.id)).filter((row) => row.reportId === report.id);
  return {
    assigned: fights.filter((row) => row.status === "ASSIGNED").length,
    needsReview: fights.filter((row) => row.status === "NEEDS_REVIEW").length,
    ignored: fights.filter((row) => row.status === "IGNORED").length,
  };
}

function fightLabels(fights: RunWarcraftLogsFightRecord[]): Map<string, string> {
  const pulls = new Map<string, number>();
  for (const fight of fights) pulls.set(fight.encounterName, (pulls.get(fight.encounterName) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const fight of fights) {
    const pull = (seen.get(fight.encounterName) ?? 0) + 1;
    seen.set(fight.encounterName, pull);
    const multiple = (pulls.get(fight.encounterName) ?? 1) > 1;
    labels.set(fight.id, `${fight.encounterName}${multiple ? ` · Pull ${pull}` : ""}${fight.kill ? "" : " (wipe)"}`);
  }
  return labels;
}

/**
 * Re-fetch every linked report and re-assign its fights for one Run. No
 * authorization here: callers are the authorized manager action or the
 * system auto-audit job (actorId null).
 */
export async function rescanRun(
  run: RunConsumableAuditRunContext,
  actorId: string | null,
  now: Date,
): Promise<{ status: "RESCANNED"; summary: ScanSummary } | { status: "FAILED"; failure: WclAssociationFailure }> {
  const associations = await runWarcraftLogsRepository.listAssociations(run.id);
  const reports: WarcraftLogsReportRecord[] = [];
  // Fetch everything first: a failure leaves every existing association untouched.
  for (const association of associations) {
    const fetched = await fetchReport(association.report.code, { reuseCached: false, now });
    if ("failure" in fetched) return { status: "FAILED", failure: fetched.failure };
    reports.push(fetched.report);
  }
  const summary: ScanSummary = { assigned: 0, needsReview: 0, ignored: 0 };
  for (const report of reports) {
    const part = await scan(run, report, actorId, now);
    summary.assigned += part.assigned;
    summary.needsReview += part.needsReview;
    summary.ignored += part.ignored;
  }
  return { status: "RESCANNED", summary };
}

/**
 * Link a report found by the trusted log bot to a Run — the one attach path
 * for both sources (a link in the Run's own channel, and central discovery
 * from a dedicated log channel). Idempotent; fights are assigned later by the
 * automatic audit's re-scan. A new link makes the Run due for the automatic
 * audit again, with a fresh attempt budget.
 */
export async function linkDiscoveredReport(input: {
  runId: string;
  reportId: string;
  discordMessageId: string;
  discordAuthorId: string;
  now: Date;
}): Promise<{ created: boolean }> {
  const result = await runWarcraftLogsRepository.attachWithoutScan({
    runId: input.runId,
    reportId: input.reportId,
    createdById: null,
    source: "DISCORD_BOT",
    discordMessageId: input.discordMessageId,
    discordAuthorId: input.discordAuthorId,
    now: input.now.toISOString(),
  });
  if (result.created) await runConsumableAuditRepository.resetAutoAttempts(input.runId, input.now.toISOString());
  return result;
}

export type DiscordAttachOutcome =
  | { status: "ATTACHED" }
  | { status: "ALREADY_ATTACHED" }
  /**
   * retryable: the bot must try this message again (WCL briefly unavailable or
   * not configured yet). A missing/private report is final — retrying cannot help.
   */
  | { status: "FAILED"; failure: WclAssociationFailure; retryable: boolean };

export const runWarcraftLogsService = {
  /**
   * System attach from the Discord bot: a trusted log bot posted a report
   * link in the Run's own channel. Guards (all server-side, never trusting the
   * bot's filtering): the author is in DISCORD_WCL_REPORT_AUTHOR_IDS, the
   * message came from this Run's stored Discord channel, and the Run is
   * IN_PROGRESS or COMPLETED. Fights are NOT scanned here — the Run's window
   * is still open while it runs; the post-completion auto audit scans them.
   * An already-linked report causes no WCL request.
   */
  async attachFromDiscord(
    input: { runId: string; reportCode: string; channelId: string; messageId: string; authorId: string },
    now: Date = new Date(),
  ): Promise<DiscordAttachOutcome> {
    if (!trustedWarcraftLogsReportAuthorIds().includes(input.authorId)) {
      throw new DomainError("NOT_AUTHORIZED", "This Discord author is not a trusted Warcraft Logs source.", 403);
    }
    const run = await runConsumableAuditRepository.findRunContext(input.runId);
    if (!run) throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    const post = await runDiscordPostRepository.findByRunId(run.id);
    if (!post?.runChannelId || post.runChannelId !== input.channelId) {
      throw new DomainError("NOT_AUTHORIZED", "The report was not posted in this run's Discord channel.", 403);
    }
    if (run.status !== "IN_PROGRESS" && run.status !== "COMPLETED") {
      throw new DomainError(
        "CONSUMABLE_AUDIT_RUN_NOT_COMPLETED",
        "Reports are only linked to runs that are in progress or completed.",
        409,
      );
    }
    if (await runWarcraftLogsRepository.findAssociationByCode(run.id, input.reportCode)) {
      return { status: "ALREADY_ATTACHED" };
    }
    const fetched = await fetchReport(input.reportCode, { reuseCached: true, now });
    if ("failure" in fetched) {
      return { status: "FAILED", failure: fetched.failure, retryable: fetched.failure !== "REPORT_NOT_FOUND" };
    }
    const { created } = await linkDiscoveredReport({
      runId: run.id,
      reportId: fetched.report.id,
      discordMessageId: input.messageId,
      discordAuthorId: input.authorId,
      now,
    });
    return { status: created ? "ATTACHED" : "ALREADY_ATTACHED" };
  },

  /**
   * Attach a report to a completed Run (idempotent) and scan its fights.
   * Report metadata fetched recently for another Run is reused.
   */
  async attachReport(
    user: AuthenticatedUser,
    input: { runId: string; reportCode: string },
    now: Date = new Date(),
  ): Promise<{ status: "ATTACHED"; summary: ScanSummary } | { status: "FAILED"; failure: WclAssociationFailure }> {
    const run = await loadAuthorizedCompletedRun(user, input.runId);
    await assertCooldown(run.id, now);
    const fetched = await fetchReport(input.reportCode, { reuseCached: true, now });
    if ("failure" in fetched) return { status: "FAILED", failure: fetched.failure };
    return { status: "ATTACHED", summary: await scan(run, fetched.report, user.id, now) };
  },

  /** Re-fetch every attached report (new pulls may have been uploaded) and re-scan. */
  async rescan(
    user: AuthenticatedUser,
    input: { runId: string },
    now: Date = new Date(),
  ): Promise<{ status: "RESCANNED"; summary: ScanSummary } | { status: "FAILED"; failure: WclAssociationFailure }> {
    const run = await loadAuthorizedCompletedRun(user, input.runId);
    const associations = await runWarcraftLogsRepository.listAssociations(run.id);
    if (associations.length === 0) {
      throw new DomainError("CONSUMABLE_AUDIT_REPORT_REQUIRED", "Link a Warcraft Logs report first.");
    }
    await assertCooldown(run.id, now);
    return rescanRun(run, user.id, now);
  },

  async detachReport(user: AuthenticatedUser, input: { runId: string; reportCode: string }): Promise<void> {
    const run = await loadAuthorizedCompletedRun(user, input.runId);
    const association = (await runWarcraftLogsRepository.listAssociations(run.id)).find(
      (row) => row.report.code === input.reportCode,
    );
    if (!association) throw new DomainError("NOT_FOUND", "That report is not linked to this run.", 404);
    await runWarcraftLogsRepository.detach({
      runId: run.id,
      reportId: association.report.id,
      reportCode: association.report.code,
    });
  },

  /**
   * Manual review decision. Assigning a fight another Run holds moves it —
   * which also changes that Run, so the manager must be allowed to manage it too.
   */
  async decideFight(
    user: AuthenticatedUser,
    input: { runId: string; fightId: string; assign: boolean },
    now: Date = new Date(),
  ): Promise<void> {
    const run = await loadAuthorizedCompletedRun(user, input.runId);
    const fight = await runWarcraftLogsRepository.findRunFight(run.id, input.fightId);
    if (!fight) throw new DomainError("NOT_FOUND", "That fight is not linked to this run.", 404);
    if (input.assign) {
      const owners = await runWarcraftLogsRepository.findAssignedOwners(fight.reportId, fight.wclFightId, run.id);
      for (const owner of owners) {
        if (!canViewRunConsumableAudit(user, owner)) {
          throw new DomainError(
            "NOT_AUTHORIZED",
            "This fight is assigned to another run you cannot manage. Ask its raid lead or an admin.",
            403,
          );
        }
      }
    }
    await runWarcraftLogsRepository.decideFight({
      runId: run.id,
      fightRowId: fight.id,
      assign: input.assign,
      decidedById: user.id,
      now: now.toISOString(),
    });
  },

  /** Database-only view for an already-authorized Run. */
  async buildView(run: RunConsumableAuditRunContext): Promise<RunWarcraftLogsView> {
    const [associations, fights] = await Promise.all([
      runWarcraftLogsRepository.listAssociations(run.id),
      runWarcraftLogsRepository.listRunFights(run.id),
    ]);
    const runsPerReport = await runWarcraftLogsRepository.countRunsPerReport(
      associations.map((row) => row.report.id),
    );
    const labels = fightLabels(fights);
    // Same projection the Consumables audit uses: each real pull once.
    const overlapping = new Set(
      realPullsOfRun(
        fights.filter((row) => row.status === "ASSIGNED"),
        associations.map((association) => ({ code: association.report.code, attachedAt: association.attachedAt })),
      )
        .filter((pull) => pull.copies.length > 1)
        .flatMap((pull) => pull.copies.map((copy) => copy.key)),
    );
    return {
      runWindow: { startedAt: run.startedAt, completedAt: run.completedAt },
      toleranceSeconds: WCL_FIGHT_ASSIGNMENT_POLICY.toleranceSeconds,
      reports: associations.map((association) => {
        const own = fights.filter((row) => row.reportId === association.report.id);
        const assigned = own.filter((row) => row.status === "ASSIGNED");
        return {
          code: association.report.code,
          title: association.report.title,
          url: warcraftLogsReportUrl(association.report.code),
          startAt: association.report.startAt,
          endAt: association.report.endAt,
          lastScannedAt: association.lastScannedAt,
          attachedAt: association.attachedAt,
          attachedByName: association.createdByName,
          source: association.source,
          assigned: assigned.length,
          needsReview: own.filter((row) => row.status === "NEEDS_REVIEW").length,
          ignored: own.filter((row) => row.status === "IGNORED").length,
          assignedFrom: assigned[0]?.startAt ?? null,
          assignedTo: assigned.at(-1)?.endAt ?? null,
          sharedWithRuns: Math.max(0, (runsPerReport.get(association.report.id) ?? 1) - 1),
          overlappingFights: assigned.filter((row) => overlapping.has(overlapFightKey(row.reportCode, row.wclFightId)))
            .length,
        };
      }),
      fights: fights.map((fight) => ({
        id: fight.id,
        reportCode: fight.reportCode,
        wclFightId: fight.wclFightId,
        encounterName: fight.encounterName,
        label: labels.get(fight.id)!,
        kill: fight.kill,
        startAt: fight.startAt,
        endAt: fight.endAt,
        status: fight.status,
        manual: fight.decision === "MANUAL",
        reasons: fight.reasons,
        rosterMatched: fight.rosterMatched,
        rosterSize: fight.rosterSize,
      })),
      needsReview: fights.filter((row) => row.status === "NEEDS_REVIEW").length,
    };
  },
};
