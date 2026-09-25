import { mapExternalBoosters, type ExternalBooster } from "@/lib/external-booster";
import { db, orm } from "@/lib/prisma";
import { and, or } from "@prisma/orm-postgres/orm-client";
import { DomainError } from "@/lib/errors";
import { normalizeOfferedRoles } from "@/lib/offered-roles";
import {
  projectRunContentDisplay,
  type RunContentDisplay,
} from "@/lib/run-content-presets";
import type {
  RaidDifficulty,
  RunLootType,
  RunStatus,
  SignupStatus,
  ParticipationType,
  CharacterRole,
  WowClass,
} from "@/models/enums";
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
  mapWowClass,
} from "@/lib/persistence";
import {
  insertAnnouncementIgnoreDuplicateTx,
  type CreateRunDiscordAnnouncementInput,
} from "@/repositories/run-discord-announcement.repository";

/**
 * Test-only hooks that force a mid-transaction failure for rollback proofs.
 * Production callers must never pass these.
 */
export type LifecycleAnnouncementTxHooks = {
  failAfterRunUpdate?: boolean;
  /** Insert with a nonexistent runId so the FK fails and rolls back the Run write. */
  failAnnouncementInsert?: boolean;
};

export type RunFieldsUpdate = {
  title?: string;
  difficulty?: RaidDifficulty;
  lootType?: RunLootType;
  scheduledStartAt?: string;
  scheduleRevision?: number;
  raidLeadId?: string;
  notes?: string | null;
  desiredTankCount?: number;
  desiredHealerCount?: number;
  desiredDpsCount?: number;
  discordRolePing?: boolean;
  status?: RunStatus;
  signupsOpen?: boolean;
};
export type RunListFilters = {
  difficulty?: RaidDifficulty;
  status?: RunStatus;
  signupsOpen?: boolean;
};

export type SignupCharacterOnRun = {
  name: string;
  realm: string;
  wowClass: WowClass;
};

export type SignupOnRun = {
  id: string;
  userId: string;
  userName: string;
  /** Discord handle (not server nickname) — preferred for public signup embed lines. */
  discordUsername: string | null;
  discordUserId: string | null;
  status: SignupStatus;
  participationType: ParticipationType;
  isBackup: boolean;
  offeredRoles: CharacterRole[];
  /** Live published BOOSTER role; null unless SELECTED booster. */
  publishedRole: CharacterRole | null;
  /** Characterless Lootbuddy class snapshot; null for BOOSTER / legacy Character-backed loot. */
  lootbuddyClass: WowClass | null;
  character: SignupCharacterOnRun | null;
};

export type RosterSelectionOnRun = {
  signupId: string;
  selected: boolean;
  selectedRole: CharacterRole | null;
};

export type RunListRecord = {
  id: string;
  title: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  scheduledStartAt: string;
  /** Increments only when scheduledStartAt changes. */
  scheduleRevision: number;
  status: RunStatus;
  raidLeadId: string;
  raidLeadName: string;
  /**
   * Raid Lead's current Settings nickname for Discord channel naming only.
   * Null → fall back to raidLeadName. Never affects Run.title.
   */
  raidLeadDiscordRunChannelNickname: string | null;
  /** Discord snowflake for the Raid Lead User, when linked. */
  raidLeadDiscordUserId: string | null;
  notes: string | null;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  /** When true, first Discord channel provision pings Tank/Healer/DPS roles. */
  discordRolePing: boolean;
  /** Authoritative ordered raid contents for this Run. */
  contents: RunRaidContentRecord[];
  /** Pure display projection from persisted contents (never regenerated from presets). */
  contentDisplay: RunContentDisplay;
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
    selections: RosterSelectionOnRun[];
    /** Unregistered boosters added by hand; saved with the draft, count toward targets. */
    externalBoosters: ExternalBooster[];
  } | null;
};

/** Ordered real-raid contents for one Run (foundation for multi-raid Bundles). */
export type RunRaidContentRecord = {
  id: string;
  runId: string;
  raidId: string;
  raidName: string;
  season: string;
  sortOrder: number;
  plannedBossCount: number;
  totalBossCount: number;
};

type TxOrm = typeof orm;

function mapRaidContent(row: Record<string, unknown>): RunRaidContentRecord {
  const raid = (row.raid ?? {}) as Record<string, unknown>;
  const bosses = Array.isArray(raid.bosses) ? raid.bosses : [];
  return {
    id: asString(row.id),
    runId: asString(row.runId),
    raidId: asString(row.raidId ?? raid.id),
    raidName: asString(raid.name, "Unknown raid"),
    season: asString(raid.season),
    sortOrder: asNumber(row.sortOrder),
    plannedBossCount: asNumber(row.plannedBossCount),
    totalBossCount: bosses.length,
  };
}

