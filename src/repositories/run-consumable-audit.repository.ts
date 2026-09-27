import { db, orm } from "@/lib/prisma";
import {
  asBoolean,
  asNumber,
  asNumberOrNull,
  asString,
  asStringOrNull,
  mapAttendanceStatus,
  mapCharacterRole,
  mapDifficulty,
  mapParticipation,
  mapRegion,
  mapRunStatus,
  mapWowClass,
} from "@/lib/persistence";
import type { AttendanceStatus, RaidDifficulty, RunStatus } from "@/models/enums";
import type {
  ConsumableAuditMatchStatus,
  ConsumableAuditParticipant,
  ConsumableObservationKindValue,
  ExtractedConsumableAudit,
} from "@/services/consumable-audit-extract";
import type { AuditFightFact, AuditPlayerFact } from "@/services/consumable-audit-policy";

type TxOrm = typeof orm;

export type ConsumableAuditFailureCode =
  | "NOT_CONFIGURED"
  | "REPORT_NOT_FOUND"
  | "NO_RELEVANT_FIGHTS"
  | "WCL_UNAVAILABLE";

const FAILURE_CODES: readonly ConsumableAuditFailureCode[] = [
  "NOT_CONFIGURED",
  "REPORT_NOT_FOUND",
  "NO_RELEVANT_FIGHTS",
  "WCL_UNAVAILABLE",
];
const MATCH_STATUSES: readonly ConsumableAuditMatchStatus[] = ["MATCHED", "NOT_IN_LOG", "NO_CHARACTER_IDENTITY"];
const OBSERVATION_KINDS: readonly ConsumableObservationKindValue[] = [
  "COMBATANT",
  "PARTICIPANT",
  "AURA",
  "CAST",
  "DEATH",
];

/** Attended booster statuses — NO_SHOW / EXCUSED / STANDBY / UNMARKED were not in the raid. */
const AUDITED_ATTENDANCE: readonly AttendanceStatus[] = ["PRESENT", "LATE", "LEFT_EARLY"];

/** Rows per multi-row INSERT — well under PostgreSQL's bind-parameter limit. */
const INSERT_CHUNK = 500;

export type RunConsumableAuditRunContext = {
  id: string;
  raidLeadId: string;
  status: RunStatus;
  difficulty: RaidDifficulty;
  contents: Array<{ id: string; raidId: string }>;
  /** RunStartSnapshot.startedAt / Run.completedAt — the Run's active window. */
  startedAt: string | null;
  completedAt: string | null;
};

export type RunConsumableAuditRecord = {
  id: string;
  runId: string;
  analyzedAt: string | null;
  analyzedByName: string | null;
  lastAttemptAt: string;
  lastFailure: ConsumableAuditFailureCode | null;
  autoAttempts: number;
  autoAnalyzed: boolean;
};

export type RunConsumableAuditSnapshot = {
  fights: AuditFightFact[];
  players: AuditPlayerFact[];
};

