/**
 * Pure HTML / text builders for app-archived Run Discord channels.
 *
 * Mirrors Ticket Tool's downloadable transcript shape:
 *   <Server-Info> … <User-Info> … <Base-Transcript> …
 * without Ticket Tool's proprietary JS bundle (window.Convert).
 *
 * Text Discord withheld (no Message Content access) is shown as unavailable,
 * never as an empty message and never invented. Every interpolated value is
 * HTML-escaped.
 */

import type { MessageContentCapability, MessageContentState } from "@/discord-bot/message-content";

export type TranscriptEmbed = {
  title?: string | null;
  description?: string | null;
};

export type TranscriptMessage = {
  id: string;
  createdAt: string;
  authorDisplayName: string;
  authorUsername: string;
  authorDiscriminator: string;
  authorId: string;
  /** Set when the message was edited (ISO). */
  editedAt?: string | null;
  content: string;
  /** Absent for messages built before content states existed: treated as TEXT / no text. */
  contentState?: MessageContentState;
  embeds?: TranscriptEmbed[];
  /** Attachment metadata only — files are never downloaded. */
  attachments?: Array<{ name: string; size: number | null }>;
  stickers?: string[];
  system?: boolean;
};

export type TranscriptUserStat = {
  authorId: string;
  displayName: string;
  username: string;
  discriminator: string;
  tag: string;
  messageCount: number;
};

const MAX_MESSAGES = 500;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return escapeHtml(iso);
  return escapeHtml(date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC"));
}

export function formatAuthorTag(username: string, discriminator: string): string {
  const disc = discriminator?.trim() || "0";
  return `${username}#${disc}`;
}

/** Safe Discord attachment filename: `transcript-{channelName}.html`. */
export function buildArchiveTranscriptFilename(channelName: string): string {
  const safe = channelName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `transcript-${safe || "channel"}.html`;
}

export function summarizeTranscriptUsers(messages: TranscriptMessage[]): TranscriptUserStat[] {
  const byId = new Map<string, TranscriptUserStat>();
  for (const message of messages) {
    const existing = byId.get(message.authorId);
    if (existing) {
      existing.messageCount += 1;
      continue;
    }
    byId.set(message.authorId, {
      authorId: message.authorId,
      displayName: message.authorDisplayName,
      username: message.authorUsername,
      discriminator: message.authorDiscriminator,
      tag: formatAuthorTag(message.authorUsername, message.authorDiscriminator),
      messageCount: 1,
    });
  }
  return [...byId.values()].sort((a, b) => b.messageCount - a.messageCount || a.tag.localeCompare(b.tag));
}

/**
 * Ticket Tool–style Server-Info block posted (with the HTML attachment) to the
 * archive log channel. Discord `xml` fence gives the dark code box and purple
 * `<Server-Info>` highlight; body lines use two-space indent.
 */
export function buildArchiveServerInfoContent(input: {
  serverName: string;
  serverId: string;
  channelName: string;
  channelId: string;
  messageCount: number;
  attachmentsSaved?: number;
  attachmentsSkipped?: number;
  /** Shown when known, so an incomplete transcript is explained where it is posted. */
  messageContent?: TranscriptContentState;
}): string {
  const saved = input.attachmentsSaved ?? 0;
  const skipped = input.attachmentsSkipped ?? 0;
  const body = [
    "<Server-Info>",
    `  Server: ${input.serverName} (${input.serverId})`,
    `  Channel: ${input.channelName} (${input.channelId})`,
    `  Messages: ${input.messageCount}`,
    `  Attachments Saved: ${saved}`,
    `  Attachments Skipped: ${skipped} (due maximum file size limits.)`,
    ...(input.messageContent ? [`  Message Content: ${input.messageContent}`] : []),
  ].join("\n");
  return ["```xml", body, "```"].join("\n");
}

function renderEmbeds(embeds: TranscriptEmbed[] | undefined): string {
  if (!embeds?.length) return "";
  return embeds
    .map((embed) => {
      const title = embed.title?.trim() ? `<div class="embed-title">${escapeHtml(embed.title)}</div>` : "";
      const description = embed.description?.trim()
        ? `<div class="embed-description">${escapeHtml(embed.description)}</div>`
        : "";
      if (!title && !description) return "";
      return `<div class="embed">${title}${description}</div>`;
    })
    .filter(Boolean)
    .join("\n");
}

function formatBytes(size: number | null): string {
  if (size == null) return "";
  if (size < 1024) return ` (${size} B)`;
  if (size < 1024 * 1024) return ` (${(size / 1024).toFixed(1)} KB)`;
  return ` (${(size / 1024 / 1024).toFixed(1)} MB)`;
}

function renderExtras(message: TranscriptMessage): string {
  const rows = [
    ...(message.attachments ?? []).map((attachment) => `Attachment: ${escapeHtml(attachment.name)}${formatBytes(attachment.size)}`),
    ...(message.stickers ?? []).map((sticker) => `Sticker: ${escapeHtml(sticker)}`),
  ];
  return rows.length ? `<div class="extras">${rows.map((row) => `<div>${row}</div>`).join("")}</div>` : "";
}

/** The text slot: real text (escaped), or an honest placeholder. */
function renderBody(message: TranscriptMessage): string {
  const text = message.content.trim() ? escapeHtml(message.content) : "";
  if (text && message.contentState !== "UNAVAILABLE") return text;
  switch (message.contentState) {
    case "UNAVAILABLE":
      return '<em class="unavailable">(message content unavailable)</em>';
    case "UNKNOWN":
      return '<em class="unavailable">(message content unavailable or empty)</em>';
    default:
      return message.system ? "<em>(system message)</em>" : "<em>(no text)</em>";
  }
}

