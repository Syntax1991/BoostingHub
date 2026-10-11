import { orm } from "@/lib/prisma";
import { toUtcIso } from "@/lib/datetime";
import { asString, asStringOrNull } from "@/lib/persistence";
import {
  DISCORD_DELIVERY_STATUSES,
  NOTIFICATION_TYPES,
  type DiscordDeliveryStatus,
  type NotificationType,
} from "@/models/enums";

export type UserNotificationRecord = {
  id: string;
  userId: string;
  type: NotificationType;
  runId: string | null;
  signupId: string | null;
  sourceKey: string;
  title: string;
  message: string;
  href: string;
  readAt: string | null;
  discordDeliveryStatus: DiscordDeliveryStatus;
  discordUserId: string | null;
  discordDeliverAfter: string | null;
  /** false = internal notification-state row, never shown on a user-facing surface. */
  visibleInApp: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateUserNotificationInput = {
  id?: string;
  userId: string;
  type: NotificationType;
  runId: string | null;
  signupId: string | null;
  sourceKey: string;
  title: string;
  message: string;
  href: string;
  discordDeliveryStatus: DiscordDeliveryStatus;
  discordUserId: string | null;
  discordDeliverAfter?: string | null;
  createdAt?: string;
  /** Pre-read (record only, e.g. a suppressed roster swap removal). Defaults to unread. */
  readAt?: string | null;
  /**
   * false = internal bookkeeping (e.g. the old character's removal in a booster
   * character swap): kept for roster notification state, but excluded from the
   * bell, the Notifications page and the unread count. Defaults to true.
   */
  visibleInApp?: boolean;
};

function normalizeDiscordDeliverAfter(value: string | null | undefined): string | null {
  if (value == null) return null;
  return toUtcIso(value);
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function mapUserNotificationRow(row: Record<string, unknown>): UserNotificationRecord {
  return {
    id: asString(row.id),
    userId: asString(row.userId),
    type: asEnum(row.type, NOTIFICATION_TYPES, "ROSTER_SELECTED"),
    runId: asStringOrNull(row.runId),
    signupId: asStringOrNull(row.signupId),
    sourceKey: asString(row.sourceKey),
    title: asString(row.title),
    message: asString(row.message),
    href: asString(row.href),
    readAt: asStringOrNull(row.readAt),
    discordDeliveryStatus: asEnum(row.discordDeliveryStatus, DISCORD_DELIVERY_STATUSES, "SKIPPED"),
    discordUserId: asStringOrNull(row.discordUserId),
    discordDeliverAfter:
      row.discordDeliverAfter != null
        ? normalizeDiscordDeliverAfter(asString(row.discordDeliverAfter))
        : null,
    visibleInApp: row.visibleInApp !== false,
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  };
}

export function rosterSelectedSourceKey(runId: string, publishedVersion: number, signupId: string): string {
  return `roster-selected:${runId}:${publishedVersion}:${signupId}`;
}

/**
 * A ROSTER_SELECTED for a booster whose character was swapped (same player,
 * other booster signup). Same shape as rosterSelectedSourceKey — the version is
 * still the 3rd segment — but the prefix tells the DM renderer to say
 * "Roster Update" instead of "Roster Selected".
 */
export const ROSTER_SWAPPED_SOURCE_KEY_PREFIX = "roster-swapped:";

export function rosterSwappedSourceKey(runId: string, publishedVersion: number, signupId: string): string {
  return `${ROSTER_SWAPPED_SOURCE_KEY_PREFIX}${runId}:${publishedVersion}:${signupId}`;
}

export function rosterRemovedSourceKey(runId: string, publishedVersion: number, signupId: string): string {
  return `roster-removed:${runId}:${publishedVersion}:${signupId}`;
}

/** One per withdrawal: the roster version the withdrawal produced keeps a later re-pick + re-withdraw distinct. */
export function rosterWithdrawnSourceKey(runId: string, rosterVersion: number, signupId: string): string {
  return `roster-withdrawn:${runId}:${rosterVersion}:${signupId}`;
}

export function raidInviteSourceKey(runId: string, signupId: string): string {
  return `raid-invite:${runId}:${signupId}`;
}

export function runCancelledSourceKey(runId: string, cancelRevision: number, userId: string): string {
  return `run-cancelled:${runId}:${cancelRevision}:${userId}`;
}

export function runReactivatedSourceKey(runId: string, cancelRevision: number, userId: string): string {
  return `run-reactivated:${runId}:${cancelRevision}:${userId}`;
}

export function runRescheduledSourceKey(runId: string, scheduleRevision: number, userId: string): string {
  return `run-rescheduled:${runId}:${scheduleRevision}:${userId}`;
}

export function runScopeChangedSourceKey(runId: string, contentRevision: number, userId: string): string {
  return `run-scope-changed:${runId}:${contentRevision}:${userId}`;
}

/** contentRevision of a personal `run-scope-changed:` source key, or null. */
export function parseContentRevisionFromNotificationSourceKey(sourceKey: string): number | null {
  const parts = sourceKey.split(":");
  if (parts.length < 4 || parts[0] !== "run-scope-changed") return null;
  const revision = Number(parts[2]);
  return Number.isInteger(revision) && revision >= 0 ? revision : null;
}

/** Extract cancelRevision from personal cancel/reactivate notification source keys. */
export function parseCancelRevisionFromNotificationSourceKey(sourceKey: string): number | null {
  const parts = sourceKey.split(":");
  if (parts.length < 3) return null;
  if (parts[0] !== "run-cancelled" && parts[0] !== "run-reactivated") return null;
  const revision = Number(parts[2]);
  return Number.isInteger(revision) && revision > 0 ? revision : null;
}

export const userNotificationRepository = {
  async createInTx(txOrm: typeof orm, input: CreateUserNotificationInput): Promise<boolean> {
    const existing = await txOrm.UserNotification.where({ sourceKey: input.sourceKey }).first();
    if (existing) return false;
    const now = input.createdAt ?? new Date().toISOString();
    await txOrm.UserNotification.create({
      id: input.id ?? crypto.randomUUID(),
      userId: input.userId,
      type: input.type,
      runId: input.runId,
      signupId: input.signupId,
      sourceKey: input.sourceKey,
      title: input.title,
      message: input.message,
      href: input.href,
      readAt: input.readAt ?? null,
      discordDeliveryStatus: input.discordDeliveryStatus,
      discordUserId: input.discordUserId,
      discordDeliverAfter: normalizeDiscordDeliverAfter(input.discordDeliverAfter),
      visibleInApp: input.visibleInApp ?? true,
      createdAt: now,
      updatedAt: now,
    });
    return true;
  },

  async createIgnoreDuplicate(input: CreateUserNotificationInput): Promise<UserNotificationRecord | null> {
    const existing = await orm.UserNotification.where({ sourceKey: input.sourceKey }).first();
    if (existing) return null;
    const now = input.createdAt ?? new Date().toISOString();
    const id = input.id ?? crypto.randomUUID();
    try {
      await orm.UserNotification.create({
        id,
        userId: input.userId,
        type: input.type,
        runId: input.runId,
        signupId: input.signupId,
        sourceKey: input.sourceKey,
        title: input.title,
        message: input.message,
        href: input.href,
        readAt: null,
        discordDeliveryStatus: input.discordDeliveryStatus,
        discordUserId: input.discordUserId,
        discordDeliverAfter: normalizeDiscordDeliverAfter(input.discordDeliverAfter),
        visibleInApp: input.visibleInApp ?? true,
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      const raced = await orm.UserNotification.where({ sourceKey: input.sourceKey }).first();
      if (raced) return null;
      throw new Error(`Failed to create notification ${input.sourceKey}`);
    }
    const created = await orm.UserNotification.where({ id }).first();
    return created ? mapUserNotificationRow(created as Record<string, unknown>) : null;
  },

  // User-facing reads below only ever see visibleInApp rows; the filter is part
  // of the query so limits count visible notifications. Internal roster state
  // (notifyRosterSelectionChangesInTx) reads UserNotification directly and
  // still sees the hidden bookkeeping rows.

  async countUnreadForUser(userId: string): Promise<number> {
    const rows = await orm.UserNotification.where({ userId, visibleInApp: true })
      .where((n) => n.readAt.isNull())
      .select("id")
      .all();
    return rows.length;
  },

  async listLatestForUser(userId: string, limit = 5): Promise<UserNotificationRecord[]> {
    const rows = await orm.UserNotification.where({ userId, visibleInApp: true })
      .orderBy((n) => n.createdAt.desc())
      .limit(limit)
      .all();
    return rows.map((row) => mapUserNotificationRow(row as Record<string, unknown>));
  },

  async listForUser(userId: string, limit = 100): Promise<UserNotificationRecord[]> {
    const rows = await orm.UserNotification.where({ userId, visibleInApp: true })
      .orderBy((n) => n.createdAt.desc())
      .limit(limit)
      .all();
    return rows.map((row) => mapUserNotificationRow(row as Record<string, unknown>));
  },

  async findOwned(userId: string, notificationId: string): Promise<UserNotificationRecord | null> {
    const row = await orm.UserNotification.where({ id: notificationId, userId, visibleInApp: true }).first();
    return row ? mapUserNotificationRow(row as Record<string, unknown>) : null;
  },

  async findById(notificationId: string): Promise<UserNotificationRecord | null> {
    const row = await orm.UserNotification.where({ id: notificationId }).first();
    return row ? mapUserNotificationRow(row as Record<string, unknown>) : null;
  },

  async markRead(userId: string, notificationId: string): Promise<UserNotificationRecord | null> {
    const existing = await this.findOwned(userId, notificationId);
    if (!existing) return null;
    if (existing.readAt) return existing;
    const now = new Date().toISOString();
    await orm.UserNotification.where({ id: notificationId, userId, visibleInApp: true }).update({
      readAt: now,
      updatedAt: now,
    });
    return { ...existing, readAt: now, updatedAt: now };
  },

  async markAllRead(userId: string): Promise<number> {
    const unread = await orm.UserNotification.where({ userId, visibleInApp: true })
      .where((n) => n.readAt.isNull())
      .select("id")
      .all();
    if (unread.length === 0) return 0;
    const now = new Date().toISOString();
    for (const row of unread) {
      await orm.UserNotification.where({ id: asString((row as Record<string, unknown>).id) }).update({
        readAt: now,
        updatedAt: now,
      });
    }
    return unread.length;
  },

  /**
   * PENDING personal Discord DMs immediately eligible for the bot lane.
   * Quiet Hours deferred rows (future discordDeliverAfter) are excluded.
   */
  async listPendingDiscordDmNotifications(
    limit = 50,
    now: Date = new Date(),
  ): Promise<UserNotificationRecord[]> {
    const nowIso = toUtcIso(now);
    const [readyWithoutDelay, readyAfterQuietHours] = await Promise.all([
      orm.UserNotification.where({ discordDeliveryStatus: "PENDING" })
        .where((n) => n.discordDeliverAfter.isNull())
        .orderBy((n) => n.createdAt.asc())
        .limit(limit)
        .all(),
      orm.UserNotification.where({ discordDeliveryStatus: "PENDING" })
        .where((n) => n.discordDeliverAfter.lte(nowIso))
        .orderBy((n) => n.createdAt.asc())
        .limit(limit)
        .all(),
    ]);

    const eligibleById = new Map<string, UserNotificationRecord>();
    for (const userNotificationRow of [...readyWithoutDelay, ...readyAfterQuietHours]) {
      const mapped = mapUserNotificationRow(userNotificationRow as Record<string, unknown>);
      eligibleById.set(mapped.id, mapped);
    }

    return [...eligibleById.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
  },

  async updateDiscordDelivery(
    notificationId: string,
    status: Extract<DiscordDeliveryStatus, "SENT" | "FAILED_PERMANENT">,
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const before = await this.findById(notificationId);
    if (!before || before.discordDeliveryStatus !== "PENDING") return false;
    await orm.UserNotification.where({ id: notificationId, discordDeliveryStatus: "PENDING" }).update({
      discordDeliveryStatus: status,
      updatedAt: now,
    });
    const after = await this.findById(notificationId);
    return after?.discordDeliveryStatus === status;
  },

  /**
   * Compare-and-set PENDING → SKIPPED for one notification the DM lane will
   * never deliver (e.g. its Run is archived). Never touches SENT /
   * FAILED_PERMANENT / SKIPPED rows, so a concurrent pass can neither revert
   * nor double-apply it. True when this call (or a racing one) left it SKIPPED.
   */
  async skipPendingDiscordDelivery(notificationId: string): Promise<boolean> {
    await orm.UserNotification.where({ id: notificationId, discordDeliveryStatus: "PENDING" }).update({
      discordDeliveryStatus: "SKIPPED",
      updatedAt: new Date().toISOString(),
    });
    const after = await this.findById(notificationId);
    return after?.discordDeliveryStatus === "SKIPPED";
  },

  /**
   * Marks still-PENDING Discord DM deliveries SKIPPED for the given source keys
   * (e.g. undelivered RUN_CANCELLED DMs when Reactivate commits). Does not
   * delete rows or rewrite SENT history.
   */
  async skipPendingDiscordDeliveryForSourceKeys(sourceKeys: readonly string[]): Promise<number> {
    if (sourceKeys.length === 0) return 0;
    const now = new Date().toISOString();
    let skipped = 0;
    for (const sourceKey of sourceKeys) {
      const row = (await orm.UserNotification.where({ sourceKey }).first()) as Record<string, unknown> | null;
      if (!row) continue;
      if (asString(row.discordDeliveryStatus) !== "PENDING") continue;
      await orm.UserNotification.where({ id: asString(row.id) }).update({
        discordDeliveryStatus: "SKIPPED",
        updatedAt: now,
      });
      skipped += 1;
    }
    return skipped;
  },
};