function txOrmOf(tx: { orm: unknown }): TxOrm {
  return ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function mapAudit(row: Record<string, unknown>): RunConsumableAuditRecord {
  const analyzer = row.analyzedBy as Record<string, unknown> | undefined | null;
  return {
    id: asString(row.id),
    runId: asString(row.runId),
    analyzedAt: asStringOrNull(row.analyzedAt),
    analyzedByName: analyzer ? asStringOrNull(analyzer.name) : null,
    lastAttemptAt: asString(row.lastAttemptAt),
    lastFailure:
      row.lastFailure == null ? null : pick(row.lastFailure, FAILURE_CODES, "WCL_UNAVAILABLE"),
    autoAttempts: asNumber(row.autoAttempts),
    autoAnalyzed: row.autoAnalyzed === true,
  };
}

async function insertChunked(
  create: (rows: Record<string, unknown>[]) => Promise<number>,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (let index = 0; index < rows.length; index += INSERT_CHUNK) {
    await create(rows.slice(index, index + INSERT_CHUNK));
  }
}

export const runConsumableAuditRepository = {
  /** Only what authorization and fight selection need — no roster/signup payload. */
  async findRunContext(runId: string): Promise<RunConsumableAuditRunContext | null> {
    const row = (await orm.Run.where({ id: runId }).include("contents").include("startSnapshot").first()) as Record<
      string,
      unknown
    > | null;
    if (!row) return null;
    const contents = (Array.isArray(row.contents) ? row.contents : []) as Array<Record<string, unknown>>;
    return {
      id: asString(row.id),
      raidLeadId: asString(row.raidLeadId),
      status: mapRunStatus(row.status),
      difficulty: mapDifficulty(row.difficulty),
      startedAt: row.startSnapshot
        ? asStringOrNull((row.startSnapshot as Record<string, unknown>).startedAt)
        : null,
      completedAt: asStringOrNull(row.completedAt),
      contents: contents
        .map((content) => ({
          id: asString(content.id),
          raidId: asString(content.raidId),
          sortOrder: asNumber(content.sortOrder),
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(({ id, raidId }) => ({ id, raidId })),
    };
  },

  /**
   * Audited boosters: attended BOOSTER roster participants (Character identity)
   * plus the roster's external BOOSTERs (display name only). Two queries.
   */
  async listParticipants(runId: string): Promise<ConsumableAuditParticipant[]> {
    const attendanceRows = (await orm.RunAttendance.include("rosterEntry", (entry) =>
      entry.include("signup", (signup) => signup.include("user").include("character")),
    )
      .where({ runId })
      .all()) as Array<Record<string, unknown>>;

    const participants: ConsumableAuditParticipant[] = [];
    for (const row of attendanceRows) {
      if (!AUDITED_ATTENDANCE.includes(mapAttendanceStatus(row.status))) continue;
      const entry = (row.rosterEntry as Record<string, unknown> | undefined) ?? {};
      const signup = (entry.signup as Record<string, unknown> | undefined) ?? {};
      if (mapParticipation(signup.participationType) !== "BOOSTER") continue;
      const user = (signup.user as Record<string, unknown> | undefined) ?? {};
      const character = signup.character as Record<string, unknown> | undefined | null;
      const roleRaw = signup.publishedRole ?? entry.selectedRole;
      participants.push({
        source: "ATTENDANCE",
        attendanceId: asString(row.id),
        displayName: asString(user.name, "Unknown user"),
        characterName: character ? asString(character.name) : "",
        characterRealm: character ? asString(character.realm) : "",
        characterRegion: character ? mapRegion(character.region) : null,
        warcraftLogsId: character ? asStringOrNull(character.warcraftLogsId) : null,
        wowClass: character ? mapWowClass(character.wowClass) : null,
        role: roleRaw == null ? null : mapCharacterRole(roleRaw),
      });
    }
    participants.sort((a, b) => a.displayName.localeCompare(b.displayName));

    const roster = (await orm.RunRoster.where({ runId }).include("externalBoosters").first()) as
      | Record<string, unknown>
      | null;
    const externals = (Array.isArray(roster?.externalBoosters) ? roster.externalBoosters : []) as Array<
      Record<string, unknown>
    >;
    for (const booster of externals.sort((a, b) => asString(a.createdAt).localeCompare(asString(b.createdAt)))) {
      if (mapParticipation(booster.participationType) !== "BOOSTER") continue;
      participants.push({
        source: "EXTERNAL",
        externalBoosterId: asString(booster.id),
        displayName: asString(booster.name),
        wowClass: mapWowClass(booster.wowClass),
        role: booster.role == null ? null : mapCharacterRole(booster.role),
      });
    }
    return participants;
  },

  /** COMPLETED Runs whose completedAt lies in [from, to] (auto-audit candidates). */
  async listCompletedRunIdsBetween(from: string, to: string): Promise<string[]> {
    const rows = (await orm.Run.where({ status: "COMPLETED" })
      .where((row) => row.completedAt.gte(from))
      .where((row) => row.completedAt.lte(to))
      .select("id")
      .all()) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  },

  async listByRunIds(runIds: string[]): Promise<RunConsumableAuditRecord[]> {
    if (runIds.length === 0) return [];
    const rows = await orm.RunConsumableAudit.where((row) => row.runId.in(runIds)).all();
    return (rows as Record<string, unknown>[]).map(mapAudit);
  },

  /** Count one automatic attempt (creates the audit row if needed). */
  async incrementAutoAttempts(runId: string, now: string): Promise<void> {
    const existing = (await orm.RunConsumableAudit.where({ runId }).first()) as Record<string, unknown> | null;
    if (existing) {
      await orm.RunConsumableAudit.where({ id: asString(existing.id) }).update({
        autoAttempts: asNumber(existing.autoAttempts) + 1,
        updatedAt: now,
      });
      return;
    }
    await orm.RunConsumableAudit.create({
      id: crypto.randomUUID(),
      runId,
      analyzedAt: null,
      analyzedById: null,
      lastAttemptAt: now,
      lastFailure: null,
      autoAttempts: 1,
      autoAnalyzed: false,
      createdAt: now,
      updatedAt: now,
    });
  },

  async findByRunId(runId: string): Promise<RunConsumableAuditRecord | null> {
    const row = await orm.RunConsumableAudit.where({ runId }).include("analyzedBy").first();
    return row ? mapAudit(row as Record<string, unknown>) : null;
  },

  /** Whole snapshot in three queries (fights, players, observations) — no N+1. */
  async findSnapshot(auditId: string): Promise<RunConsumableAuditSnapshot> {
    const [fightRows, playerRows] = await Promise.all([
      orm.RunConsumableAuditFight.where({ auditId }).all(),
      orm.RunConsumableAuditPlayer.where({ auditId }).all(),
    ]);
    const playerIds = (playerRows as Array<Record<string, unknown>>).map((row) => asString(row.id));
    const observationRows =
      playerIds.length === 0
        ? []
        : ((await orm.RunConsumableAuditObservation.where((row) => row.playerId.in(playerIds)).all()) as Array<
            Record<string, unknown>
          >);

    const observationsByPlayer = new Map<string, AuditPlayerFact["observations"]>();
    for (const row of observationRows) {
      const playerId = asString(row.playerId);
      const list = observationsByPlayer.get(playerId) ?? [];
      list.push({
        fightId: asString(row.fightId),
        kind: pick(row.kind, OBSERVATION_KINDS, "PARTICIPANT"),
        category: asStringOrNull(row.category),
        spellId: asNumberOrNull(row.spellId),
        atMs: asNumber(row.atMs),
      });
      observationsByPlayer.set(playerId, list);
    }

    const fights: AuditFightFact[] = (fightRows as Array<Record<string, unknown>>)
      .map((row) => ({
        id: asString(row.id),
        reportCode: asString(row.reportCode),
        wclFightId: asNumber(row.wclFightId),
        encounterName: asString(row.encounterName),
        kill: asBoolean(row.kill),
        startMs: asNumber(row.startMs),
        endMs: asNumber(row.endMs),
        raidContentId: asStringOrNull(row.raidContentId),
        warlockPresent: typeof row.warlockPresent === "boolean" ? row.warlockPresent : null,
        healthstoneUseSeen: asBoolean(row.healthstoneUseSeen),
      }))
      .sort((a, b) => a.startMs - b.startMs);

    const players: AuditPlayerFact[] = (playerRows as Array<Record<string, unknown>>)
      .sort((a, b) => asNumber(a.sortOrder) - asNumber(b.sortOrder))
      .map((row) => ({
        id: asString(row.id),
        displayName: asString(row.displayName),
        characterName: asStringOrNull(row.characterName),
        characterRealm: asStringOrNull(row.characterRealm),
        wowClass: row.wowClass == null ? null : mapWowClass(row.wowClass),
        role: row.role == null ? null : mapCharacterRole(row.role),
        matchStatus: pick(row.matchStatus, MATCH_STATUSES, "NOT_IN_LOG"),
        // Attendance rows always snapshot a character name; external boosters never have one.
        isExternal: row.characterName == null,
        observations: (observationsByPlayer.get(asString(row.id)) ?? []).sort((a, b) => a.atMs - b.atMs),
      }));

    return { fights, players };
  },

  /** Record a failed attempt without touching an existing snapshot. */
  async recordFailedAttempt(input: {
    runId: string;
    failure: ConsumableAuditFailureCode;
    attemptedAt: string;
  }): Promise<void> {
    const existing = await orm.RunConsumableAudit.where({ runId: input.runId }).first();
    if (existing) {
      await orm.RunConsumableAudit.where({ id: asString((existing as Record<string, unknown>).id) }).update({
        lastAttemptAt: input.attemptedAt,
        lastFailure: input.failure,
        updatedAt: input.attemptedAt,
      });
      return;
    }
    await orm.RunConsumableAudit.create({
      id: crypto.randomUUID(),
      runId: input.runId,
      analyzedAt: null,
      analyzedById: null,
      lastAttemptAt: input.attemptedAt,
      lastFailure: input.failure,
      createdAt: input.attemptedAt,
      updatedAt: input.attemptedAt,
    });
  },

  /**
   * Idempotent, atomic replacement of the Run's snapshot. The audit row is
   * updated first so concurrent replacements serialize on its row lock; all
   * previous fights/players/observations are removed before the new facts are
   * inserted, so re-analysis never duplicates rows.
   */
  async replaceSnapshot(input: {
    runId: string;
    analyzedAt: string;
    /** Null for an automatic analysis. */
    analyzedById: string | null;
    auto?: boolean;
    extracted: ExtractedConsumableAudit;
  }): Promise<void> {
    const now = input.analyzedAt;
    const header = {
      analyzedAt: now,
      analyzedById: input.analyzedById,
      autoAnalyzed: input.auto === true,
      lastAttemptAt: now,
      lastFailure: null,
      updatedAt: now,
    };

    // Ensure the row exists outside the replace transaction; a concurrent
    // creator losing the unique(runId) race simply falls through to update.
    if (!(await orm.RunConsumableAudit.where({ runId: input.runId }).first())) {
      try {
        await orm.RunConsumableAudit.create({ id: crypto.randomUUID(), runId: input.runId, ...header, createdAt: now });
      } catch (error) {
        if (!(await orm.RunConsumableAudit.where({ runId: input.runId }).first())) throw error;
      }
    }

    await db.transaction(async (tx) => {
      const txOrm = txOrmOf(tx);
      await txOrm.RunConsumableAudit.where({ runId: input.runId }).update(header);
      const audit = (await txOrm.RunConsumableAudit.where({ runId: input.runId }).first()) as Record<
        string,
        unknown
      >;
      const auditId = asString(audit.id);

      // Observations cascade from both players and fights.
      await txOrm.RunConsumableAuditPlayer.where({ auditId }).deleteAndCount();
      await txOrm.RunConsumableAuditFight.where({ auditId }).deleteAndCount();

      const fightKey = (reportCode: string, wclFightId: number) => `${reportCode}#${wclFightId}`;
      const fightIdByKey = new Map<string, string>();
      const fightRows = input.extracted.fights.map((fight) => {
        const id = crypto.randomUUID();
        fightIdByKey.set(fightKey(fight.reportCode, fight.wclFightId), id);
        return { id, auditId, ...fight };
      });
      const playerRows: Record<string, unknown>[] = [];
      const observationRows: Record<string, unknown>[] = [];
      for (const player of input.extracted.players) {
        const { observations, ...fields } = player;
        const id = crypto.randomUUID();
        playerRows.push({ id, auditId, ...fields });
        for (const observation of observations) {
          // Only facts of fights in this snapshot (the Run's ASSIGNED fights) are kept.
          const fightId = fightIdByKey.get(fightKey(observation.reportCode, observation.wclFightId));
          if (!fightId) continue;
          observationRows.push({
            id: crypto.randomUUID(),
            playerId: id,
            fightId,
            kind: observation.kind,
            category: observation.category,
            spellId: observation.spellId,
            atMs: observation.atMs,
          });
        }
      }

      await insertChunked((rows) => txOrm.RunConsumableAuditFight.createAndCount(rows as never), fightRows);
      await insertChunked((rows) => txOrm.RunConsumableAuditPlayer.createAndCount(rows as never), playerRows);
      await insertChunked(
        (rows) => txOrm.RunConsumableAuditObservation.createAndCount(rows as never),
        observationRows,
      );
    });
  },
};
