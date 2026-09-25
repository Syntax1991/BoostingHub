import { ARCHIVE_TRANSCRIPT_MESSAGE_CAP, type TranscriptMessage } from "@/discord-bot/archive-transcript";

type FetchedMessage = {
  id: string;
  createdTimestamp: number;
  author: { id: string; username?: string | null; discriminator?: string | null; displayName?: string | null };
  content?: string | null;
  embeds: Array<{ title?: string | null; description?: string | null }>;
};

type FetchedBatch = { size: number; values(): Iterable<FetchedMessage> };

/** The slice of a discord.js text channel the transcript needs (REST history paging). */
export type TranscriptSourceChannel = {
  messages: { fetch(options: { limit: number; before?: string }): Promise<FetchedBatch> };
};

export type ChannelTranscript = {
  /** Oldest → newest. */
  messages: TranscriptMessage[];
};

/**
 * Pages channel history newest → oldest via REST (no extra gateway intent),
 * never beyond `cap`, and returns it oldest → newest (the newest `cap`
 * messages). Used by the Run app-archive. Attachments are never downloaded.
 */
export async function fetchChannelTranscript(
  channel: TranscriptSourceChannel,
  options: { cap?: number } = {},
): Promise<ChannelTranscript> {
  const cap = options.cap ?? ARCHIVE_TRANSCRIPT_MESSAGE_CAP;
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
  const messages = collected.slice(0, cap).map(
    (message): TranscriptMessage => ({
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
    }),
  );
  return { messages };
}
