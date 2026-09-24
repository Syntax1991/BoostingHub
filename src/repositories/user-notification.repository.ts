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

export function runCancelledSourceKey(runId: string, userId: string): string {
  return `run-cancelled:${runId}:${userId}`;
}

export function runRescheduledSourceKey(runId: string, scheduleRevision: number, userId: string): string {
  return `run-rescheduled:${runId}:${scheduleRevision}:${userId}`;
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

  async countUnreadForUser(userId: string): Promise<number> {
    const rows = await orm.UserNotification.where({ userId })
      .where((n) => n.readAt.isNull())
      .select("id")
      .all();
    return rows.length;
  },

  async listLatestForUser(userId: string, limit = 5): Promise<UserNotificationRecord[]> {
    const rows = await orm.UserNotification.where({ userId })
      .orderBy((n) => n.createdAt.desc())
      .limit(limit)
      .all();
    return rows.map((row) => mapUserNotificationRow(row as Record<string, unknown>));
  },

  async listForUser(userId: string, limit = 100): Promise<UserNotificationRecord[]> {
    const rows = await orm.UserNotification.where({ userId })
      .orderBy((n) => n.createdAt.desc())
      .limit(limit)
      .all();
    return rows.map((row) => mapUserNotificationRow(row as Record<string, unknown>));
  },

  async findOwned(userId: string, notificationId: string): Promise<UserNotificationRecord | null> {
    const row = await orm.UserNotification.where({ id: notificationId, userId }).first();
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
    await orm.UserNotification.where({ id: notificationId, userId }).update({
      readAt: now,
      updatedAt: now,
    });
    return { ...existing, readAt: now, updatedAt: now };
  },

  async markAllRead(userId: string): Promise<number> {
    const unread = await orm.UserNotification.where({ userId })
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
  ): Promise<void> {
    const now = new Date().toISOString();
    await orm.UserNotification.where({ id: notificationId, discordDeliveryStatus: "PENDING" }).update({
      discordDeliveryStatus: status,
      updatedAt: now,
    });
  },
};
