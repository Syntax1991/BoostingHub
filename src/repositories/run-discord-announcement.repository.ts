import { orm } from "@/lib/prisma";
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
  /** Initial status — PENDING when a channel may exist; callers may pass SKIPPED. */
  status?: DiscordDeliveryStatus;
  createdAt?: string;
};

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function mapRow(row: Record<string, unknown>): RunDiscordAnnouncementRecord {
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
    status: asEnum(row.status, DISCORD_DELIVERY_STATUSES, "PENDING"),
    createdAt: asString(row.createdAt),
    sentAt: asStringOrNull(row.sentAt),
    updatedAt: asString(row.updatedAt),
  };
}

export function runRescheduledChannelSourceKey(runId: string, scheduleRevision: number): string {
  return `run-rescheduled:${runId}:${scheduleRevision}`;
}

export function runCancelledChannelSourceKey(runId: string): string {
  return `run-cancelled:${runId}`;
}

export const runDiscordAnnouncementRepository = {
  async createIgnoreDuplicate(
    input: CreateRunDiscordAnnouncementInput,
  ): Promise<RunDiscordAnnouncementRecord | null> {
    const existing = await orm.RunDiscordAnnouncement.where({ sourceKey: input.sourceKey }).first();
    if (existing) return null;
    const now = input.createdAt ?? new Date().toISOString();
    const id = input.id ?? crypto.randomUUID();
    const status = input.status ?? "PENDING";
    try {
      await orm.RunDiscordAnnouncement.create({
        id,
        runId: input.runId,
        type: input.type,
        sourceKey: input.sourceKey,
        previousScheduledStartAt: input.previousScheduledStartAt,
        scheduledStartAt: input.scheduledStartAt,
        productLabel: input.productLabel,
        difficulty: input.difficulty,
        lootType: input.lootType,
        status,
        createdAt: now,
        sentAt: null,
        updatedAt: now,
      });
    } catch {
      const raced = await orm.RunDiscordAnnouncement.where({ sourceKey: input.sourceKey }).first();
      if (raced) return null;
      throw new Error(`Failed to create RunDiscordAnnouncement ${input.sourceKey}`);
    }
    const created = await orm.RunDiscordAnnouncement.where({ id }).first();
    return created ? mapRow(created as Record<string, unknown>) : null;
  },

  async listPending(limit = 50): Promise<RunDiscordAnnouncementRecord[]> {
    const rows = await orm.RunDiscordAnnouncement
      .where({ status: "PENDING" })
      .orderBy((row) => row.createdAt.asc())
      .limit(limit)
      .all();
    return (rows as Record<string, unknown>[])
      .map(mapRow)
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
    return row ? mapRow(row as Record<string, unknown>) : null;
  },

  async updateStatus(
    id: string,
    status: DiscordDeliveryStatus,
    options: { sentAt?: string | null } = {},
  ): Promise<void> {
    const now = new Date().toISOString();
    await orm.RunDiscordAnnouncement.where({ id }).update({
      status,
      ...(options.sentAt !== undefined ? { sentAt: options.sentAt } : {}),
      ...(status === "SENT" && options.sentAt === undefined ? { sentAt: now } : {}),
      updatedAt: now,
    });
  },
};
