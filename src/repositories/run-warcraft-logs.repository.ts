import { db, orm } from "@/lib/prisma";
import {
  asNumber,
  asNumberOrNull,
  asString,
  asStringOrNull,
  mapAttendanceStatus,
  mapDifficulty,
  mapRunStatus,
} from "@/lib/persistence";
import type { AttendanceStatus } from "@/models/enums";
import type { WarcraftLogsReportMetadata } from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { identityKey } from "@/services/consumable-audit-extract";
import type {
  FightAssignment,
  RunAssignmentCandidate,
  WclFightReason,
  WclFightStatus,
} from "@/services/wcl-fight-assignment";

type TxOrm = typeof orm;

function txOrmOf(tx: { orm: unknown }): TxOrm {
  return ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
}

/** Not in the raid: excluded from roster-overlap evidence. */
const ABSENT: readonly AttendanceStatus[] = ["NO_SHOW", "EXCUSED", "STANDBY"];

export type WarcraftLogsReportRecord = {
  id: string;
  code: string;
  title: string | null;
  startAt: string;
  endAt: string;
  fetchedAt: string;
  metadata: WarcraftLogsReportMetadata;
};

export type WarcraftLogsReportSource = "MANUAL" | "DISCORD_BOT";

export type RunWarcraftLogsAssociationRecord = {
  id: string;
  runId: string;
  report: WarcraftLogsReportRecord;
  createdByName: string | null;
  source: WarcraftLogsReportSource;
  discordMessageId: string | null;
  discordAuthorId: string | null;
  /** Null until the first fight scan (log-bot attach during IN_PROGRESS). */
  lastScannedAt: string | null;
  /** When the report was linked to this Run. */
  attachedAt: string;
};

export type RunWarcraftLogsFightRecord = {
  id: string;
  runId: string;
  reportId: string;
  reportCode: string;
  wclFightId: number;
  encounterId: number;
  encounterName: string;
  kill: boolean;
  difficulty: number | null;
  startMs: number;
  endMs: number;
  startAt: string;
  endAt: string;
  raidContentId: string | null;
  status: WclFightStatus;
  decision: "AUTO" | "MANUAL";
  reasons: WclFightReason[];
  rosterMatched: number | null;
  rosterSize: number | null;
};

const STATUSES: readonly WclFightStatus[] = ["ASSIGNED", "NEEDS_REVIEW", "IGNORED"];

function parseReasons(value: unknown): WclFightReason[] {
  try {
    const parsed = JSON.parse(asString(value, "[]")) as unknown;
    return Array.isArray(parsed) ? (parsed.filter((row) => typeof row === "string") as WclFightReason[]) : [];
  } catch {
    return [];
  }
}

function mapReport(row: Record<string, unknown>): WarcraftLogsReportRecord {
  return {
    id: asString(row.id),
    code: asString(row.code),
    title: asStringOrNull(row.title),
    startAt: asString(row.startAt),
    endAt: asString(row.endAt),
    fetchedAt: asString(row.fetchedAt),
    metadata: JSON.parse(asString(row.metadataJson, "{}")) as WarcraftLogsReportMetadata,
  };
}

function mapFight(row: Record<string, unknown>, reportCode: string): RunWarcraftLogsFightRecord {
  const status = asString(row.status) as WclFightStatus;
  return {
    id: asString(row.id),
    runId: asString(row.runId),
    reportId: asString(row.reportId),
    reportCode,
    wclFightId: asNumber(row.wclFightId),
    encounterId: asNumber(row.encounterId),
    encounterName: asString(row.encounterName),
    kill: row.kill === true,
    difficulty: asNumberOrNull(row.difficulty),
    startMs: asNumber(row.startMs),
    endMs: asNumber(row.endMs),
    startAt: asString(row.startAt),
    endAt: asString(row.endAt),
    raidContentId: asStringOrNull(row.raidContentId),
    status: STATUSES.includes(status) ? status : "NEEDS_REVIEW",
    decision: row.decision === "MANUAL" ? "MANUAL" : "AUTO",
    reasons: parseReasons(row.reasons),
    rosterMatched: asNumberOrNull(row.rosterMatched),
    rosterSize: asNumberOrNull(row.rosterSize),
  };
}

