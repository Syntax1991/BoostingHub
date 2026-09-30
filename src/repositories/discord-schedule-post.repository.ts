import { orm } from "@/lib/prisma";
import { asString, asStringOrNull } from "@/lib/persistence";
import type { DiscordScheduleBucket } from "@/lib/discord-schedule";

export type DiscordSchedulePostRecord = {
  bucket: DiscordScheduleBucket;
  channelId: string | null;
  messageId: string | null;
  lastSignature: string | null;
};

function mapRow(row: Record<string, unknown>): DiscordSchedulePostRecord {
  return {
    bucket: asString(row.bucket) as DiscordScheduleBucket,
    channelId: asStringOrNull(row.channelId),
    messageId: asStringOrNull(row.messageId),
    lastSignature: asStringOrNull(row.lastSignature),
  };
}

export const discordSchedulePostRepository = {
  async listAll(): Promise<DiscordSchedulePostRecord[]> {
    const rows = await orm.DiscordSchedulePost.select(
      "bucket",
      "channelId",
      "messageId",
      "lastSignature",
    ).all();
    return rows.map((row) => mapRow(row as Record<string, unknown>));
  },

  async findByBucket(bucket: DiscordScheduleBucket): Promise<DiscordSchedulePostRecord | null> {
    const row = await orm.DiscordSchedulePost.where({ bucket })
      .select("bucket", "channelId", "messageId", "lastSignature")
      .first();
    return row ? mapRow(row as Record<string, unknown>) : null;
  },

  async recordPost(input: {
    bucket: DiscordScheduleBucket;
    channelId: string;
    messageId: string;
    signature: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const existing = await orm.DiscordSchedulePost.where({ bucket: input.bucket }).select("id").first();
    if (existing) {
      await orm.DiscordSchedulePost.where({ bucket: input.bucket }).update({
        channelId: input.channelId,
        messageId: input.messageId,
        lastSignature: input.signature,
        updatedAt: now,
      });
      return;
    }
    await orm.DiscordSchedulePost.create({
      id: crypto.randomUUID(),
      bucket: input.bucket,
      channelId: input.channelId,
      messageId: input.messageId,
      lastSignature: input.signature,
      createdAt: now,
      updatedAt: now,
    });
  },
};
