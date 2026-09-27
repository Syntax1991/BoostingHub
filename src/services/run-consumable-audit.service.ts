import {
  assertCanViewRunConsumableAudit,
  canViewRunConsumableAudit,
  type AuthenticatedUser,
} from "@/auth/authorization";
import { consumableSpellIds } from "@/lib/consumable-catalog";
import { DomainError } from "@/lib/errors";
import { findRaidCatalogById, raidContentDisplayName } from "@/lib/wow-raid-catalog";
import {
  warcraftLogsApiClient,
  type WarcraftLogsReportFight,
} from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import {
  runConsumableAuditRepository,
  type ConsumableAuditFailureCode,
  type RunConsumableAuditRunContext,
} from "@/repositories/run-consumable-audit.repository";
import {
  runWarcraftLogsRepository,
  type RunWarcraftLogsFightRecord,
} from "@/repositories/run-warcraft-logs.repository";
import {
  CONSUMABLE_PRE_PULL_WINDOW_MS,
  extractConsumableAudit,
  mergeExtractedAudits,
  type ExtractedConsumableAudit,
} from "@/services/consumable-audit-extract";
import {
  CONSUMABLE_AUDIT_POLICY,
  buildFightRefs,
  evaluatePlayerConsumables,
  healthstoneApplicability,
  type FightRef,
  type HealthstoneApplicability,
  type PlayerConsumableAudit,
} from "@/services/consumable-audit-policy";
import { autoAuditState, type AutoAuditState } from "@/services/consumable-auto-audit-policy";
import {
  WCL_RUN_ACTION_COOLDOWN_SECONDS,
  runWarcraftLogsService,
  type RunWarcraftLogsView,
} from "@/services/run-warcraft-logs.service";

/** One cooldown covers every WCL-triggering action of a Run. */
export const CONSUMABLE_AUDIT_REFRESH_COOLDOWN_SECONDS = WCL_RUN_ACTION_COOLDOWN_SECONDS;

export type RunConsumableAuditFightView = FightRef & {
  reportCode: string;
  contentLabel: string | null;
  durationMs: number;
  healthstone: HealthstoneApplicability;
};

export type RunConsumableAuditView = {
  runId: string;
  wclConfigured: boolean;
  /** Linking and analysis are offered for COMPLETED Runs only. */
  canAnalyze: boolean;
  lookbackSeconds: number;
  /** Report → fight → Run association for this Run. */
  logs: RunWarcraftLogsView;
  analyzedAt: string | null;
  analyzedByName: string | null;
  /** The latest analysis ran automatically after completion. */
  autoAnalyzed: boolean;
  /** Pending / given-up automatic audit; null when it does not apply. */
  autoAudit: AutoAuditState;
  lastAttemptAt: string | null;
  lastFailure: ConsumableAuditFailureCode | null;
  /** The ASSIGNED fights changed since the snapshot was taken — re-analyze. */
  stale: boolean;
  snapshot: {
    fights: RunConsumableAuditFightView[];
    players: PlayerConsumableAudit[];
    summary: {
      players: number;
      withLogData: number;
      withoutLogData: number;
      fights: number;
      kills: number;
      deaths: number;
      playersWithWarnings: number;
    };
  } | null;
};

export type AnalyzeRunConsumablesOutcome =
  | { status: "ANALYZED"; players: number; fights: number }
  | { status: "FAILED"; failure: ConsumableAuditFailureCode };

const fightKey = (reportCode: string, wclFightId: number) => `${reportCode}#${wclFightId}`;

async function loadAuthorizedRun(user: AuthenticatedUser, runId: string): Promise<RunConsumableAuditRunContext> {
  const run = await runConsumableAuditRepository.findRunContext(runId);
  if (!run) {
    throw new DomainError("NOT_FOUND", "Run was not found.", 404);
  }
  // Authorize before any audit row, association, participant list or WCL call.
  assertCanViewRunConsumableAudit(user, run);
  return run;
}

