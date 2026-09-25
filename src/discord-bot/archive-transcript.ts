/**
 * Pure HTML / text builders for app-archived Run Discord channels.
 *
 * Mirrors Ticket Tool's downloadable transcript shape:
 *   <Server-Info> … <User-Info> … <Base-Transcript> …
 * without Ticket Tool's proprietary JS bundle (window.Convert).
 */

export type TranscriptEmbed = {
  title?: string | null;
  description?: string | null;
};

/** Attachment metadata only — the binary is never downloaded. */
export type TranscriptAttachment = {
  name: string;
  url: string;
  size?: number | null;
  contentType?: string | null;
};

export type TranscriptMessage = {
  id: string;
  createdAt: string;
  authorDisplayName: string;
  authorUsername: string;
  authorDiscriminator: string;
  authorId: string;
  content: string;
  embeds?: TranscriptEmbed[];
  /** Populated by the Support-ticket transcript only; Run transcripts omit it. */
  attachments?: TranscriptAttachment[];
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

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatTranscriptTimestamp(iso: string): string {
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

function safeHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Links to Discord's CDN copy; renders nothing when a message has no attachments. */
function renderAttachments(attachments: TranscriptAttachment[] | undefined): string {
  if (!attachments?.length) return "";
  const items = attachments
    .map((attachment) => {
      const name = escapeHtml(attachment.name || "attachment");
      const url = safeHttpUrl(attachment.url);
      const size = typeof attachment.size === "number" ? ` <span class="size">(${attachment.size} bytes)</span>` : "";
      return url
        ? `<li><a href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank">${name}</a>${size}</li>`
        : `<li>${name}${size}</li>`;
    })
    .join("");
  return `<ul class="attachments">${items}</ul>`;
}

/** One message block — shared by Run and Support-ticket transcripts. */
export function renderTranscriptMessage(message: TranscriptMessage): string {
  const body = escapeHtml(message.content || "");
  const embeds = renderEmbeds(message.embeds);
  const attachments = renderAttachments(message.attachments);
  const tag = formatAuthorTag(message.authorUsername, message.authorDiscriminator);
  return `<div class="message" data-id="${escapeHtml(message.id)}">
  <div class="meta"><strong>${escapeHtml(message.authorDisplayName)}</strong> <span class="tag">${escapeHtml(tag)}</span> <span class="id">(${escapeHtml(message.authorId)})</span> <time>${formatTranscriptTimestamp(message.createdAt)}</time></div>
  <div class="content">${body || "<em>(no text)</em>"}</div>
  ${embeds}${attachments ? `\n  ${attachments}` : ""}
</div>`;
}

/** Discord-like dark theme shared by Run and Support-ticket transcripts. */
export const TRANSCRIPT_BASE_STYLES = `body{margin:0;font-family:Whitney,"Helvetica Neue",Helvetica,Arial,sans-serif;background:#313338;color:#dbdee1}
.transcript{padding:16px 24px;max-width:900px;margin:0 auto}
.message{padding:8px 0;border-top:1px solid #3f4147}
.meta{font-size:12px;color:#949ba4;margin-bottom:4px}
.meta strong{color:#f2f3f5;font-size:14px}
.tag,.id,time{margin-left:6px}
.content{white-space:pre-wrap;word-break:break-word;line-height:1.375}
.embed{margin-top:6px;padding:8px 12px;border-left:4px solid #57f287;background:#2b2d31;border-radius:0 4px 4px 0}
.embed-title{font-weight:600;margin-bottom:4px}`;

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
}): string {
  const capped = input.messages.slice(0, MAX_MESSAGES);
  const users = summarizeTranscriptUsers(capped);
  const userLines =
    users.map((user) => `    ${user.messageCount} - ${user.tag} (${user.authorId})`).join("\n") || "    (none)";
  const rows = capped.map(renderTranscriptMessage).join("\n");

  // Ticket Tool files start as raw text headers (openable as .html still works
  // in browsers once Base-Transcript switches to markup).
  const header = `<Server-Info>
    Server: ${input.serverName} (${input.serverId})
    Channel: ${input.channelName} (${input.channelId})
    Messages: ${capped.length}
    Attachments Saved: 0
    Attachments Skipped: 0 (due maximum file size limits.)
    
<User-Info>
${userLines}

<Base-Transcript>
`;

  const styles = `<style>
${TRANSCRIPT_BASE_STYLES}
</style>`;

  return `${header}${styles}
<div class="transcript">
${rows || "<p>(no messages)</p>"}
</div>
`;
}

export const ARCHIVE_TRANSCRIPT_MESSAGE_CAP = MAX_MESSAGES;
