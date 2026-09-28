import { orm } from "@/lib/prisma";
import { asNumber, asString, asStringOrNull } from "@/lib/persistence";
import { compareSnowflakes } from "@/lib/discord-snowflake";

export type WarcraftLogsDiscoveryStatus = "PENDING" | "MATCHED" | "NEEDS_REVIEW" | "IGNORED";

export type WarcraftLogsDiscoveryRecord = {
  id: string;
  channelId: string;
  messageId: string;
  authorId: string;
  reportCode: string;
  postedAt: string;
  status: WarcraftLogsDiscoveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastOutcome: string | null;
  linkedRunIds: string[];
};

const STATUSES: readonly WarcraftLogsDiscoveryStatus[] = ["PENDING", "MATCHED", "NEEDS_REVIEW", "IGNORED"];

function parseRunIds(value: unknown): string[] {
  try {
    const parsed = JSON.parse(asString(value) || "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Timestamps as ISO strings (Postgres returns its own text format). */
function iso(value: unknown): string | null {
  const text = asStringOrNull(value);
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? text : new Date(ms).toISOString();
}

function mapDiscovery(row: Record<string, unknown>): WarcraftLogsDiscoveryRecord {
  const status = asString(row.status) as WarcraftLogsDiscoveryStatus;
  return {
    id: asString(row.id),
    channelId: asString(row.channelId),
    messageId: asString(row.messageId),
    authorId: asString(row.authorId),
    reportCode: asString(row.reportCode),
    postedAt: iso(row.postedAt) ?? "",
    status: STATUSES.includes(status) ? status : "PENDING",
    attempts: asNumber(row.attempts),
    nextAttemptAt: iso(row.nextAttemptAt),
    lastAttemptAt: iso(row.lastAttemptAt),
    lastOutcome: asStringOrNull(row.lastOutcome),
    linkedRunIds: parseRunIds(row.linkedRunIds),
  };
}

export const warcraftLogsDiscoveryRepository = {
  /**
   * Record a report link seen in a dedicated log channel — once per
   * (channel, message, report). A repeat (the bot re-reading a message) is a
   * no-op and reports `created: false`.
   */
  async record(input: {
    channelId: string;
    messageId: string;
    authorId: string;
    reportCode: string;
    postedAt: string;
    now: string;
  }): Promise<{ created: boolean }> {
    const key = { channelId: input.channelId, messageId: input.messageId, reportCode: input.reportCode };
    if (await orm.WarcraftLogsReportDiscovery.where(key).first()) return { created: false };
    try {
      await orm.WarcraftLogsReportDiscovery.create({
        id: crypto.randomUUID(),
        ...key,
        authorId: input.authorId,
        postedAt: input.postedAt,
        status: "PENDING",
        attempts: 0,
        // Due from the moment it was posted, however late the bot reads it.
        nextAttemptAt: input.postedAt,
        lastAttemptAt: null,
        lastOutcome: null,
        linkedRunIds: "[]",
        createdAt: input.now,
        updatedAt: input.now,
      });
      return { created: true };
    } catch (error) {
      // Lost a concurrent insert of the same message: same outcome.
      if (await orm.WarcraftLogsReportDiscovery.where(key).first()) return { created: false };
      throw error;
    }
  },

  /** Due evaluations, oldest due first, bounded. */
  async listDue(now: string, limit: number): Promise<WarcraftLogsDiscoveryRecord[]> {
    const rows = (await orm.WarcraftLogsReportDiscovery.where((row) => row.nextAttemptAt.lte(now))
      .orderBy((row) => row.nextAttemptAt.asc())
      .limit(limit)
      .all()) as Array<Record<string, unknown>>;
    return rows.map(mapDiscovery);
  },

  async findByKey(key: { channelId: string; messageId: string; reportCode: string }): Promise<WarcraftLogsDiscoveryRecord | null> {
    const row = (await orm.WarcraftLogsReportDiscovery.where(key).first()) as Record<string, unknown> | null;
    return row ? mapDiscovery(row) : null;
  },

  /** Store one evaluation's outcome. `nextAttemptAt: null` settles it. */
  async saveEvaluation(input: {
    id: string;
    status: WarcraftLogsDiscoveryStatus;
    outcome: string;
    linkedRunIds: string[];
    nextAttemptAt: string | null;
    attemptedAt: string;
  }): Promise<void> {
    const existing = (await orm.WarcraftLogsReportDiscovery.where({ id: input.id }).first()) as Record<
      string,
      unknown
    > | null;
    if (!existing) return;
    await orm.WarcraftLogsReportDiscovery.where({ id: input.id }).update({
      status: input.status,
      lastOutcome: input.outcome,
      linkedRunIds: JSON.stringify([...new Set([...parseRunIds(existing.linkedRunIds), ...input.linkedRunIds])]),
      nextAttemptAt: input.nextAttemptAt,
      lastAttemptAt: input.attemptedAt,
      attempts: asNumber(existing.attempts) + 1,
      updatedAt: input.attemptedAt,
    });
  },

  /** channelId → newest fully processed message id (one query). */
  async cursorsFor(channelIds: string[]): Promise<Map<string, string>> {
    if (channelIds.length === 0) return new Map();
    const rows = (await orm.DiscordChannelScanCursor.where((row) => row.channelId.in(channelIds)).all()) as Array<
      Record<string, unknown>
    >;
    return new Map(rows.map((row) => [asString(row.channelId), asString(row.lastMessageId)]));
  },

  /** Forward-only: an older or equal message id never moves the cursor back. */
  async advanceCursor(input: { channelId: string; messageId: string; now: string }): Promise<boolean> {
    const existing = (await orm.DiscordChannelScanCursor.where({ channelId: input.channelId }).first()) as Record<
      string,
      unknown
    > | null;
    if (!existing) {
      try {
        await orm.DiscordChannelScanCursor.create({
          channelId: input.channelId,
          lastMessageId: input.messageId,
          updatedAt: input.now,
        });
        return true;
      } catch {
        // A concurrent first write won; fall through to the forward-only update.
      }
    }
    const current = existing ? asString(existing.lastMessageId) : null;
    if (current && compareSnowflakes(input.messageId, current) <= 0) return false;
    await orm.DiscordChannelScanCursor.where({ channelId: input.channelId }).update({
      lastMessageId: input.messageId,
      updatedAt: input.now,
    });
    return true;
  },
};