async function buildView(run: RunConsumableAuditRunContext): Promise<RunConsumableAuditView> {
  const [audit, logs] = await Promise.all([
    runConsumableAuditRepository.findByRunId(run.id),
    runWarcraftLogsService.buildView(run),
  ]);
  const base: RunConsumableAuditView = {
    runId: run.id,
    wclConfigured: warcraftLogsApiClient.isConfigured(),
    canAnalyze: run.status === "COMPLETED",
    lookbackSeconds: CONSUMABLE_AUDIT_POLICY.deathLookbackSeconds,
    logs,
    analyzedAt: audit?.analyzedAt ?? null,
    analyzedByName: audit?.analyzedByName ?? null,
    autoAnalyzed: audit?.autoAnalyzed ?? false,
    autoAudit: autoAuditState({
      status: run.status,
      completedAt: run.completedAt,
      hasReports: logs.reports.length > 0,
      audit,
    }),
    lastAttemptAt: audit?.lastAttemptAt ?? null,
    lastFailure: audit?.lastFailure ?? null,
    stale: false,
    snapshot: null,
  };
  if (!audit?.analyzedAt) return base;

  const { fights, players } = await runConsumableAuditRepository.findSnapshot(audit.id);
  const assignedKeys = new Set(
    logs.fights.filter((row) => row.status === "ASSIGNED").map((row) => fightKey(row.reportCode, row.wclFightId)),
  );
  const snapshotKeys = new Set(fights.map((fight) => fightKey(fight.reportCode, fight.wclFightId)));
  const stale = assignedKeys.size !== snapshotKeys.size || [...assignedKeys].some((key) => !snapshotKeys.has(key));

  const fightRefs = buildFightRefs(fights);
  const contentLabels = new Map(
    run.contents.map((content) => {
      const raid = findRaidCatalogById(content.raidId);
      return [content.id, raid ? raidContentDisplayName(raid.id, raid.name) : null] as const;
    }),
  );
  const showContent = run.contents.length > 1;
  const evaluated = players.map((player) => evaluatePlayerConsumables(player, fights, fightRefs));
  return {
    ...base,
    stale,
    snapshot: {
      fights: fights.map((fight) => ({
        ...fightRefs.get(fight.id)!,
        reportCode: fight.reportCode,
        contentLabel: showContent && fight.raidContentId ? (contentLabels.get(fight.raidContentId) ?? null) : null,
        durationMs: Math.max(0, fight.endMs - fight.startMs),
        healthstone: healthstoneApplicability(fight),
      })),
      players: evaluated,
      summary: {
        players: evaluated.length,
        withLogData: evaluated.filter((player) => player.hasLogData).length,
        withoutLogData: evaluated.filter((player) => !player.hasLogData).length,
        fights: fights.length,
        kills: fights.filter((fight) => fight.kill).length,
        deaths: evaluated.reduce((sum, player) => sum + player.deaths.length, 0),
        playersWithWarnings: evaluated.filter((player) => player.warningCount > 0).length,
      },
    },
  };
}

/** Assigned rows → WCL fight shape, with participants from the cached report metadata. */
export function toReportFights(
  rows: RunWarcraftLogsFightRecord[],
  metadataFights: WarcraftLogsReportFight[],
): Array<WarcraftLogsReportFight & { raidContentId: string | null }> {
  const byId = new Map(metadataFights.map((fight) => [fight.id, fight]));
  return rows.map((row) => ({
    id: row.wclFightId,
    encounterId: row.encounterId,
    name: row.encounterName,
    startTime: row.startMs,
    endTime: row.endMs,
    kill: row.kill,
    difficulty: row.difficulty,
    friendlyPlayers: byId.get(row.wclFightId)?.friendlyPlayers ?? null,
    raidContentId: row.raidContentId,
  }));
}

/**
 * Run Consumables Audit — ADMIN and the Run's RAID_LEAD only (see
 * canViewRunConsumableAudit). Reads are database-only; Warcraft Logs is only
 * contacted by an explicit, authorized action. The audit is built from the
 * Run's ASSIGNED fights only — never from a whole report.
 */
export const runConsumableAuditService = {
  async getAuditView(user: AuthenticatedUser, runId: string): Promise<RunConsumableAuditView> {
    const run = await loadAuthorizedRun(user, runId);
    return buildView(run);
  },

  /**
   * Run-detail entry point. Returns null — without touching audit data — for
   * anyone the audit is not for, and for Runs that are not COMPLETED.
   */
  async getAuditViewForRunDetail(
    user: AuthenticatedUser,
    run: { id: string; raidLeadId: string; status: string },
  ): Promise<RunConsumableAuditView | null> {
    if (!canViewRunConsumableAudit(user, run) || run.status !== "COMPLETED") {
      return null;
    }
    return this.getAuditView(user, run.id);
  },

  async analyze(
    user: AuthenticatedUser,
    input: { runId: string },
    now: () => Date = () => new Date(),
    options: { skipCooldown?: boolean } = {},
  ): Promise<AnalyzeRunConsumablesOutcome> {
    const run = await loadAuthorizedRun(user, input.runId);
    return analyzeRun(run, user.id, now, options);
  },
};

