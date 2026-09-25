import {
  AttachmentBuilder,
  ChannelType,
  type Client,
  type GuildTextBasedChannel,
  type MessageCreateOptions,
  type MessageEditOptions,
} from "discord.js";
import type { TicketPermissionOverwrite } from "@/discord-bot/tickets/access";
import { fetchChannelTranscript, type ChannelTranscript } from "@/discord-bot/transcript-fetch";

/**
 * The Discord operations the ticket flows need, behind a narrow seam so the
 * flows are testable without a gateway. The real adapter below is the only
 * place ticket code touches discord.js channel APIs.
 */
export type TicketDiscordPort = {
  guildId: string;
  botUserId(): string;
  guildName(): Promise<string>;
  createTicketChannel(input: {
    name: string;
    parentId: string;
    topic: string;
    overwrites: TicketPermissionOverwrite[];
    reason: string;
  }): Promise<{ id: string }>;
  /** Throws Discord's error (e.g. Unknown Channel 10003) for the caller to classify. */
  deleteChannel(channelId: string, reason: string): Promise<void>;
  /** true = exists, false = Discord said Unknown Channel; other errors throw. */
  channelExists(channelId: string): Promise<boolean>;
  send(channelId: string, payload: MessageCreateOptions): Promise<{ id: string }>;
  sendWithFile(
    channelId: string,
    payload: MessageCreateOptions,
    file: { name: string; content: string },
  ): Promise<{ id: string }>;
  editMessage(channelId: string, messageId: string, payload: MessageEditOptions): Promise<void>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  /** Unknown Message / Unknown Channel propagate as Discord errors. */
  fetchMessageExists(channelId: string, messageId: string): Promise<void>;
  fetchTranscript(channelId: string, cap: number): Promise<ChannelTranscript>;
};

async function textChannel(client: Client, channelId: string): Promise<GuildTextBasedChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.isDMBased() || !channel.isTextBased()) {
    throw new Error(`Channel ${channelId} is not a guild text channel`);
  }
  return channel;
}

export function createTicketDiscordPort(client: Client, guildId: string): TicketDiscordPort {
  return {
    guildId,
    botUserId() {
      const id = client.user?.id;
      if (!id) throw new Error("Discord client is not ready");
      return id;
    },
    async guildName() {
      return (await client.guilds.fetch(guildId)).name;
    },
    async createTicketChannel(input) {
      const guild = await client.guilds.fetch(guildId);
      const channel = await guild.channels.create({
        name: input.name,
        type: ChannelType.GuildText,
        parent: input.parentId,
        topic: input.topic,
        reason: input.reason,
        permissionOverwrites: input.overwrites,
      });
      return { id: channel.id };
    },
    async deleteChannel(channelId, reason) {
      const channel = await client.channels.fetch(channelId);
      if (channel && "delete" in channel && typeof channel.delete === "function") {
        await channel.delete(reason);
      }
    },
    async channelExists(channelId) {
      try {
        return Boolean(await client.channels.fetch(channelId));
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code === 10003 || code === "10003") return false;
        throw error;
      }
    },
    async send(channelId, payload) {
      const message = await (await textChannel(client, channelId)).send(payload);
      return { id: message.id };
    },
    async sendWithFile(channelId, payload, file) {
      const attachment = new AttachmentBuilder(Buffer.from(file.content, "utf8"), { name: file.name });
      const message = await (await textChannel(client, channelId)).send({ ...payload, files: [attachment] });
      return { id: message.id };
    },
    async editMessage(channelId, messageId, payload) {
      const message = await (await textChannel(client, channelId)).messages.fetch(messageId);
      await message.edit(payload);
    },
    async deleteMessage(channelId, messageId) {
      await (await textChannel(client, channelId)).messages.delete(messageId);
    },
    async fetchMessageExists(channelId, messageId) {
      await (await textChannel(client, channelId)).messages.fetch(messageId);
    },
    async fetchTranscript(channelId, cap) {
      const channel = await textChannel(client, channelId);
      return fetchChannelTranscript(channel, { cap, includeAttachments: true, detectTruncation: true });
    },
  };
}
