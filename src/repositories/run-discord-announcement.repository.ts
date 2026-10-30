import { db, orm } from "@/lib/prisma";
import {
  serializeCustomPing,
  serializeLateFillHelp,
  storedPingKeys,
  type CustomPing,
  type LateFillHelpRole,
  type LateFillHelpRoleKey,
  type PingRoleKey,
} from "@/lib/late-fill-help";
import { lockRosterInTx } from "@/repositories/roster.repository";
import {
  asString,
  asStringOrNull,
  mapDifficulty,
  mapLootType,
} from "@/lib/persistence";
import {
  DISCORD_DELIVERY_STATUSES,
  RUN_DISCORD_ANNOUNCEMENT_TYPES,
  type DiscordDeliveryStatus,
  type RaidDifficulty,
  type RunDiscordAnnouncementType,
  type RunLootType,
  type WowClass,
} from "@/models/enums";

export type RunDiscordAnnouncementRecord = {
  id: string;
  runId: string;
  type: RunDiscordAnnouncementType;
  sourceKey: string;
  previousScheduledStartAt: string | null;
  scheduledStartAt: string;
  productLabel: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  /** RUN_SCOPE_CHANGED only: JSON RunScopeChange[] snapshot (lib/run-scope-change). */
  scopeChanges: string | null;
  /** LATE_FILL_HELP only: JSON LateFillHelpRole[] snapshot (lib/late-fill-help). */
  helpRoles: string | null;
  status: DiscordDeliveryStatus;
  createdAt: string;
  sentAt: string | null;
  updatedAt: string;
};

export type CreateRunDiscordAnnouncementInput = {
  id?: string;
  runId: string;
  type: RunDiscordAnnouncementType;
  sourceKey: string;
  previousScheduledStartAt: string | null;
  scheduledStartAt: string;
  productLabel: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  /** RUN_SCOPE_CHANGED only: serialized RunScopeChange[]. */
  scopeChanges?: string | null;
  /** LATE_FILL_HELP only: serialized LateFillHelpRole[]. */
  helpRoles?: string | null;
  /** Initial status — PENDING when a channel may exist; callers may pass SKIPPED. */
  status?: DiscordDeliveryStatus;
  createdAt?: string;
};

type TxOrm = typeof orm;

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function mapRunDiscordAnnouncementRow(row: Record<string, unknown>): RunDiscordAnnouncementRecord {
  return {
    id: asString(row.id),
    runId: asString(row.runId),
    type: asEnum(row.type, RUN_DISCORD_ANNOUNCEMENT_TYPES, "RUN_CANCELLED"),
    sourceKey: asString(row.sourceKey),
    previousScheduledStartAt: asStringOrNull(row.previousScheduledStartAt),
    scheduledStartAt: asString(row.scheduledStartAt),
    productLabel: asString(row.productLabel),
    difficulty: mapDifficulty(row.difficulty),
    lootType: mapLootType(row.lootType),
    scopeChanges: asStringOrNull(row.scopeChanges),
    helpRoles: asStringOrNull(row.helpRoles),
    status: asEnum(row.status, DISCORD_DELIVERY_STATUSES, "PENDING"),
    createdAt: asString(row.createdAt),
    sentAt: asStringOrNull(row.sentAt),
    updatedAt: asString(row.updatedAt),
  };
}

export function runRescheduledChannelSourceKey(runId: string, scheduleRevision: number): string {
  return `run-rescheduled:${runId}:${scheduleRevision}`;
}

export function runScopeChangedChannelSourceKey(runId: string, contentRevision: number): string {
  return `run-scope-changed:${runId}:${contentRevision}`;
}

export function runCancelledChannelSourceKey(runId: string, cancelRevision: number): string {
  return `run-cancelled:${runId}:${cancelRevision}`;
}

export function runReactivatedChannelSourceKey(runId: string, cancelRevision: number): string {
  return `run-reactivated:${runId}:${cancelRevision}`;
}

/** Extract cancelRevision from `run-cancelled:` / `run-reactivated:` channel source keys. */
export function parseCancelRevisionFromChannelSourceKey(sourceKey: string): number | null {
  const parts = sourceKey.split(":");
  if (parts.length < 3) return null;
  if (parts[0] !== "run-cancelled" && parts[0] !== "run-reactivated") return null;
  const revision = Number(parts[2]);
  return Number.isInteger(revision) && revision > 0 ? revision : null;
}

