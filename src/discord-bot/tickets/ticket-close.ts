import type { ButtonInteraction } from "discord.js";
import { BotApiError, type BotSupportTicket } from "@/discord-bot/bot-api-client";
import { isDiscordUnknownChannelError, summarizeDiscordError } from "@/discord-bot/discord-api-errors";
import { describeBotApiError } from "@/discord-bot/interactions/error-copy";
import { canCloseTicket, extractMemberRoleIds } from "@/discord-bot/tickets/access";
import type { TicketDeps } from "@/discord-bot/tickets/ticket-create";
import { buildCloseConfirmation, buildTicketArchiveSummary, NO_MENTIONS } from "@/discord-bot/tickets/ticket-messages";
import {
  buildTicketTranscriptFilename,
  buildTicketTranscriptHtml,
  TICKET_TRANSCRIPT_MESSAGE_CAP,
} from "@/discord-bot/tickets/ticket-transcript";
import type { ChannelTranscript } from "@/discord-bot/transcript-fetch";

export type CloseTicketOutcome =
  | { kind: "closed" }
  | { kind: "busy" }
  | { kind: "channel-missing" }
  | { kind: "failed"; stage: "TRANSCRIPT" | "ARCHIVE" | "DELETE" };

async function reportFailure(
  deps: TicketDeps,
  ticket: BotSupportTicket,
  stage: "TRANSCRIPT" | "ARCHIVE" | "DELETE",
  error: unknown,
): Promise<CloseTicketOutcome> {
  console.error(`[discord-bot] ticket ${ticket.id}: close ${stage} failed — channel kept, close is retryable`, error);
  await deps.api.recordTicketCloseFailure(ticket.id, stage, summarizeDiscordError(error)).catch((recordError) => {
    console.error(`[discord-bot] ticket ${ticket.id}: could not record close failure`, recordError);
  });
  if (ticket.channelId) {
    await deps.port
      .send(ticket.channelId, {
        content:
          stage === "DELETE"
            ? "⚠️ The transcript is archived, but this channel could not be deleted. Press **Close Ticket** to retry."
            : "⚠️ Closing failed — nothing was deleted and no data was lost. Press **Close Ticket** to retry.",
        allowedMentions: NO_MENTIONS,
      })
      .catch(() => undefined);
  }
  return { kind: "failed", stage };
}

async function finalizeAfterDelete(deps: TicketDeps, ticket: BotSupportTicket, channelId: string): Promise<CloseTicketOutcome> {
  try {
    await deps.port.deleteChannel(channelId, `BoostingHub ticket ${ticket.id} closed — transcript archived`);
  } catch (error) {
    if (!isDiscordUnknownChannelError(error)) return reportFailure(deps, ticket, "DELETE", error);
  }
  await deps.api.finalizeTicketClose(ticket.id);
  return { kind: "closed" };
}

/**
 * Confirmed close. The channel is deleted only after the transcript is
 * persisted AND the archive-log post is recorded:
 *   begin-close (lease) → fetch history → build HTML → persist transcript →
 *   post summary + HTML to the archive log → record archiveMessageId →
 *   delete channel → finalize CLOSED.
 * A retry after a delete failure skips straight to the delete (archive is
 * never re-posted). Unknown Channel before any transcript closes the ticket
 * with an operator-visible error instead of fabricating one.
 */
export async function closeTicket(
  deps: TicketDeps,
  ticketId: string,
  actorDiscordUserId: string,
  now: () => Date = () => new Date(),
): Promise<CloseTicketOutcome> {
  const begun = await deps.api.beginTicketClose(ticketId, actorDiscordUserId);
  if (!begun.acquired) return { kind: "busy" };
  const ticket = begun.ticket;
  const channelId = ticket.channelId;
  if (!channelId) {
    await deps.api.finalizeTicketClose(ticket.id).catch(() => undefined);
    return { kind: "channel-missing" };
  }

  if (ticket.archiveMessageId) return finalizeAfterDelete(deps, ticket, channelId);

  let transcript: ChannelTranscript;
  try {
    transcript = await deps.port.fetchTranscript(channelId, TICKET_TRANSCRIPT_MESSAGE_CAP);
  } catch (error) {
    if (isDiscordUnknownChannelError(error)) {
      await deps.api.markTicketChannelMissing(ticket.id, channelId);
      return { kind: "channel-missing" };
    }
    return reportFailure(deps, ticket, "TRANSCRIPT", error);
  }

  const closedAt = now().toISOString();
  const channelName = ticket.channelName ?? `ticket-${ticket.number}`;
  const filename = buildTicketTranscriptFilename(channelName);
  let html: string;
  try {
    html = buildTicketTranscriptHtml({
      ticket,
      guildName: await deps.port.guildName(),
      guildId: deps.port.guildId,
      channelName,
      channelId,
      closedAt,
      closedByDiscordUserId: actorDiscordUserId,
      messages: transcript.messages,
      truncated: transcript.truncated,
    });
    await deps.api.recordTicketTranscript(ticket.id, {
      transcriptHtml: html,
      transcriptFilename: filename,
      messageCount: transcript.messages.length,
      truncated: transcript.truncated,
    });
  } catch (error) {
    return reportFailure(deps, ticket, "TRANSCRIPT", error);
  }

  let archiveMessageId: string;
  try {
    const posted = await deps.port.sendWithFile(
      deps.env.archiveLogChannelId,
      {
        embeds: [
          buildTicketArchiveSummary({
            ticket,
            closedAt,
            closedByDiscordUserId: actorDiscordUserId,
            messageCount: transcript.messages.length,
            truncated: transcript.truncated,
          }),
        ],
        allowedMentions: NO_MENTIONS,
      },
      { name: filename, content: html },
    );
    archiveMessageId = posted.id;
  } catch (error) {
    return reportFailure(deps, ticket, "ARCHIVE", error);
  }

  try {
    await deps.api.recordTicketArchive(ticket.id, archiveMessageId);
  } catch (error) {
    console.error(
      `[discord-bot] ticket ${ticket.id}: archive message ${archiveMessageId} was posted but not recorded — a retry may post it again`,
      error,
    );
    return reportFailure(deps, ticket, "ARCHIVE", error);
  }

  return finalizeAfterDelete(deps, ticket, channelId);
}