/**
 * Build the Run's audit from its ASSIGNED fights. No authorization here:
 * callers are the authorized manager action or the system auto-audit job
 * (actorId null, auto flag set).
 */
export async function analyzeRun(
  run: RunConsumableAuditRunContext,
  actorId: string | null,
  now: () => Date = () => new Date(),
  options: { skipCooldown?: boolean; auto?: boolean } = {},
): Promise<AnalyzeRunConsumablesOutcome> {
  if (run.status !== "COMPLETED") {
    throw new DomainError(
      "CONSUMABLE_AUDIT_RUN_NOT_COMPLETED",
      "The consumables audit is available once the run is completed.",
      409,
    );
  }

  const associations = await runWarcraftLogsRepository.listAssociations(run.id);
  if (associations.length === 0) {
    throw new DomainError("CONSUMABLE_AUDIT_REPORT_REQUIRED", "Link a Warcraft Logs report first.");
  }

  const attemptedAt = now();
  const existing = await runConsumableAuditRepository.findByRunId(run.id);
  if (existing && !options.skipCooldown) {
    const elapsedMs = attemptedAt.getTime() - Date.parse(existing.lastAttemptAt);
    if (elapsedMs < CONSUMABLE_AUDIT_REFRESH_COOLDOWN_SECONDS * 1000) {
      throw new DomainError(
        "CONSUMABLE_AUDIT_REFRESH_COOLDOWN",
        `This run was analyzed moments ago. Try again in ${Math.ceil(
          (CONSUMABLE_AUDIT_REFRESH_COOLDOWN_SECONDS * 1000 - elapsedMs) / 1000,
        )}s.`,
        429,
      );
    }
  }

  const fail = async (failure: ConsumableAuditFailureCode): Promise<AnalyzeRunConsumablesOutcome> => {
    // Records the attempt; the previous snapshot stays untouched.
    await runConsumableAuditRepository.recordFailedAttempt({
      runId: run.id,
      failure,
      attemptedAt: attemptedAt.toISOString(),
    });
    return { status: "FAILED", failure };
  };

  const assigned = (await runWarcraftLogsRepository.listRunFights(run.id)).filter(
    (row) => row.status === "ASSIGNED",
  );
  if (assigned.length === 0) return fail("NO_RELEVANT_FIGHTS");
  if (!warcraftLogsApiClient.isConfigured()) return fail("NOT_CONFIGURED");

  const participants = await runConsumableAuditRepository.listParticipants(run.id);
  const parts: ExtractedConsumableAudit[] = [];
  // One batched events request per linked report — never per player or death.
  for (const association of associations) {
    const rows = assigned.filter((row) => row.reportId === association.report.id);
    if (rows.length === 0) continue;
    const fights = toReportFights(rows, association.report.metadata.fights);
    const events = await warcraftLogsApiClient.fetchReportConsumableEvents({
      code: association.report.code,
      // Only this Run's fights: deaths and pull snapshots are fight-scoped;
      // casts are time-windowed and then attributed to these fights only.
      fightIds: fights.map((fight) => fight.id),
      startTime: Math.min(...fights.map((fight) => fight.startTime)),
      endTime: Math.max(...fights.map((fight) => fight.endTime)),
      castSpellIds: consumableSpellIds("CAST"),
      castLeadMs: CONSUMABLE_PRE_PULL_WINDOW_MS,
    });
    if (events.status === "NOT_FOUND") return fail("REPORT_NOT_FOUND");
    if (events.status === "NOT_CONFIGURED") return fail("NOT_CONFIGURED");
    if (events.status !== "SUCCESS") return fail("WCL_UNAVAILABLE");
    parts.push(
      extractConsumableAudit({
        report: association.report.metadata,
        fights,
        events: events.events,
        participants,
      }),
    );
  }

  const extracted = mergeExtractedAudits(parts);
  await runConsumableAuditRepository.replaceSnapshot({
    runId: run.id,
    analyzedAt: attemptedAt.toISOString(),
    analyzedById: actorId,
    auto: options.auto === true,
    extracted,
  });
  return { status: "ANALYZED", players: extracted.players.length, fights: extracted.fights.length };
}
