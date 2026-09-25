import { ARCHIVE_TRANSCRIPT_MESSAGE_CAP, type TranscriptMessage } from "@/discord-bot/archive-transcript";

type FetchedMessage = {
  id: string;
  createdTimestamp: number;
  author: { id: string; username?: string | null; discriminator?: string | null; displayName?: string | null };
  content?: string | null;
  embeds: Array<{ title?: string | null; description?: string | null }>;
  attachments?: { values(): Iterable<{ name?: string | null; url: string; size?: number | null; contentType?: string | null }> };
};

type FetchedBatch = { size: number; values(): Iterable<FetchedMessage> };

/** The slice of a discord.js text channel the transcript needs (REST history paging). */
export type TranscriptSourceChannel = {
  messages: { fetch(options: { limit: number; before?: string }): Promise<FetchedBatch> };
};

export type ChannelTranscript = {
  /** Oldest → newest. */
  messages: TranscriptMessage[];
  /** True when older messages exist beyond the cap (only when `detectTruncation`). */
  truncated: boolean;
};

/**
 * Pages channel history newest → oldest via REST (no extra gateway intent),
 * never beyond `cap`, and returns it oldest → newest. Used by the Run
 * app-archive (defaults: no attachments, no truncation probe — unchanged
 * behavior) and by Support-ticket close (attachment metadata + probe).
 * Attachment binaries are never downloaded; only name/URL/size are kept.
 */
export async function fetchChannelTranscript(
  channel: TranscriptSourceChannel,
  options: { cap?: number; includeAttachments?: boolean; detectTruncation?: boolean } = {},
): Promise<ChannelTranscript> {
  const cap = options.cap ?? ARCHIVE_TRANSCRIPT_MESSAGE_CAP;
  const collected: FetchedMessage[] = [];
  let before: string | undefined;
  let exhausted = false;

  while (collected.length < cap) {
    const limit = Math.min(100, cap - collected.length);
    const batch = await channel.messages.fetch({ limit, ...(before ? { before } : {}) });
    if (batch.size === 0) {
      exhausted = true;
      break;
    }
    const values = [...batch.values()];
    collected.push(...values);
    const oldest = [...values].sort((a, b) => a.createdTimestamp - b.createdTimestamp)[0];
    before = oldest?.id;
    if (batch.size < limit) {
      exhausted = true;
      break;
    }
  }

  let truncated = false;
  if (options.detectTruncation && !exhausted && before) {
    const probe = await channel.messages.fetch({ limit: 1, before });
    truncated = probe.size > 0;
  }

  collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const messages = collected.slice(0, cap).map((message): TranscriptMessage => {
    const mapped: TranscriptMessage = {
      id: message.id,
      createdAt: new Date(message.createdTimestamp).toISOString(),
      authorDisplayName: message.author.displayName || message.author.username || "Unknown",
      authorUsername: message.author.username || "unknown",
      authorDiscriminator: message.author.discriminator || "0",
      authorId: message.author.id,
      content: message.content ?? "",
      embeds: message.embeds.map((embed) => ({
        title: embed.title ?? null,
        description: embed.description ?? null,
      })),
    };
    if (options.includeAttachments && message.attachments) {
      mapped.attachments = [...message.attachments.values()].map((attachment) => ({
        name: attachment.name ?? "attachment",
        url: attachment.url,
        size: attachment.size ?? null,
        contentType: attachment.contentType ?? null,
      }));
    }
    return mapped;
  });
  return { messages, truncated };
}