function fightRow(input: {
  assignment: FightAssignment;
  runId: string;
  reportId: string;
  associationId: string;
  now: string;
}) {
  const { assignment: a } = input;
  return {
    id: crypto.randomUUID(),
    associationId: input.associationId,
    runId: input.runId,
    reportId: input.reportId,
    wclFightId: a.wclFightId,
    encounterId: a.encounterId,
    encounterName: a.encounterName,
    kill: a.kill,
    difficulty: a.difficulty,
    startMs: a.startMs,
    endMs: a.endMs,
    startAt: new Date(a.startAtMs).toISOString(),
    endAt: new Date(a.endAtMs).toISOString(),
    raidContentId: a.raidContentId,
    status: a.status,
    decision: "AUTO",
    reasons: JSON.stringify(a.reasons),
    rosterMatched: a.rosterMatched,
    rosterSize: a.rosterSize,
    decidedById: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export const runWarcraftLogsRepository = {
  async findReportByCode(code: string): Promise<WarcraftLogsReportRecord | null> {
    const row = await orm.WarcraftLogsReport.where({ code }).first();
    return row ? mapReport(row as Record<string, unknown>) : null;
  },

  /** Shared report cache — one row per WCL report code, reused by every Run. */
  async upsertReport(metadata: WarcraftLogsReportMetadata, fetchedAt: string): Promise<WarcraftLogsReportRecord> {
    const fields = {
      title: metadata.title,
      startAt: new Date(metadata.startTime).toISOString(),
      endAt: new Date(metadata.endTime).toISOString(),
      regionSlug: metadata.regionSlug,
      metadataJson: JSON.stringify(metadata),
      fetchedAt,
      updatedAt: fetchedAt,
    };
    const existing = await orm.WarcraftLogsReport.where({ code: metadata.code }).first();
    if (existing) {
      await orm.WarcraftLogsReport.where({ code: metadata.code }).update(fields);
    } else {
      try {
        await orm.WarcraftLogsReport.create({ id: crypto.randomUUID(), code: metadata.code, ...fields, createdAt: fetchedAt });
      } catch (error) {
        // Lost a concurrent create race for the same report: update instead.
        if (!(await orm.WarcraftLogsReport.where({ code: metadata.code }).first())) throw error;
        await orm.WarcraftLogsReport.where({ code: metadata.code }).update(fields);
      }
    }
    return (await this.findReportByCode(metadata.code))!;
  },

  async listAssociations(runId: string): Promise<RunWarcraftLogsAssociationRecord[]> {
    const rows = (await orm.RunWarcraftLogsReport.where({ runId })
      .include("report")
      .include("createdBy")
      .all()) as Array<Record<string, unknown>>;
    return rows
      .map((row) => ({
        id: asString(row.id),
        runId: asString(row.runId),
        report: mapReport(row.report as Record<string, unknown>),
        createdByName: row.createdBy ? asStringOrNull((row.createdBy as Record<string, unknown>).name) : null,
        source: (row.source === "DISCORD_BOT" ? "DISCORD_BOT" : "MANUAL") as WarcraftLogsReportSource,
        discordMessageId: asStringOrNull(row.discordMessageId),
        discordAuthorId: asStringOrNull(row.discordAuthorId),
        lastScannedAt: asStringOrNull(row.lastScannedAt),
        attachedAt: asString(row.createdAt),
      }))
      .sort((a, b) => a.report.startAt.localeCompare(b.report.startAt));
  },

  /** The Run's association for a report code, if attached. */
  async findAssociationByCode(runId: string, code: string): Promise<RunWarcraftLogsAssociationRecord | null> {
    return (await this.listAssociations(runId)).find((row) => row.report.code === code) ?? null;
  },

  /**
   * Link a report to a Run without scanning fights (idempotent). Used for a
   * log-bot link while the Run is still running: fights are assigned once the
   * Run's window is closed.
   */
  async attachWithoutScan(input: {
    runId: string;
    reportId: string;
    createdById: string | null;
    source: WarcraftLogsReportSource;
    discordMessageId: string | null;
    discordAuthorId: string | null;
    now: string;
  }): Promise<{ created: boolean }> {
    if (await orm.RunWarcraftLogsReport.where({ runId: input.runId, reportId: input.reportId }).first()) {
      return { created: false };
    }
    try {
      await orm.RunWarcraftLogsReport.create({
        id: crypto.randomUUID(),
        runId: input.runId,
        reportId: input.reportId,
        createdById: input.createdById,
        source: input.source,
        discordMessageId: input.discordMessageId,
        discordAuthorId: input.discordAuthorId,
        lastScannedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      });
      return { created: true };
    } catch (error) {
      // Lost a concurrent attach of the same report: that is the same outcome.
      if (await orm.RunWarcraftLogsReport.where({ runId: input.runId, reportId: input.reportId }).first()) {
        return { created: false };
      }
      throw error;
    }
  },

  /** runId → when its newest report was linked; Runs without a report are absent (one query). */
  async latestAttachedAtByRunIds(runIds: string[]): Promise<Map<string, string>> {
    if (runIds.length === 0) return new Map();
    const rows = (await orm.RunWarcraftLogsReport.where((row) => row.runId.in(runIds))
      .select("runId", "createdAt")
      .all()) as Array<{ runId: string; createdAt: string }>;
    const latest = new Map<string, string>();
    for (const row of rows) {
      const current = latest.get(row.runId);
      if (!current || Date.parse(row.createdAt) > Date.parse(current)) latest.set(row.runId, row.createdAt);
    }
    return latest;
  },

  /** How many Runs use each report (sharing a report between Runs is normal). */
  async countRunsPerReport(reportIds: string[]): Promise<Map<string, number>> {
    if (reportIds.length === 0) return new Map();
    const rows = (await orm.RunWarcraftLogsReport.where((row) => row.reportId.in(reportIds))
      .select("reportId")
      .all()) as Array<{ reportId: string }>;
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.reportId, (counts.get(row.reportId) ?? 0) + 1);
    return counts;
  },

  async listRunFights(runId: string): Promise<RunWarcraftLogsFightRecord[]> {
    const rows = (await orm.RunWarcraftLogsFight.where({ runId }).include("report").all()) as Array<
      Record<string, unknown>
    >;
    return rows
      .map((row) => mapFight(row, asString((row.report as Record<string, unknown>).code)))
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  },

  async findRunFight(runId: string, fightRowId: string): Promise<RunWarcraftLogsFightRecord | null> {
    const row = (await orm.RunWarcraftLogsFight.where({ id: fightRowId, runId }).include("report").first()) as
      | Record<string, unknown>
      | null;
    return row ? mapFight(row, asString((row.report as Record<string, unknown>).code)) : null;
  },

  /** wclFightId → runId for this report's fights ASSIGNED to Runs other than `runId`. */
  async assignedElsewhere(reportId: string, runId: string): Promise<Map<number, string>> {
    const rows = (await orm.RunWarcraftLogsFight.where({ reportId, status: "ASSIGNED" }).all()) as Array<
      Record<string, unknown>
    >;
    return new Map(
      rows
        .filter((row) => asString(row.runId) !== runId)
        .map((row) => [asNumber(row.wclFightId), asString(row.runId)] as const),
    );
  },

  /** Other Runs currently holding (reportId, wclFightId) as ASSIGNED, with their raid lead. */
  async findAssignedOwners(
    reportId: string,
    wclFightId: number,
    exceptRunId: string,
  ): Promise<Array<{ runId: string; raidLeadId: string }>> {
    const rows = (await orm.RunWarcraftLogsFight.where({ reportId, wclFightId, status: "ASSIGNED" })
      .include("run")
      .all()) as Array<Record<string, unknown>>;
    return rows
      .filter((row) => asString(row.runId) !== exceptRunId)
      .map((row) => ({
        runId: asString(row.runId),
        raidLeadId: asString((row.run as Record<string, unknown>).raidLeadId),
      }));
  },

  /**
   * The target Run plus every started Run whose active window could overlap
   * the report, with lifecycle times, content and roster identity keys.
   * Three queries regardless of how many Runs qualify.
   */
  async loadAssignmentCandidates(input: {
    targetRunId: string;
    startedFrom: string;
    startedTo: string;
  }): Promise<{ target: RunAssignmentCandidate; others: RunAssignmentCandidate[] }> {
    const candidates = await this.loadStartedCandidates(input);
    const target = candidates.find((run) => run.runId === input.targetRunId);
    if (!target) throw new Error("Target run not found for fight assignment.");
    return { target, others: candidates.filter((run) => run.runId !== input.targetRunId) };
  },

  /**
   * Every started IN_PROGRESS / COMPLETED Run whose start lies in the range
   * (plus `targetRunId` whatever its status), with lifecycle times, content
   * and roster identity keys. Three queries regardless of how many qualify.
   * Used by fight assignment and by central report discovery.
   */
  async loadStartedCandidates(input: {
    targetRunId?: string;
    startedFrom: string;
    startedTo: string;
  }): Promise<RunAssignmentCandidate[]> {
    const snapshots = (await orm.RunStartSnapshot.where((row) => row.startedAt.gte(input.startedFrom))
      .where((row) => row.startedAt.lte(input.startedTo))
      .all()) as Array<Record<string, unknown>>;
    const runIds = [
      ...new Set([...(input.targetRunId ? [input.targetRunId] : []), ...snapshots.map((row) => asString(row.runId))]),
    ];
    if (runIds.length === 0) return [];

    const runs = (await orm.Run.where((row) => row.id.in(runIds))
      .include("contents")
      .include("startSnapshot")
      .all()) as Array<Record<string, unknown>>;
    const attendance = (await orm.RunAttendance.where((row) => row.runId.in(runIds))
      .include("rosterEntry", (entry) => entry.include("signup", (signup) => signup.include("character")))
      .all()) as Array<Record<string, unknown>>;

    const rosterKeys = new Map<string, Set<string>>();
    for (const row of attendance) {
      if (ABSENT.includes(mapAttendanceStatus(row.status))) continue;
      const signup = ((row.rosterEntry as Record<string, unknown> | undefined)?.signup ?? {}) as Record<
        string,
        unknown
      >;
      const character = signup.character as Record<string, unknown> | null | undefined;
      if (!character) continue;
      const name = asString(character.name);
      const realm = asString(character.realm);
      if (!name || !realm) continue;
      const runId = asString(row.runId);
      const keys = rosterKeys.get(runId) ?? new Set<string>();
      keys.add(identityKey(name, realm));
      rosterKeys.set(runId, keys);
    }

    const candidates = runs
      .filter((row) => {
        const status = mapRunStatus(row.status);
        return asString(row.id) === input.targetRunId || status === "IN_PROGRESS" || status === "COMPLETED";
      })
      .map((row): RunAssignmentCandidate => {
        const snapshot = row.startSnapshot as Record<string, unknown> | null | undefined;
        const contents = (Array.isArray(row.contents) ? row.contents : []) as Array<Record<string, unknown>>;
        const completedAt = asStringOrNull(row.completedAt);
        return {
          runId: asString(row.id),
          difficulty: mapDifficulty(row.difficulty),
          contents: contents.map((content) => ({ id: asString(content.id), raidId: asString(content.raidId) })),
          startedAtMs: snapshot ? Date.parse(asString(snapshot.startedAt)) : null,
          completedAtMs: completedAt ? Date.parse(completedAt) : null,
          rosterKeys: rosterKeys.get(asString(row.id)) ?? new Set(),
        };
      });
    return candidates;
  },

  /**
   * Attach (idempotently) and apply one scan atomically: AUTO rows for this
   * Run + report are replaced; MANUAL decisions are kept (fight details
   * refreshed). A concurrent scan that would double-ASSIGN a fight fails on
   * the partial unique index and rolls back — nothing half-written remains.
   */
  async applyScan(input: {
    runId: string;
    reportId: string;
    /** Null for a system scan (auto audit). */
    createdById: string | null;
    assignments: FightAssignment[];
    scannedAt: string;
  }): Promise<void> {
    const now = input.scannedAt;
    await db.transaction(async (tx) => {
      const txOrm = txOrmOf(tx);
      let association = (await txOrm.RunWarcraftLogsReport.where({
        runId: input.runId,
        reportId: input.reportId,
      }).first()) as Record<string, unknown> | null;
      if (association) {
        await txOrm.RunWarcraftLogsReport.where({ id: asString(association.id) }).update({
          lastScannedAt: now,
          updatedAt: now,
        });
      } else {
        association = (await txOrm.RunWarcraftLogsReport.create({
          id: crypto.randomUUID(),
          runId: input.runId,
          reportId: input.reportId,
          createdById: input.createdById,
          lastScannedAt: now,
          createdAt: now,
          updatedAt: now,
        })) as Record<string, unknown>;
      }
      const associationId = asString(association.id);

      const existing = (await txOrm.RunWarcraftLogsFight.where({
        runId: input.runId,
        reportId: input.reportId,
      }).all()) as Array<Record<string, unknown>>;
      const manual = new Map(
        existing.filter((row) => row.decision === "MANUAL").map((row) => [asNumber(row.wclFightId), row] as const),
      );
      await txOrm.RunWarcraftLogsFight.where({ runId: input.runId, reportId: input.reportId, decision: "AUTO" })
        .deleteAndCount();

      const inserts: Record<string, unknown>[] = [];
      for (const assignment of input.assignments) {
        const kept = manual.get(assignment.wclFightId);
        if (kept) {
          await txOrm.RunWarcraftLogsFight.where({ id: asString(kept.id) }).update({
            encounterId: assignment.encounterId,
            encounterName: assignment.encounterName,
            kill: assignment.kill,
            difficulty: assignment.difficulty,
            startMs: assignment.startMs,
            endMs: assignment.endMs,
            startAt: new Date(assignment.startAtMs).toISOString(),
            endAt: new Date(assignment.endAtMs).toISOString(),
            raidContentId: assignment.raidContentId,
            rosterMatched: assignment.rosterMatched,
            rosterSize: assignment.rosterSize,
            updatedAt: now,
          });
          continue;
        }
        inserts.push(fightRow({ assignment, runId: input.runId, reportId: input.reportId, associationId, now }));
      }
      if (inserts.length > 0) {
        await txOrm.RunWarcraftLogsFight.createAndCount(inserts as never);
      }
    });
  },

  /**
   * Manual decision. Assign moves the fight: any other Run's ASSIGNED row for
   * the same (report, fight) becomes IGNORED in the same transaction, so the
   * fight is never in two Runs. The caller authorizes those other Runs first.
   */
  async decideFight(input: {
    runId: string;
    fightRowId: string;
    assign: boolean;
    decidedById: string;
    now: string;
  }): Promise<void> {
    await db.transaction(async (tx) => {
      const txOrm = txOrmOf(tx);
      const row = (await txOrm.RunWarcraftLogsFight.where({ id: input.fightRowId, runId: input.runId }).first()) as
        | Record<string, unknown>
        | null;
      if (!row) throw new Error("Fight assignment row not found.");
      const reasons = parseReasons(row.reasons).filter((reason) => reason !== "MANUAL");
      if (input.assign) {
        const others = (await txOrm.RunWarcraftLogsFight.where({
          reportId: asString(row.reportId),
          wclFightId: asNumber(row.wclFightId),
          status: "ASSIGNED",
        }).all()) as Array<Record<string, unknown>>;
        for (const other of others) {
          if (asString(other.runId) === input.runId) continue;
          const otherReasons = parseReasons(other.reasons).filter((reason) => reason !== "MANUAL");
          await txOrm.RunWarcraftLogsFight.where({ id: asString(other.id) }).update({
            status: "IGNORED",
            decision: "MANUAL",
            reasons: JSON.stringify([...otherReasons, "ASSIGNED_TO_OTHER_RUN", "MANUAL"]),
            decidedById: input.decidedById,
            updatedAt: input.now,
          });
        }
      }
      await txOrm.RunWarcraftLogsFight.where({ id: input.fightRowId }).update({
        status: input.assign ? "ASSIGNED" : "IGNORED",
        decision: "MANUAL",
        reasons: JSON.stringify([...reasons.filter((reason) => reason !== "ASSIGNED_TO_OTHER_RUN"), "MANUAL"]),
        decidedById: input.decidedById,
        updatedAt: input.now,
      });
    });
  },

  /**
   * Detach one report from one Run: its association and fight rows, and the
   * audit facts that came from it, go in one transaction. The shared report
   * row is removed only when no other Run still uses it.
   */
  async detach(input: { runId: string; reportId: string; reportCode: string }): Promise<void> {
    await db.transaction(async (tx) => {
      const txOrm = txOrmOf(tx);
      await txOrm.RunWarcraftLogsReport.where({ runId: input.runId, reportId: input.reportId }).deleteAndCount();
      const audit = (await txOrm.RunConsumableAudit.where({ runId: input.runId }).first()) as Record<
        string,
        unknown
      > | null;
      if (audit) {
        await txOrm.RunConsumableAuditFight.where({
          auditId: asString(audit.id),
          reportCode: input.reportCode,
        }).deleteAndCount();
      }
      const stillUsed = await txOrm.RunWarcraftLogsReport.where({ reportId: input.reportId }).first();
      if (!stillUsed) {
        await txOrm.WarcraftLogsReport.where({ id: input.reportId }).deleteAndCount();
      }
    });
  },
};
