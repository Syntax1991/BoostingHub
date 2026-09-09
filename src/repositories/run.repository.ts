import { db, orm } from "@/lib/prisma";
import { DomainError } from "@/lib/errors";
import type { RaidDifficulty, RunStatus, SignupStatus, ParticipationType, CharacterRole } from "@/models/enums";
import {
  asBoolean,
  asNumber,
  asString,
  asStringOrNull,
  mapCharacterRole,
  mapDifficulty,
  mapParticipation,
  mapRunStatus,
  mapSignupStatus,
} from "@/lib/persistence";

export type RunListFilters = {
  difficulty?: RaidDifficulty;
  status?: RunStatus;
  signupsOpen?: boolean;
};

export type SignupOnRun = {
  id: string;
  userId: string;
  status: SignupStatus;
  participationType: ParticipationType;
  isBackup: boolean;
  role: CharacterRole | null;
};

export type RunListRecord = {
  id: string;
  title: string;
  raidId: string;
  raidName: string;
  season: string;
  difficulty: RaidDifficulty;
  scheduledStartAt: string;
  status: RunStatus;
  raidLeadId: string;
  raidLeadName: string;
  notes: string | null;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  signupsOpen: boolean;
  signups: SignupOnRun[];
  roster: {
    id: string;
    state: string;
    version: number;
    publishedAt: string | null;
    draftSelectedCount: number;
  } | null;
};

function mapRun(run: Record<string, unknown>): RunListRecord {
  const raid = (run.raid ?? {}) as Record<string, unknown>;
  const raidLead = (run.raidLead ?? {}) as Record<string, unknown>;
  const signups = Array.isArray(run.signups) ? run.signups : [];
  const roster = run.roster ? (run.roster as Record<string, unknown>) : null;
  const rosterEntries = roster && Array.isArray(roster.entries) ? roster.entries : [];

  return {
    id: asString(run.id),
    title: asString(run.title),
    raidId: asString(run.raidId ?? raid.id),
    raidName: asString(raid.name, "Unknown raid"),
    season: asString(raid.season),
    difficulty: mapDifficulty(run.difficulty),
    scheduledStartAt: asString(run.scheduledStartAt),
    status: mapRunStatus(run.status),
    raidLeadId: asString(run.raidLeadId ?? raidLead.id),
    raidLeadName: asString(raidLead.name, "Unknown lead"),
    notes: asStringOrNull(run.notes),
    desiredTankCount: asNumber(run.desiredTankCount),
    desiredHealerCount: asNumber(run.desiredHealerCount),
    desiredDpsCount: asNumber(run.desiredDpsCount),
    signupsOpen: asBoolean(run.signupsOpen),
    signups: signups.map((row) => {
      const signup = row as Record<string, unknown>;
      return {
        id: asString(signup.id),
        userId: asString(signup.userId),
        status: mapSignupStatus(signup.status),
        participationType: mapParticipation(signup.participationType),
        isBackup: asBoolean(signup.isBackup),
        role: signup.role == null ? null : mapCharacterRole(signup.role),
      };
    }),
    roster: roster
      ? {
          id: asString(roster.id),
          state: asString(roster.state, "DRAFT"),
          version: asNumber(roster.version, 1),
          publishedAt: asStringOrNull(roster.publishedAt),
          draftSelectedCount: rosterEntries.filter((entry) => asBoolean((entry as Record<string, unknown>).selected, true))
            .length,
        }
      : null,
  };
}