/** Insert announcement inside an open transaction; no-op when sourceKey already exists. */
export async function insertAnnouncementIgnoreDuplicateTx(
  txOrm: TxOrm,
  input: CreateRunDiscordAnnouncementInput,
): Promise<void> {
  const existing = await txOrm.RunDiscordAnnouncement.where({ sourceKey: input.sourceKey }).first();
  if (existing) return;
  const now = input.createdAt ?? new Date().toISOString();
  const id = input.id ?? crypto.randomUUID();
  const status = input.status ?? "PENDING";
  await txOrm.RunDiscordAnnouncement.create({
    id,
    runId: input.runId,
    type: input.type,
    sourceKey: input.sourceKey,
    previousScheduledStartAt: input.previousScheduledStartAt,
    scheduledStartAt: input.scheduledStartAt,
    productLabel: input.productLabel,
    difficulty: input.difficulty,
    lootType: input.lootType,
    scopeChanges: input.scopeChanges ?? null,
    helpRoles: input.helpRoles ?? null,
    status,
    createdAt: now,
    sentAt: null,
    updatedAt: now,
  });
}

export type LateFillHelpWriteResult = {
  /** The PENDING announcement the bot will post; null when every role was cooling down. */
  created: RunDiscordAnnouncementRecord | null;
  /** Roles this request pings. */
  pinged: LateFillHelpRole[];
  /** Classes whose missing buffs this request names (not pinged again within the cooldown). */
  pingedClasses: WowClass[];
  /** Roles asked for too recently on this Run, with when they may be asked again. */
  cooling: Array<{ role: LateFillHelpRoleKey; availableAt: string }>;
};

type HelpRequestIdentity = {
  runId: string;
  scheduledStartAt: string;
  productLabel: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
};

/** Newest ping per role / class within the cooldown, from automatic and custom requests alike. */
async function lastPingAtByKey(txOrm: TxOrm, runId: string, now: string, cooldownMs: number): Promise<Map<PingRoleKey, number>> {
  const since = new Date(Date.parse(now) - cooldownMs).toISOString();
  const recent = (await txOrm.RunDiscordAnnouncement.where({ runId, type: "LATE_FILL_HELP" })
    .where((row) => row.createdAt.gte(since))
    .select("createdAt", "helpRoles")
    .all()) as Array<Record<string, unknown>>;
  const lastAt = new Map<PingRoleKey, number>();
  for (const row of recent) {
    const at = Date.parse(asString(row.createdAt));
    for (const key of storedPingKeys(asStringOrNull(row.helpRoles))) {
      lastAt.set(key, Math.max(lastAt.get(key) ?? 0, at));
    }
  }
  return lastAt;
}

async function insertHelpRequestTx(txOrm: TxOrm, input: HelpRequestIdentity, helpRoles: string, now: string) {
  const id = crypto.randomUUID();
  await insertAnnouncementIgnoreDuplicateTx(txOrm, {
    id,
    runId: input.runId,
    type: "LATE_FILL_HELP",
    sourceKey: `late-fill-help:${input.runId}:${id}`,
    previousScheduledStartAt: null,
    scheduledStartAt: input.scheduledStartAt,
    productLabel: input.productLabel,
    difficulty: input.difficulty,
    lootType: input.lootType,
    helpRoles,
    createdAt: now,
  });
  const created = await txOrm.RunDiscordAnnouncement.where({ id }).first();
  return created ? mapRunDiscordAnnouncementRow(created as Record<string, unknown>) : null;
}

