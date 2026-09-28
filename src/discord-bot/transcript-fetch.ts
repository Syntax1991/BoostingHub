import { ARCHIVE_TRANSCRIPT_MESSAGE_CAP, type TranscriptMessage } from "@/discord-bot/archive-transcript";
import {
  classifyMessageContent,
  refineCapabilityFromMessages,
  type MessageContentFacts,
  type MessageContentStatus,
} from "@/discord-bot/message-content";

type Sized<T> = { size: number; values(): Iterable<T> };

type FetchedMessage = {
  id: string;
  createdTimestamp: number;
  editedTimestamp?: number | null;
  author: { id: string; username?: string | null; discriminator?: string | null; displayName?: string | null };
  content?: string | null;
  embeds: Array<{ title?: string | null; description?: string | null }>;
  /** discord.js: true for pins, joins, thread-created and other non-user messages. */
  system?: boolean | null;
  attachments?: Sized<{ name?: string | null; size?: number | null }> | null;
  stickers?: Sized<{ name?: string | null }> | null;
  components?: readonly unknown[] | null;
  poll?: unknown;
  mentions?: { users?: { has(id: string): boolean } | null } | null;
};

type FetchedBatch = { size: number; values(): Iterable<FetchedMessage> };

/** The slice of a discord.js text channel the transcript needs (REST history paging). */
export type TranscriptSourceChannel = {
  messages: { fetch(options: { limit: number; before?: string }): Promise<FetchedBatch> };
};

export type ChannelTranscript = {
  /** Oldest → newest. */
  messages: TranscriptMessage[];
  /** Message Content access for this transcript (refined by what the channel delivered). */
  messageContent: MessageContentStatus;
};

function factsOf(message: FetchedMessage, appUserId: string | null): MessageContentFacts {
  return {
    content: message.content ?? "",
    hasEmbeds: message.embeds.length > 0,
    hasAttachments: (message.attachments?.size ?? 0) > 0,
    hasComponents: (message.components?.length ?? 0) > 0,
    hasPoll: message.poll != null,
    hasStickers: (message.stickers?.size ?? 0) > 0,
    isSystem: message.system === true,
    authoredByApp: appUserId != null && message.author.id === appUserId,
    mentionsApp: appUserId != null && message.mentions?.users?.has(appUserId) === true,
  };
}

/**
 * Pages channel history newest → oldest via REST (no extra gateway intent),
 * never beyond `cap`, and returns it oldest → newest (the newest `cap`
 * messages). Used by the Run app-archive. Attachments are never downloaded —
 * only their names and sizes are listed.
 *
 * Each message says whether its text is present, legitimately absent, or
 * withheld by Discord (no Message Content access) — nothing is invented.
 */
export async function fetchChannelTranscript(
  channel: TranscriptSourceChannel,
  options: { cap?: number; appUserId?: string | null; messageContent?: MessageContentStatus } = {},
): Promise<ChannelTranscript> {
  const cap = options.cap ?? ARCHIVE_TRANSCRIPT_MESSAGE_CAP;
  const appUserId = options.appUserId ?? null;
  const collected: FetchedMessage[] = [];
  let before: string | undefined;

  while (collected.length < cap) {
    const limit = Math.min(100, cap - collected.length);
    const batch = await channel.messages.fetch({ limit, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    const values = [...batch.values()];
    collected.push(...values);
    const oldest = [...values].sort((a, b) => a.createdTimestamp - b.createdTimestamp)[0];
    before = oldest?.id;
    if (batch.size < limit) break;
  }

  collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const kept = collected.slice(0, cap);
  const facts = kept.map((message) => factsOf(message, appUserId));
  const messageContent = refineCapabilityFromMessages(
    options.messageContent ?? { capability: "UNKNOWN", source: "NONE" },
    facts,
  );
  const messages = kept.map(
    (message, index): TranscriptMessage => ({
      id: message.id,
      createdAt: new Date(message.createdTimestamp).toISOString(),
      authorDisplayName: message.author.displayName || message.author.username || "Unknown",
      authorUsername: message.author.username || "unknown",
      authorDiscriminator: message.author.discriminator || "0",
      authorId: message.author.id,
      editedAt: message.editedTimestamp ? new Date(message.editedTimestamp).toISOString() : null,
      content: message.content ?? "",
      contentState: classifyMessageContent(facts[index]!, messageContent.capability),
      embeds: message.embeds.map((embed) => ({
        title: embed.title ?? null,
        description: embed.description ?? null,
      })),
      attachments: [...(message.attachments?.values() ?? [])].map((attachment) => ({
        name: attachment.name || "attachment",
        size: attachment.size ?? null,
      })),
      stickers: [...(message.stickers?.values() ?? [])].map((sticker) => sticker.name || "sticker"),
      system: message.system === true,
    }),
  );
  return { messages, messageContent };
}