export const runRepository = {
  async listUpcoming(filters: RunListFilters = {}): Promise<RunListRecord[]> {
    let query = orm.Run
      .include("raid")
      .include("raidLead")
      .include("signups")
      .include("roster", (roster) => roster.include("entries"))
      .orderBy((run) => run.scheduledStartAt.asc());

    if (filters.difficulty) {
      query = query.where({ difficulty: filters.difficulty });
    }
    if (filters.status) {
      query = query.where({ status: filters.status });
    }
    if (filters.signupsOpen !== undefined) {
      query = query.where({ signupsOpen: filters.signupsOpen });
    }

    const runs = await query.all();
    return runs.map((run) => mapRun(run as Record<string, unknown>));
  },

  async findById(id: string): Promise<RunListRecord | null> {
    const run = await orm.Run
      .where({ id })
      .include("raid")
      .include("raidLead")
      .include("signups")
      .include("roster", (roster) => roster.include("entries"))
      .first();

    return run ? mapRun(run as Record<string, unknown>) : null;
  },

  async listManaged(): Promise<RunListRecord[]> {
    const runs = await orm.Run
      .include("raid")
      .include("raidLead")
      .include("signups")
      .include("roster", (roster) => roster.include("entries"))
      .orderBy((run) => run.scheduledStartAt.asc())
      .all();

    return runs.map((run) => mapRun(run as Record<string, unknown>));
  },

  async countSignups(runId: string): Promise<number> {
    const rows = await orm.RunSignup.where({ runId }).select("id").all();
    return rows.length;
  },

  async create(input: {
    title: string;
    raidId: string;
    difficulty: RaidDifficulty;
    scheduledStartAt: string;
    raidLeadId: string;
    notes: string | null;
    desiredTankCount: number;
    desiredHealerCount: number;
    desiredDpsCount: number;
  }): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      await txOrm.Run.create({
        id,
        title: input.title,
        raidId: input.raidId,
        difficulty: input.difficulty,
        scheduledStartAt: input.scheduledStartAt,
        status: "DRAFT",
        raidLeadId: input.raidLeadId,
        notes: input.notes,
        desiredTankCount: input.desiredTankCount,
        desiredHealerCount: input.desiredHealerCount,
        desiredDpsCount: input.desiredDpsCount,
        signupsOpen: false,
        createdAt: now,
        updatedAt: now,
      });
      await txOrm.RunRoster.create({
        id: crypto.randomUUID(),
        runId: id,
        state: "DRAFT",
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    });
    return id;
  },

  async updateFields(
    id: string,
    fields: {
      title?: string;
      raidId?: string;
      difficulty?: RaidDifficulty;
      scheduledStartAt?: string;
      raidLeadId?: string;
      notes?: string | null;
      desiredTankCount?: number;
      desiredHealerCount?: number;
      desiredDpsCount?: number;
      status?: RunStatus;
      signupsOpen?: boolean;
    },
  ) {
    await orm.Run.where({ id }).update({
      ...fields,
      updatedAt: new Date().toISOString(),
    });
  },

  /**
   * Identity fields (raid/difficulty) may change only when no RunSignup row exists,
   * including WITHDRAWN history. The second count aborts if a signup arrives mid-write.
   */
  async updateIdentityIfNoSignupHistory(
    id: string,
    fields: {
      title?: string;
      raidId: string;
      difficulty: RaidDifficulty;
      scheduledStartAt?: string;
      raidLeadId?: string;
      notes?: string | null;
      desiredTankCount?: number;
      desiredHealerCount?: number;
      desiredDpsCount?: number;
    },
  ) {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const before = await txOrm.RunSignup.where({ runId: id }).select("id").all();
      if (before.length > 0) {
        throw new DomainError(
          "RUN_IDENTITY_LOCKED",
          "Raid and difficulty cannot change after a signup has been recorded.",
        );
      }
      await txOrm.Run.where({ id }).update({
        ...fields,
        updatedAt: new Date().toISOString(),
      });
      const after = await txOrm.RunSignup.where({ runId: id }).select("id").all();
      if (after.length > 0) {
        throw new DomainError(
          "RUN_IDENTITY_LOCKED",
          "Raid and difficulty cannot change after a signup has been recorded.",
        );
      }
    });
  },

  async updateStatus(id: string, status: RunStatus) {
    await orm.Run.where({ id }).update({ status, updatedAt: new Date().toISOString() });
  },
};

type TxOrm = typeof orm;
