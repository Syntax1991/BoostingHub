import { orm } from "@/lib/prisma";
import { asString } from "@/lib/persistence";

export type DiscordGlobalAnnouncementRecord = {
  key: string;
  channelId: string;
  messageId: string;
  createdAt: string;
  updatedAt: string;
};

function mapRow(row: Record<string, unknown>): DiscordGlobalAnnouncementRecord {
  return {
    key: asString(row.key),
    channelId: asString(row.channelId),
    messageId: asString(row.messageId),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  };
}

export const discordGlobalAnnouncementRepository = {
  async findByKey(key: string): Promise<DiscordGlobalAnnouncementRecord | null> {
    const row = await orm.DiscordGlobalAnnouncement.where({ key }).first();
    return row ? mapRow(row as Record<string, unknown>) : null;
  },

  /**
   * Persist a successful one-time announcement. If the key already exists,
   * returns the existing row without updating (no repost bookkeeping).
   */
  async createIfAbsent(input: {
    key: string;
    channelId: string;
    messageId: string;
  }): Promise<{ created: boolean; record: DiscordGlobalAnnouncementRecord }> {
    const existing = await orm.DiscordGlobalAnnouncement.where({ key: input.key }).first();
    if (existing) {
      return { created: false, record: mapRow(existing as Record<string, unknown>) };
    }

    try {
      await orm.DiscordGlobalAnnouncement.create({
        key: input.key,
        channelId: input.channelId,
        messageId: input.messageId,
      });
    } catch {
      const raced = await orm.DiscordGlobalAnnouncement.where({ key: input.key }).first();
      if (raced) {
        return { created: false, record: mapRow(raced as Record<string, unknown>) };
      }
      throw new Error(`Failed to create DiscordGlobalAnnouncement ${input.key}`);
    }

    const created = await orm.DiscordGlobalAnnouncement.where({ key: input.key }).first();
    if (!created) {
      throw new Error(`Failed to load DiscordGlobalAnnouncement ${input.key} after create`);
    }
    return { created: true, record: mapRow(created as Record<string, unknown>) };
  },
};