export const runDiscordAnnouncementRepository = {
  /** Read-only: what the shared cooldown holds back right now (the dialog's preview; no lock, no write). */
  async recentPings(runId: string, now: string, cooldownMs: number): Promise<Map<PingRoleKey, number>> {
    return lastPingAtByKey(orm, runId, now, cooldownMs);
  },

  /**
   * A custom request, under the same lock and cooldown as Late Fill help. A
   * role the Raid Lead chose is never silently dropped: with any of them
   * cooling down nothing goes out and `cooling` names them.
   */
  async createCustomPing(input: HelpRequestIdentity & {
    rosterId: string;
    ping: CustomPing;
    cooldownMs: number;
    now: string;
  }): Promise<{ created: RunDiscordAnnouncementRecord | null; cooling: Array<{ key: PingRoleKey; availableAt: string }> }> {
    return db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      await lockRosterInTx(txOrm, input.rosterId);
      const lastAt = await lastPingAtByKey(txOrm, input.runId, input.now, input.cooldownMs);
      const cooling = input.ping.roles
        .filter((key) => lastAt.has(key))
        .map((key) => ({ key, availableAt: new Date(lastAt.get(key)! + input.cooldownMs).toISOString() }));
      if (cooling.length > 0) return { created: null, cooling };
      return { created: await insertHelpRequestTx(txOrm, input, serializeCustomPing(input.ping), input.now), cooling };
    });
  },

  /**
   * Late Fill help, serialized per Run by the roster row lock (the same lock
   * roster and attendance writes take): roles and classes pinged within
   * `cooldownMs` are dropped, the rest go into ONE PENDING announcement.
   * Classes only accompany a role: with every role cooling down nothing goes
   * out. Concurrent clicks therefore produce one message, never two pings of
   * the same role or class.
   */
  async createLateFillHelp(input: {
    runId: string;
    rosterId: string;
    roles: readonly LateFillHelpRole[];
    classes: readonly WowClass[];
    cooldownMs: number;
    now: string;
    scheduledStartAt: string;
    productLabel: string;
    difficulty: RaidDifficulty;
    lootType: RunLootType;
  }): Promise<LateFillHelpWriteResult> {
    return db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      await lockRosterInTx(txOrm, input.rosterId);
      const lastAt = await lastPingAtByKey(txOrm, input.runId, input.now, input.cooldownMs);
      const cooling = input.roles
        .filter((row) => lastAt.has(row.role))
        .map((row) => ({ role: row.role, availableAt: new Date(lastAt.get(row.role)! + input.cooldownMs).toISOString() }));
      const pinged = input.roles.filter((row) => !lastAt.has(row.role));
      if (pinged.length === 0) return { created: null, pinged, pingedClasses: [], cooling };
      const pingedClasses = input.classes.filter((wowClass) => !lastAt.has(wowClass));
      return {
        created: await insertHelpRequestTx(txOrm, input, serializeLateFillHelp(pinged, pingedClasses), input.now),
        pinged,
        pingedClasses,
        cooling,
      };
    });
  },

  async createIgnoreDuplicate(
    input: CreateRunDiscordAnnouncementInput,
  ): Promise<RunDiscordAnnouncementRecord | null> {
    const existing = await orm.RunDiscordAnnouncement.where({ sourceKey: input.sourceKey }).first();
    if (existing) return null;
    const id = input.id ?? crypto.randomUUID();
    try {
      await db.transaction(async (tx) => {
        const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
        await insertAnnouncementIgnoreDuplicateTx(txOrm, { ...input, id });
      });
    } catch {
      const raced = await orm.RunDiscordAnnouncement.where({ sourceKey: input.sourceKey }).first();
      if (raced) return null;
      throw new Error(`Failed to create RunDiscordAnnouncement ${input.sourceKey}`);
    }
    const created = await orm.RunDiscordAnnouncement.where({ id }).first();
    return created ? mapRunDiscordAnnouncementRow(created as Record<string, unknown>) : null;
  },

  async listPending(limit = 50): Promise<RunDiscordAnnouncementRecord[]> {
    const rows = await orm.RunDiscordAnnouncement
      .where({ status: "PENDING" })
      .orderBy((row) => row.createdAt.asc())
      .limit(limit)
      .all();
    return (rows as Record<string, unknown>[])
      .map(mapRunDiscordAnnouncementRow)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
          a.id.localeCompare(b.id),
      );
  },

  async countPendingByRunId(runId: string): Promise<number> {
    const rows = await orm.RunDiscordAnnouncement.where({ runId, status: "PENDING" }).select("id").all();
    return rows.length;
  },

  async findById(id: string): Promise<RunDiscordAnnouncementRecord | null> {
    const row = await orm.RunDiscordAnnouncement.where({ id }).first();
    return row ? mapRunDiscordAnnouncementRow(row as Record<string, unknown>) : null;
  },

  async findBySourceKey(sourceKey: string): Promise<RunDiscordAnnouncementRecord | null> {
    const row = await orm.RunDiscordAnnouncement.where({ sourceKey }).first();
    return row ? mapRunDiscordAnnouncementRow(row as Record<string, unknown>) : null;
  },

  async updateStatus(
    id: string,
    status: DiscordDeliveryStatus,
    options: { sentAt?: string | null } = {},
  ): Promise<void> {
    await this.updateStatusIfPending(id, status, options);
  },

  /**
   * Compare-and-set delivery transition. Only PENDING rows may move to a
   * terminal status — a stale bot SENT report must not revive SKIPPED.
   * Returns true when the row was updated.
   */
  async updateStatusIfPending(
    id: string,
    status: DiscordDeliveryStatus,
    options: { sentAt?: string | null } = {},
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const before = await this.findById(id);
    if (!before || before.status !== "PENDING") return false;
    await orm.RunDiscordAnnouncement.where({ id, status: "PENDING" }).update({
      status,
      ...(options.sentAt !== undefined ? { sentAt: options.sentAt } : {}),
      ...(status === "SENT" && options.sentAt === undefined ? { sentAt: now } : {}),
      updatedAt: now,
    });
    const after = await this.findById(id);
    return after?.status === status;
  },
};