type GuardResult = { ok: true; ticket: BotSupportTicket } | { ok: false; message: string };

/**
 * Loads the ticket fresh and authorizes the clicking member. The custom id
 * only names a ticket; it must belong to the channel the button was clicked
 * in, and the actor must be the creator or hold one of the type's Staff
 * roles according to the Discord-provided interaction member.
 */
export async function authorizeTicketClose(
  interaction: Pick<ButtonInteraction, "channelId" | "member" | "user">,
  deps: TicketDeps,
  ticketId: string,
): Promise<GuardResult> {
  let ticket: BotSupportTicket;
  try {
    ticket = await deps.api.getTicket(ticketId);
  } catch (error) {
    if (error instanceof BotApiError && error.status === 404) return { ok: false, message: "This ticket no longer exists." };
    throw error;
  }
  if (!ticket.channelId || ticket.channelId !== interaction.channelId) {
    return { ok: false, message: "This control does not belong to this channel." };
  }
  if (ticket.status !== "OPEN" && ticket.status !== "CLOSING") {
    return { ok: false, message: "This ticket is already closed." };
  }
  const allowed = canCloseTicket({
    ticket,
    actorDiscordUserId: interaction.user.id,
    actorRoleIds: extractMemberRoleIds(interaction.member),
    env: deps.env,
  });
  if (!allowed) return { ok: false, message: "Only the ticket creator or Staff for this category can close it." };
  return { ok: true, ticket };
}

/** Close Ticket button → ephemeral confirmation (nothing is closed yet). */
export async function handleCloseButton(interaction: ButtonInteraction, deps: TicketDeps, ticketId: string): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try {
    const guard = await authorizeTicketClose(interaction, deps, ticketId);
    await interaction.editReply(guard.ok ? buildCloseConfirmation(guard.ticket.id) : { content: guard.message });
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error) });
  }
}

const OUTCOME_COPY: Record<CloseTicketOutcome["kind"], string> = {
  closed: "Ticket closed. The transcript was archived for Staff.",
  busy: "This ticket is already being closed.",
  "channel-missing": "This ticket's channel no longer exists; the ticket was closed.",
  failed: "Closing failed — the channel was kept and nothing was lost. Try again in a moment.",
};

/** Confirm Close → re-authorize (fresh member roles) → run the close. */
export async function handleCloseConfirm(interaction: ButtonInteraction, deps: TicketDeps, ticketId: string): Promise<void> {
  await interaction.deferUpdate();
  const guard = await authorizeTicketClose(interaction, deps, ticketId);
  if (!guard.ok) {
    await interaction.editReply({ content: guard.message, components: [] });
    return;
  }
  await interaction.editReply({ content: "Closing ticket…", components: [] }).catch(() => undefined);
  let content: string;
  try {
    content = OUTCOME_COPY[(await closeTicket(deps, guard.ticket.id, interaction.user.id)).kind];
  } catch (error) {
    console.error(`[discord-bot] ticket ${guard.ticket.id}: close failed`, error);
    content = describeBotApiError(error);
  }
  // After a successful close the channel is gone; the ephemeral edit may fail.
  await interaction.editReply({ content, components: [] }).catch(() => undefined);
}

export async function handleCloseCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({ content: "Close cancelled.", components: [] });
}

/**
 * One pass at bot startup (not a loop): tickets whose transcript is archived
 * but whose channel delete failed get the delete retried. Never re-posts.
 */
export async function retryPendingTicketDeletes(deps: TicketDeps): Promise<number> {
  const pending = await deps.api.listTicketsPendingChannelDelete();
  let closed = 0;
  for (const ticket of pending) {
    if (!ticket.channelId || !ticket.archiveMessageId) continue;
    try {
      // Same lease as an interactive close; keeps the original closer.
      const begun = await deps.api.beginTicketClose(ticket.id, ticket.closedByDiscordUserId ?? deps.port.botUserId());
      if (!begun.acquired) continue;
      try {
        await deps.port.deleteChannel(ticket.channelId, `BoostingHub ticket ${ticket.id} closed — transcript archived`);
      } catch (error) {
        if (!isDiscordUnknownChannelError(error)) {
          console.warn(`[discord-bot] ticket ${ticket.id}: startup delete retry failed — still retryable`, error);
          await deps.api.recordTicketCloseFailure(ticket.id, "DELETE", summarizeDiscordError(error));
          continue;
        }
      }
      await deps.api.finalizeTicketClose(ticket.id);
      closed += 1;
    } catch (error) {
      console.error(`[discord-bot] ticket ${ticket.id}: startup delete retry failed`, error);
    }
  }
  return closed;
}
