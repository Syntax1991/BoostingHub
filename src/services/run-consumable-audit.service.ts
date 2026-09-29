import {
  assertCanViewRunConsumableAudit,
  canViewRunConsumableAudit,
  type AuthenticatedUser,
} from "@/auth/authorization";
import { consumableSpellIds } from "@/lib/consumable-catalog";
import { personalDefensiveSpellIds } from "@/lib/personal-defensive-catalog";
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
  CONSUMABLE_AUDIT_FACTS_VERSION,
  CONSUMABLE_PRE_PULL_WINDOW_MS,
  PERSONAL_DEFENSIVE_FACTS_VERSION,
  combatantCoverageByFight,
  extractConsumableAudit,
  mergeExtractedAudits,
  restrictExtractedToFights,
  type ExtractedConsumableAudit,
} from "@/services/consumable-audit-extract";
import { overlapFightKey, realPullsOfRun, snapshotCoversRealPulls } from "@/services/wcl-report-overlap";
import { wipeCollapseOnsets } from "@/services/wipe-collapse";
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
  /**
   * The snapshot predates played roles (CONSUMABLE_AUDIT_FACTS_VERSION): roles
   * show as unknown and no role-based expectation applies until re-analyzed.
   */
  factsOutdated: boolean;
  /** RunConsumableAudit.factsVersion of the shown snapshot (null without one) — what an outdated one lacks. */
  factsVersion: number | null;
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
      latestReportAttachedAt:
        logs.reports.map((report) => report.attachedAt).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null,
      audit,
    }),
    lastAttemptAt: audit?.lastAttemptAt ?? null,
    lastFailure: audit?.lastFailure ?? null,
    stale: false,
    factsOutdated: false,
    factsVersion: audit?.analyzedAt ? audit.factsVersion : null,
    snapshot: null,
  };
  if (!audit?.analyzedAt) return base;

  const [{ fights, players }, runFights] = await Promise.all([
    runConsumableAuditRepository.findSnapshot(audit.id),
    runWarcraftLogsRepository.listRunFights(run.id),
  ]);
  // Stale = the snapshot no longer holds every unique real pull exactly once
  // (same projection the analysis uses, so a fresh analysis is never stale).
  const pulls = realPullsOfRun(
    runFights.filter((row) => row.status === "ASSIGNED"),
    logs.reports.map((report) => ({ code: report.code, attachedAt: report.attachedAt })),
  );
  const stale = !snapshotCoversRealPulls(
    fights.map((fight) => fightKey(fight.reportCode, fight.wclFightId)),
    pulls,
  );

  const fightRefs = buildFightRefs(fights);
  const contentLabels = new Map(
    run.contents.map((content) => {
      const raid = findRaidCatalogById(content.raidId);
      return [content.id, raid ? raidContentDisplayName(raid.id, raid.name) : null] as const;
    }),
  );
  const showContent = run.contents.length > 1;
  // Facts version 3: defensives recorded and the raid-wipe (boosting-team collapse) context applies.
  // An older snapshot is re-analyzed, never reinterpreted: no collapse context there.
  const current = audit.factsVersion >= PERSONAL_DEFENSIVE_FACTS_VERSION;
  const facts = {
    defensivesRecorded: current,
    wipeCollapseOnsets: current ? wipeCollapseOnsets(players, fights) : undefined,
  };
  const evaluated = players.map((player) =>
    evaluatePlayerConsumables(player, fights, fightRefs, CONSUMABLE_AUDIT_POLICY, facts),
  );
  return {
    ...base,
    stale,
    factsOutdated: audit.factsVersion < CONSUMABLE_AUDIT_FACTS_VERSION,
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
  // Every real pull once, even when two linked reports logged the same raid.
  const pulls = realPullsOfRun(
    assigned,
    associations.map((association) => ({ code: association.report.code, attachedAt: association.attachedAt })),
  );
  const rowByKey = new Map(assigned.map((row) => [overlapFightKey(row.reportCode, row.wclFightId), row]));
  const parts: ExtractedConsumableAudit[] = [];

  // One batched events request per report for the given fights of it — never per player or death.
  const extractFights = async (keys: string[]): Promise<ConsumableAuditFailureCode | null> => {
    for (const association of associations) {
      const rows = keys
        .map((key) => rowByKey.get(key)!)
        .filter((row) => row.reportId === association.report.id);
      if (rows.length === 0) continue;
      const fights = toReportFights(rows, association.report.metadata.fights);
      const events = await warcraftLogsApiClient.fetchReportConsumableEvents({
        code: association.report.code,
        // Only these fights: deaths and pull snapshots are fight-scoped;
        // casts are time-windowed and then attributed to these fights only.
        fightIds: fights.map((fight) => fight.id),
        startTime: Math.min(...fights.map((fight) => fight.startTime)),
        endTime: Math.max(...fights.map((fight) => fight.endTime)),
        // Consumables + the players' own defensive cooldowns: one filter, same request.
        castSpellIds: [...consumableSpellIds("CAST"), ...personalDefensiveSpellIds()],
        castLeadMs: CONSUMABLE_PRE_PULL_WINDOW_MS,
      });
      if (events.status === "NOT_FOUND") return "REPORT_NOT_FOUND";
      if (events.status === "NOT_CONFIGURED") return "NOT_CONFIGURED";
      if (events.status !== "SUCCESS") return "WCL_UNAVAILABLE";
      parts.push(
        extractConsumableAudit({
          report: association.report.metadata,
          fights,
          events: events.events,
          participants,
        }),
      );
    }
    return null;
  };

  // 1. The canonical copy of each pull.
  const selected = pulls.map((pull) => pull.copies[0]!.key);
  const firstFailure = await extractFights(selected);
  if (firstFailure) return fail(firstFailure);

  // 2. A kept copy is incomplete when an audited player took part in the pull
  // without a CombatantInfo snapshot (or it has none at all) while another
  // logger recorded the same pull: read the duplicates of just those pulls
  // (one request per report) and keep the copy with the most snapshots —
  // ties keep the ranking. Facts are never mixed across copies of one pull.
  const coverageOf = () => {
    const coverage = new Map<string, { present: number; snapshots: number }>();
    for (const part of parts) for (const [key, entry] of combatantCoverageByFight(part)) coverage.set(key, entry);
    return coverage;
  };
  const initial = coverageOf();
  const weak = pulls
    .map((pull, index) => ({ pull, index }))
    .filter(({ pull, index }) => {
      if (pull.copies.length < 2) return false;
      const kept = initial.get(selected[index]!);
      return !kept || kept.snapshots === 0 || kept.snapshots < kept.present;
    });
  if (weak.length > 0) {
    const secondFailure = await extractFights(weak.flatMap(({ pull }) => pull.copies.slice(1).map((copy) => copy.key)));
    if (secondFailure) return fail(secondFailure);
    const coverage = coverageOf();
    for (const { pull, index } of weak) {
      const snapshots = (key: string) => coverage.get(key)?.snapshots ?? 0;
      // Stable sort: equal snapshot counts keep the deterministic ranking (canonical first).
      selected[index] = [...pull.copies].sort((a, b) => snapshots(b.key) - snapshots(a.key))[0]!.key;
    }
  }

  const keep = new Set(selected);
  const extracted = mergeExtractedAudits(parts.map((part) => restrictExtractedToFights(part, keep)));
  await runConsumableAuditRepository.replaceSnapshot({
    runId: run.id,
    analyzedAt: attemptedAt.toISOString(),
    analyzedById: actorId,
    auto: options.auto === true,
    extracted,
  });
  return { status: "ANALYZED", players: extracted.players.length, fights: extracted.fights.length };
}