function renderMessage(message: TranscriptMessage): string {
  const embeds = renderEmbeds(message.embeds);
  const extras = renderExtras(message);
  const tag = formatAuthorTag(message.authorUsername, message.authorDiscriminator);
  // A non-text message shows its embed / attachment / sticker instead of a "(no text)" placeholder.
  const body = message.contentState === "NON_TEXT" && !message.system && (embeds || extras) ? "" : renderBody(message);
  return `<div class="message" data-id="${escapeHtml(message.id)}">
  <div class="meta"><strong>${escapeHtml(message.authorDisplayName)}</strong> <span class="tag">${escapeHtml(tag)}</span> <span class="id">(${escapeHtml(message.authorId)})</span> <time>${formatTimestamp(message.createdAt)}</time>${message.editedAt ? ` <span class="edited">(edited ${formatTimestamp(message.editedAt)})</span>` : ""}</div>
  ${body ? `<div class="content">${body}</div>` : ""}
  ${embeds}${extras}
</div>`;
}

/**
 * How complete one transcript's message content is — a transcript-level
 * result, separate from the application's access:
 * AVAILABLE: nothing withheld. PARTIAL: some messages withheld while others
 * (the app's own, messages mentioning it) were delivered. UNAVAILABLE: every
 * message withheld. UNKNOWN: access unknown and empty messages from others seen.
 */
export type TranscriptContentState = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "UNKNOWN";

export function transcriptMessageContent(
  messages: ReadonlyArray<Pick<TranscriptMessage, "contentState">>,
  capability: MessageContentCapability,
): { state: TranscriptContentState; unavailable: number; unknown: number } {
  const unavailable = messages.filter((message) => message.contentState === "UNAVAILABLE").length;
  const unknown = messages.filter((message) => message.contentState === "UNKNOWN").length;
  const delivered = messages.length - unavailable - unknown;
  const state: TranscriptContentState =
    unavailable > 0
      ? delivered > 0
        ? "PARTIAL"
        : "UNAVAILABLE"
      : unknown > 0
        ? "UNKNOWN"
        : messages.length === 0
          ? capability
          : "AVAILABLE";
  return { state, unavailable, unknown };
}

function renderContentNotice(state: { unavailable: number; unknown: number }): string {
  if (state.unavailable > 0) {
    return `<div class="notice" role="note">⚠ Some message text could not be archived because Discord Message Content access was unavailable to Manawyrm Hub. ${state.unavailable} message${state.unavailable === 1 ? "" : "s"} from other members show as “message content unavailable”. Author, time and message id are still recorded.</div>`;
  }
  if (state.unknown > 0) {
    return `<div class="notice" role="note">⚠ Discord Message Content access could not be confirmed. ${state.unknown} empty message${state.unknown === 1 ? "" : "s"} from other members may have had text that Discord did not provide.</div>`;
  }
  return "";
}

/**
 * Downloadable transcript file — Ticket Tool header layout, then a readable
 * Base-Transcript (no tickettool.xyz JS).
 */
export function buildArchiveTranscriptHtml(input: {
  serverName: string;
  serverId: string;
  channelName: string;
  channelId: string;
  runId: string;
  messages: TranscriptMessage[];
  generatedAt?: Date;
  /** Message Content access when the transcript was taken (UNKNOWN when not determined). */
  messageContent?: MessageContentCapability;
}): string {
  const capped = input.messages.slice(0, MAX_MESSAGES);
  const users = summarizeTranscriptUsers(capped);
  const userLines =
    users.map((user) => `    ${user.messageCount} - ${escapeHtml(user.tag)} (${escapeHtml(user.authorId)})`).join("\n") ||
    "    (none)";
  const rows = capped.map(renderMessage).join("\n");
  const content = transcriptMessageContent(capped, input.messageContent ?? "UNKNOWN");

  // Ticket Tool files start as raw text headers (openable as .html still works
  // in browsers once Base-Transcript switches to markup).
  const header = `<Server-Info>
    Server: ${escapeHtml(input.serverName)} (${escapeHtml(input.serverId)})
    Channel: ${escapeHtml(input.channelName)} (${escapeHtml(input.channelId)})
    Messages: ${capped.length}
    Attachments Saved: 0
    Attachments Skipped: 0 (due maximum file size limits.)
    Message Content: ${content.state}
    
<User-Info>
${userLines}

<Base-Transcript>
`;

  const styles = `<style>
body{margin:0;font-family:Whitney,"Helvetica Neue",Helvetica,Arial,sans-serif;background:#313338;color:#dbdee1}
.transcript{padding:16px 24px;max-width:900px;margin:0 auto}
.message{padding:8px 0;border-top:1px solid #3f4147}
.meta{font-size:12px;color:#949ba4;margin-bottom:4px}
.meta strong{color:#f2f3f5;font-size:14px}
.tag,.id,time{margin-left:6px}
.content{white-space:pre-wrap;word-break:break-word;line-height:1.375}
.embed{margin-top:6px;padding:8px 12px;border-left:4px solid #57f287;background:#2b2d31;border-radius:0 4px 4px 0}
.embed-title{font-weight:600;margin-bottom:4px}
.unavailable{color:#f0b232}
.extras{margin-top:4px;font-size:12px;color:#949ba4}
.edited{margin-left:6px;font-style:italic}
.notice{margin:0 0 12px;padding:8px 12px;border-left:4px solid #f0b232;background:#2b2d31;color:#f2f3f5}
</style>
<meta name="manawyrm-message-content" content="${content.state}">`;

  return `${header}${styles}
<div class="transcript">
${renderContentNotice(content)}${rows || "<p>(no messages)</p>"}
</div>
`;
}

export const ARCHIVE_TRANSCRIPT_MESSAGE_CAP = MAX_MESSAGES;
