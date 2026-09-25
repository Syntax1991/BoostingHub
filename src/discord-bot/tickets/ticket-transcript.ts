import {
  buildArchiveTranscriptFilename,
  escapeHtml,
  formatTranscriptTimestamp,
  renderTranscriptMessage,
  summarizeTranscriptUsers,
  TRANSCRIPT_BASE_STYLES,
  type TranscriptMessage,
} from "@/discord-bot/archive-transcript";
import type { BotSupportTicket } from "@/discord-bot/bot-api-client";
import { formatSupportTicketNumber, SUPPORT_TICKET_TYPE_DEFINITIONS } from "@/lib/support-tickets";

/** Same safe cap as the Run archive transcript. */
export { ARCHIVE_TRANSCRIPT_MESSAGE_CAP as TICKET_TRANSCRIPT_MESSAGE_CAP } from "@/discord-bot/archive-transcript";

const TICKET_STYLES = `.ticket-meta{padding:16px 24px;max-width:900px;margin:0 auto;border-bottom:1px solid #3f4147}
.ticket-meta h1{font-size:20px;color:#f2f3f5;margin:0 0 8px}
.ticket-meta dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0;font-size:14px}
.ticket-meta dt{color:#949ba4}
.ticket-meta dd{margin:0;white-space:pre-wrap;word-break:break-word}
.truncated{margin:12px auto 0;max-width:900px;padding:8px 12px;background:#4e2a2a;border-left:4px solid #f23f43;border-radius:0 4px 4px 0}
.attachments{margin:6px 0 0;padding-left:18px;font-size:13px}
.attachments a{color:#00a8fc}`;

export function buildTicketTranscriptFilename(channelName: string): string {
  return buildArchiveTranscriptFilename(channelName);
}

/**
 * Support-ticket HTML transcript: ticket header, then the same message
 * rendering as the Run archive (shared helpers). Attachments appear as
 * name + Discord CDN link only. A capped history says so explicitly.
 */
export function buildTicketTranscriptHtml(input: {
  ticket: BotSupportTicket;
  guildName: string;
  guildId: string;
  channelName: string;
  channelId: string;
  closedAt: string;
  closedByDiscordUserId: string;
  messages: TranscriptMessage[];
  truncated: boolean;
}): string {
  const { ticket } = input;
  const users = summarizeTranscriptUsers(input.messages);
  const row = (label: string, value: string) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
  const rows = [
    row("Ticket", `#${formatSupportTicketNumber(ticket.number)}`),
    row("Type", SUPPORT_TICKET_TYPE_DEFINITIONS[ticket.type].label),
    row("Creator", `${ticket.creatorDisplayName} (${ticket.creatorDiscordUserId})`),
    ...(ticket.type === "REPORT_BOOSTER"
      ? [
          row(
            "Reported Booster",
            ticket.reportedDiscordUserId
              ? `${ticket.reportedBoosterLabel ?? ""} (${ticket.reportedDiscordUserId})`
              : (ticket.reportedBoosterLabel ?? "—"),
          ),
        ]
      : []),
    row("Subject", ticket.subject),
    ...(ticket.reference ? [row("Reference", ticket.reference)] : []),
    row("Description", ticket.description),
    row("Server", `${input.guildName} (${input.guildId})`),
    row("Channel", `${input.channelName} (${input.channelId})`),
    `<dt>Created</dt><dd>${formatTranscriptTimestamp(ticket.createdAt)}</dd>`,
    `<dt>Closed</dt><dd>${formatTranscriptTimestamp(input.closedAt)}</dd>`,
    row("Closed by", input.closedByDiscordUserId),
    row("Messages", String(input.messages.length)),
    row("Participants", users.map((user) => `${user.messageCount} - ${user.tag} (${user.authorId})`).join("\n") || "(none)"),
  ].join("\n");

  const truncatedNotice = input.truncated
    ? `<p class="truncated"><strong>Transcript truncated:</strong> only the newest ${input.messages.length} messages are included; older messages were not archived.</p>`
    : "";
  const messages = input.messages.map(renderTranscriptMessage).join("\n");
  const title = `Ticket #${formatSupportTicketNumber(ticket.number)} — ${SUPPORT_TICKET_TYPE_DEFINITIONS[ticket.type].label}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
${TRANSCRIPT_BASE_STYLES}
${TICKET_STYLES}
</style>
</head>
<body>
<section class="ticket-meta">
<h1>${escapeHtml(title)}</h1>
<dl>
${rows}
</dl>
</section>
${truncatedNotice}
<div class="transcript">
${messages || "<p>(no messages)</p>"}
</div>
</body>
</html>
`;
}
