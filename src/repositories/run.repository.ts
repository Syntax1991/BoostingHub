import { db, orm } from "@/lib/prisma";
import { DomainError } from "@/lib/errors";
import type { RaidDifficulty, RunLootType, RunStatus, SignupStatus, ParticipationType, CharacterRole } from "@/models/enums";
import {
  asBoolean,
  asNumber,
  asString,
  asStringOrNull,
  mapCharacterRole,
  mapDifficulty,
  mapLootType,
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
  lootType: RunLootType;
  scheduledStartAt: string;
  status: RunStatus;
  raidLeadId: string;
  raidLeadName: string;
  notes: string | null;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  plannedBossCount: number;
  totalBossCount: number;
  signupsOpen: boolean;
  archivedAt: string | null;
  archivedById: string | null;
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
  const raidBosses = Array.isArray(raid.bosses) ? raid.bosses : [];

  return {
    id: asString(run.id),
    title: asString(run.title),
    raidId: asString(run.raidId ?? raid.id),
    raidName: asString(raid.name, "Unknown raid"),
    season: asString(raid.season),
    difficulty: mapDifficulty(run.difficulty),
    lootType: mapLootType(run.lootType),
    scheduledStartAt: asString(run.scheduledStartAt),
    status: mapRunStatus(run.status),
    raidLeadId: asString(run.raidLeadId ?? raidLead.id),
    raidLeadName: asString(raidLead.name, "Unknown lead"),
    notes: asStringOrNull(run.notes),
    desiredTankCount: asNumber(run.desiredTankCount),
    desiredHealerCount: asNumber(run.desiredHealerCount),
    desiredDpsCount: asNumber(run.desiredDpsCount),
    plannedBossCount: asNumber(run.plannedBossCount),
    totalBossCount: raidBosses.length,
    signupsOpen: asBoolean(run.signupsOpen),
    archivedAt: asStringOrNull(run.archivedAt),
    archivedById: asStringOrNull(run.archivedById),
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
      .include("raid", (raid) => raid.include("bosses"))
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
      .include("raid", (raid) => raid.include("bosses"))
      .include("raidLead")
      .include("signups")
      .include("roster", (roster) => roster.include("entries"))
      .first();

    return run ? mapRun(run as Record<string, unknown>) : null;
  },

  async listManaged(): Promise<RunListRecord[]> {
    const runs = await orm.Run
      .include("raid", (raid) => raid.include("bosses"))
      .include("raidLead")
      .include("signups")
      .include("roster", (roster) => roster.include("entries"))
      .orderBy((run) => run.scheduledStartAt.asc())
      .all();

    return runs.map((run) => mapRun(run as Record<string, unknown>));
  },

  async countByStatuses(): Promise<Record<string, number>> {
    const rows = await orm.Run.select("status").all();
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const status = asString((row as Record<string, unknown>).status);
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return counts;
  },

  async countSignups(runId: string): Promise<number> {
    const rows = await orm.RunSignup.where({ runId }).select("id").all();
    return rows.length;
  },

  async create(input: {
    title: string;
    raidId: string;
    difficulty: RaidDifficulty;
    lootType: RunLootType;
    scheduledStartAt: string;
    raidLeadId: string;
    notes: string | null;
    desiredTankCount: number;
    desiredHealerCount: number;
    desiredDpsCount: number;
    plannedBossCount: number;
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
        lootType: input.lootType,
        scheduledStartAt: input.scheduledStartAt,
        status: "DRAFT",
        raidLeadId: input.raidLeadId,
        notes: input.notes,
        desiredTankCount: input.desiredTankCount,
        desiredHealerCount: input.desiredHealerCount,
        desiredDpsCount: input.desiredDpsCount,
        plannedBossCount: input.plannedBossCount,
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

  /**
   * Atomic batch persistence for Mass Create Runs: every input's Run + its
   * initial empty RunRoster are created inside ONE transaction, so a batch is
   * truly all-or-nothing (a fault partway through rolls back everything
   * already written, never leaving a partial batch). Every domain decision
   * (raid availability, raid lead eligibility, title, effective field
   * merging) must already be resolved by the caller — this method only
   * persists already-prepared rows, in the order given, and returns their
   * new ids in that same order.
   */
  async createManyDraftsAtomic(
    inputs: Array<{
      title: string;
      raidId: string;
      difficulty: RaidDifficulty;
      lootType: RunLootType;
      scheduledStartAt: string;
      raidLeadId: string;
      notes: string | null;
      desiredTankCount: number;
      desiredHealerCount: number;
      desiredDpsCount: number;
      plannedBossCount: number;
    }>,
  ): Promise<string[]> {
    const now = new Date().toISOString();
    const ids = inputs.map(() => crypto.randomUUID());

    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index]!;
        const id = ids[index]!;
        await txOrm.Run.create({
          id,
          title: input.title,
          raidId: input.raidId,
          difficulty: input.difficulty,
          lootType: input.lootType,
          scheduledStartAt: input.scheduledStartAt,
          status: "DRAFT",
          raidLeadId: input.raidLeadId,
          notes: input.notes,
          desiredTankCount: input.desiredTankCount,
          desiredHealerCount: input.desiredHealerCount,
          desiredDpsCount: input.desiredDpsCount,
          plannedBossCount: input.plannedBossCount,
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
      }
    });

    return ids;
  },

  async updateFields(
    id: string,
    fields: {
      title?: string;
      raidId?: string;
      difficulty?: RaidDifficulty;
      lootType?: RunLootType;
      scheduledStartAt?: string;
      raidLeadId?: string;
      notes?: string | null;
      desiredTankCount?: number;
      desiredHealerCount?: number;
      desiredDpsCount?: number;
      plannedBossCount?: number;
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
      lootType?: RunLootType;
      scheduledStartAt?: string;
      raidLeadId?: string;
      notes?: string | null;
      desiredTankCount?: number;
      desiredHealerCount?: number;
      desiredDpsCount?: number;
      plannedBossCount?: number;
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

  async archiveRun(id: string, archivedById: string) {
    await orm.Run.where({ id }).update({
      archivedAt: new Date().toISOString(),
      archivedById,
      updatedAt: new Date().toISOString(),
    });
  },

  async restoreRun(id: string) {
    await orm.Run.where({ id }).update({
      archivedAt: null,
      archivedById: null,
      updatedAt: new Date().toISOString(),
    });
  },

  /**
   * Real relation history, not just FK presence — a freshly created Draft
   * always has an empty RunRoster row (created alongside the Run itself), so
   * "a roster exists" alone would block every Draft. Only entries or an
   * actual publish count as roster history.
   */
  async getDeleteBlockers(id: string): Promise<string[]> {
    const blockers: string[] = [];

    const signups = await orm.RunSignup.where({ runId: id }).select("id").all();
    if (signups.length > 0) {
      blockers.push("signup history");
    }

    const roster = await orm.RunRoster.where({ runId: id }).first();
    if (roster) {
      const rosterRow = roster as Record<string, unknown>;
      const entries = await orm.RunRosterEntry.where({ rosterId: asString(rosterRow.id) }).select("id").all();
      if (entries.length > 0 || asStringOrNull(rosterRow.publishedAt)) {
        blockers.push("roster history");
      }
    }

    const strikes = await orm.Strike.where({ runId: id }).select("id").all();
    if (strikes.length > 0) {
      blockers.push("strikes");
    }

    const attendance = await orm.RunAttendance.where({ runId: id }).select("id").all();
    if (attendance.length > 0) {
      blockers.push("attendance history");
    }

    const settlement = await orm.RunSettlement.where({ runId: id }).select("id").all();
    if (settlement.length > 0) {
      blockers.push("payout history");
    }

    const discordPost = await orm.RunDiscordPost.where({ runId: id }).first();
    if (discordPost) {
      blockers.push("Discord publication state");
    }

    return blockers;
  },

  /** Hard delete. Callers must already have confirmed getDeleteBlockers() is empty. */
  async deleteRun(id: string) {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const roster = await txOrm.RunRoster.where({ runId: id }).first();
      if (roster) {
        await txOrm.RunRoster.where({ id: asString((roster as Record<string, unknown>).id) }).delete();
      }
      await txOrm.Run.where({ id }).delete();
    });
  },
};

type TxOrm = typeof orm;