export type RunContentWriteSpec = {
  raidId: string;
  sortOrder: number;
  plannedBossCount: number;
};

export type RunCreateWithContentsInput = {
  title: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  scheduledStartAt: string;
  raidLeadId: string;
  notes: string | null;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  /** Defaults to true when omitted (legacy callers / tests). */
  discordRolePing?: boolean;
  contents: RunContentWriteSpec[];
};

async function insertRaidContents(
  ormLike: TxOrm,
  runId: string,
  contents: RunContentWriteSpec[],
  now: string,
) {
  if (contents.length === 0) {
    throw new DomainError("VALIDATION_FAILED", "Run must include at least one raid content row.");
  }
  const sorted = [...contents].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const content of sorted) {
    await ormLike.RunRaidContent.create({
      id: crypto.randomUUID(),
      runId,
      raidId: content.raidId,
      sortOrder: content.sortOrder,
      plannedBossCount: content.plannedBossCount,
      createdAt: now,
    });
  }
}

/** Replace the full content set inside an open transaction (delete + recreate). */
async function replaceRaidContentsTx(
  ormLike: TxOrm,
  runId: string,
  contents: RunContentWriteSpec[],
  now: string,
) {
  const existing = (await ormLike.RunRaidContent.where({ runId }).all()) as Record<string, unknown>[];
  for (const row of existing) {
    await ormLike.RunRaidContent.where({ id: asString(row.id) }).delete();
  }
  await insertRaidContents(ormLike, runId, contents, now);
}

function mapOfferedRoles(value: unknown): CharacterRole[] {
  if (!Array.isArray(value)) return [];
  return normalizeOfferedRoles(
    value.map((item) => mapCharacterRole((item as Record<string, unknown>).role)),
  );
}

