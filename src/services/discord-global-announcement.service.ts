import { discordGlobalAnnouncementRepository } from "@/repositories/discord-global-announcement.repository";

/**
 * Durable one-time Discord product announcement delivery.
 * Controllers/API stay thin; the bot owns message content and Discord send.
 */
export const discordGlobalAnnouncementService = {
  async getByKey(key: string) {
    const record = await discordGlobalAnnouncementRepository.findByKey(key);
    if (!record) return { recorded: false as const };
    return {
      recorded: true as const,
      key: record.key,
      channelId: record.channelId,
      messageId: record.messageId,
    };
  },

  async recordDelivery(input: { key: string; channelId: string; messageId: string }) {
    const result = await discordGlobalAnnouncementRepository.createIfAbsent(input);
    return {
      recorded: true as const,
      created: result.created,
      key: result.record.key,
      channelId: result.record.channelId,
      messageId: result.record.messageId,
    };
  },
};