function mapRun(run: Record<string, unknown>): RunListRecord {
  const raidLead = (run.raidLead ?? {}) as Record<string, unknown>;
  const signups = Array.isArray(run.signups) ? run.signups : [];
  const roster = run.roster ? (run.roster as Record<string, unknown>) : null;
  const rosterEntries = roster && Array.isArray(roster.entries) ? roster.entries : [];
  const contentRows = Array.isArray(run.contents) ? run.contents : [];
  const contents = contentRows
    .map((row) => mapRaidContent(row as Record<string, unknown>))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (contents.length === 0) {
    throw new DomainError("VALIDATION_FAILED", "Run has no persisted raid content.");
  }
  const contentDisplay = projectRunContentDisplay(contents);

  return {
    id: asString(run.id),
    title: asString(run.title),
    difficulty: mapDifficulty(run.difficulty),
    lootType: mapLootType(run.lootType),
    scheduledStartAt: asString(run.scheduledStartAt),
    scheduleRevision: asNumber(run.scheduleRevision, 0),
    status: mapRunStatus(run.status),
    raidLeadId: asString(run.raidLeadId ?? raidLead.id),
    raidLeadName: asString(raidLead.name, "Unknown lead"),
    /** Live nickname for Discord channel naming only — never snapshotted onto the Run. */
    raidLeadDiscordRunChannelNickname: asStringOrNull(raidLead.discordRunChannelNickname),
    raidLeadDiscordUserId: asStringOrNull(raidLead.discordUserId),
    notes: asStringOrNull(run.notes),
    desiredTankCount: asNumber(run.desiredTankCount),
    desiredHealerCount: asNumber(run.desiredHealerCount),
    desiredDpsCount: asNumber(run.desiredDpsCount),
    discordRolePing: asBoolean(run.discordRolePing, true),
    contents,
    contentDisplay,
    signupsOpen: asBoolean(run.signupsOpen),
    archivedAt: asStringOrNull(run.archivedAt),
    archivedById: asStringOrNull(run.archivedById),
    signups: signups.map((row) => {
      const signup = row as Record<string, unknown>;
      const user = (signup.user ?? {}) as Record<string, unknown>;
      const character = signup.character ? (signup.character as Record<string, unknown>) : null;
      return {
        id: asString(signup.id),
        userId: asString(signup.userId),
        userName: asString(user.name, "Unknown"),
        discordUsername: asStringOrNull(user.discordUsername),
        discordUserId: asStringOrNull(user.discordUserId),
        status: mapSignupStatus(signup.status),
        participationType: mapParticipation(signup.participationType),
        isBackup: asBoolean(signup.isBackup),
        offeredRoles: mapOfferedRoles(signup.offeredRoles),
        publishedRole: signup.publishedRole == null ? null : mapCharacterRole(signup.publishedRole),
        lootbuddyClass: signup.lootbuddyClass == null ? null : mapWowClass(signup.lootbuddyClass),
        character: character
          ? {
              name: asString(character.name),
              realm: asString(character.realm),
              wowClass: mapWowClass(character.wowClass),
            }
          : null,
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
          selections: rosterEntries.map((entry) => {
            const row = entry as Record<string, unknown>;
            return {
              signupId: asString(row.signupId),
              selected: asBoolean(row.selected, true),
              selectedRole: row.selectedRole == null ? null : mapCharacterRole(row.selectedRole),
            };
          }),
          externalBoosters: mapExternalBoosters(roster.externalBoosters),
        }
      : null,
  };
}



export const runRepository = {
  async listUpcoming(filters: RunListFilters = {}): Promise<RunListRecord[]> {
    let query = orm.Run
      .include("contents", (content) => content.include("raid", (raid) => raid.include("bosses")))
      .include("raidLead")
      .include("signups", (signup) => signup.include("offeredRoles").include("user").include("character"))
      .include("roster", (roster) => roster.include("entries").include("externalBoosters"))
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
      .include("contents", (content) => content.include("raid", (raid) => raid.include("bosses")))
      .include("raidLead")
      .include("signups", (signup) => signup.include("offeredRoles").include("user").include("character"))
      .include("roster", (roster) => roster.include("entries").include("externalBoosters"))
      .first();

    return run ? mapRun(run as Record<string, unknown>) : null;
  },

  /** Ordered RunRaidContent rows for foundation / Bundle cutover. */
  async listRaidContents(runId: string): Promise<RunRaidContentRecord[]> {
    const rows = await orm.RunRaidContent.where({ runId }).include("raid", (raid) => raid.include("bosses")).all();
    return rows
      .map((row) => mapRaidContent(row as Record<string, unknown>))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  async listManaged(): Promise<RunListRecord[]> {
    const runs = await orm.Run
      .include("contents", (content) => content.include("raid", (raid) => raid.include("bosses")))
      .include("raidLead")
      .include("signups", (signup) => signup.include("offeredRoles").include("user").include("character"))
      .include("roster", (roster) => roster.include("entries").include("externalBoosters"))
      .orderBy((run) => run.scheduledStartAt.asc())
      .all();

    return runs.map((run) => mapRun(run as Record<string, unknown>));
  },

  /**
   * Discord sync: ids of Runs that may need Discord work even without any
   * stored Discord identity — first signup provisioning (OPEN/ROSTERING; the
   * week gate is applied by the sync itself, so a FUTURE Run is never lost)
   * and temporary Voice provisioning (unarchived IN_PROGRESS). Ids only.
   */
  async listDiscordSyncBaseRunIds(): Promise<string[]> {
    const rows = await orm.Run.where((run) =>
      or(run.status.in(["OPEN", "ROSTERING"]), and(run.status.eq("IN_PROGRESS"), run.archivedAt.isNull())),
    )
      .select("id")
      .all();
    return rows.map((row) => asString((row as Record<string, unknown>).id));
  },

  /** Same projection and ordering as listManaged, limited to the given Run ids (one query). */
  async listManagedByIds(ids: readonly string[]): Promise<RunListRecord[]> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return [];
    const runs = await orm.Run.where((run) => run.id.in(uniqueIds))
      .include("contents", (content) => content.include("raid", (raid) => raid.include("bosses")))
      .include("raidLead")
      .include("signups", (signup) => signup.include("offeredRoles").include("user").include("character"))
      .include("roster", (roster) => roster.include("entries").include("externalBoosters"))
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

  async create(input: RunCreateWithContentsInput): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      await txOrm.Run.create({
        id,
        title: input.title,
        difficulty: input.difficulty,
        lootType: input.lootType,
        scheduledStartAt: input.scheduledStartAt,
        status: "DRAFT",
        raidLeadId: input.raidLeadId,
        notes: input.notes,
        desiredTankCount: input.desiredTankCount,
        desiredHealerCount: input.desiredHealerCount,
        desiredDpsCount: input.desiredDpsCount,
        discordRolePing: input.discordRolePing ?? true,
        signupsOpen: false,
        createdAt: now,
        updatedAt: now,
      });
      await insertRaidContents(txOrm, id, input.contents, now);
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
   * Atomic batch persistence for Mass Create Runs: every input's Run + all
   * RunRaidContent rows + initial empty RunRoster are created inside ONE
   * transaction (all-or-nothing). Domain decisions must already be resolved
   * by the caller — this method only persists prepared rows.
   */
  async createManyDraftsAtomic(inputs: RunCreateWithContentsInput[]): Promise<string[]> {
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
          difficulty: input.difficulty,
          lootType: input.lootType,
          scheduledStartAt: input.scheduledStartAt,
          status: "DRAFT",
          raidLeadId: input.raidLeadId,
          notes: input.notes,
          desiredTankCount: input.desiredTankCount,
          desiredHealerCount: input.desiredHealerCount,
          desiredDpsCount: input.desiredDpsCount,
          discordRolePing: input.discordRolePing ?? true,
          signupsOpen: false,
          createdAt: now,
          updatedAt: now,
        });
        await insertRaidContents(txOrm, id, input.contents, now);
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

  /**
   * Non-content field updates only. Does not touch RunRaidContent.
   * Content identity changes use updateIdentityIfNoSignupHistory with an
   * explicit contents payload.
   */
  async updateFields(id: string, fields: RunFieldsUpdate) {
    await orm.Run.where({ id }).update({
      ...fields,
      updatedAt: new Date().toISOString(),
    });
  },

  /**
   * Atomically cancel a Run and insert the RUN_CANCELLED channel announcement.
   * Either both commit or neither does — never cancel without the announcement
   * row the bot needs before retiring the Discord channel.
   */
  async cancelWithDiscordAnnouncement(
    runId: string,
    announcement: CreateRunDiscordAnnouncementInput,
    hooks: LifecycleAnnouncementTxHooks = {},
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const now = new Date().toISOString();
      await txOrm.Run.where({ id: runId }).update({
        status: "CANCELLED",
        signupsOpen: false,
        updatedAt: now,
      });
      if (hooks.failAfterRunUpdate) {
        throw new Error("TEST_HOOK_FAIL_AFTER_RUN_UPDATE");
      }
      if (hooks.failAnnouncementInsert) {
        await insertAnnouncementIgnoreDuplicateTx(txOrm, {
          ...announcement,
          runId: "00000000-0000-4000-8000-000000000000",
        });
        return;
      }
      await insertAnnouncementIgnoreDuplicateTx(txOrm, announcement);
    });
  },

  /**
   * Non-content Run field update + optional RunDiscordAnnouncement in one transaction.
   */
  async updateFieldsWithDiscordAnnouncement(
    id: string,
    fields: RunFieldsUpdate,
    announcement: CreateRunDiscordAnnouncementInput | null,
    hooks: LifecycleAnnouncementTxHooks = {},
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const now = new Date().toISOString();
      await txOrm.Run.where({ id }).update({
        ...fields,
        updatedAt: now,
      });
      if (hooks.failAfterRunUpdate) {
        throw new Error("TEST_HOOK_FAIL_AFTER_RUN_UPDATE");
      }
      if (!announcement) return;
      if (hooks.failAnnouncementInsert) {
        await insertAnnouncementIgnoreDuplicateTx(txOrm, {
          ...announcement,
          runId: "00000000-0000-4000-8000-000000000000",
        });
        return;
      }
      await insertAnnouncementIgnoreDuplicateTx(txOrm, announcement);
    });
  },

  /**
   * Identity fields (content composition / difficulty) may change only when no
   * RunSignup row exists, including WITHDRAWN history. When `contents` is
   * provided, the full RunRaidContent set is replaced atomically with the Run
   * row update. Optional Discord announcement shares the same transaction.
   */
  async updateIdentityIfNoSignupHistory(
    id: string,
    fields: {
      title?: string;
      difficulty: RaidDifficulty;
      lootType?: RunLootType;
      scheduledStartAt?: string;
      scheduleRevision?: number;
      raidLeadId?: string;
      notes?: string | null;
      desiredTankCount?: number;
      desiredHealerCount?: number;
      desiredDpsCount?: number;
      discordRolePing?: boolean;
      contents?: RunContentWriteSpec[];
    },
    announcement: CreateRunDiscordAnnouncementInput | null = null,
    hooks: LifecycleAnnouncementTxHooks = {},
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
      const now = new Date().toISOString();
      const { contents, ...runFields } = fields;
      await txOrm.Run.where({ id }).update({
        ...runFields,
        updatedAt: now,
      });
      if (contents) {
        await replaceRaidContentsTx(txOrm, id, contents, now);
      }
      const after = await txOrm.RunSignup.where({ runId: id }).select("id").all();
      if (after.length > 0) {
        throw new DomainError(
          "RUN_IDENTITY_LOCKED",
          "Raid and difficulty cannot change after a signup has been recorded.",
        );
      }
      if (hooks.failAfterRunUpdate) {
        throw new Error("TEST_HOOK_FAIL_AFTER_RUN_UPDATE");
      }
      if (!announcement) return;
      if (hooks.failAnnouncementInsert) {
        await insertAnnouncementIgnoreDuplicateTx(txOrm, {
          ...announcement,
          runId: "00000000-0000-4000-8000-000000000000",
        });
        return;
      }
      await insertAnnouncementIgnoreDuplicateTx(txOrm, announcement);
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
