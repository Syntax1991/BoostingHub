import { type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import type { BotApiClient, BotSupportTicket } from "@/discord-bot/bot-api-client";
import { summarizeDiscordError } from "@/discord-bot/discord-api-errors";
import type { BotTicketEnv } from "@/discord-bot/env";
import { describeBotApiError } from "@/discord-bot/interactions/error-copy";
import { buildTicketPermissionOverwrites, staffRoleIdsForTicketType } from "@/discord-bot/tickets/access";
import { TICKET_MODAL_FIELDS } from "@/discord-bot/tickets/ticket-custom-ids";
import type { TicketDiscordPort } from "@/discord-bot/tickets/ticket-discord-port";
import { buildTicketModal, buildTicketOpeningMessage } from "@/discord-bot/tickets/ticket-messages";
import {
  buildSupportTicketChannelName,
  formatSupportTicketNumber,
  isSupportTicketType,
  SUPPORT_TICKET_LIMITS,
  SUPPORT_TICKET_TYPE_DEFINITIONS,
} from "@/lib/support-tickets";
import type { SupportTicketType } from "@/models/enums";

export type TicketDeps = {
  api: BotApiClient;
  port: TicketDiscordPort;
  env: BotTicketEnv;
};

/** Panel select → the category modal. A modal must be the first response, so no defer. */
export async function handleTicketPanelSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const value = interaction.values[0];
  if (!isSupportTicketType(value)) {
    await interaction.reply({ content: "Unknown ticket category.", ephemeral: true });
    return;
  }
  await interaction.showModal(buildTicketModal(value));
}

/** Server-nickname-aware label from the Discord interaction itself (never user input). */
export function interactionDisplayName(interaction: {
  member?: unknown;
  user: { username: string; globalName?: string | null };
}): string {
  const member = interaction.member as { displayName?: unknown; nick?: unknown } | null | undefined;
  const fromMember =
    (typeof member?.displayName === "string" && member.displayName) || (typeof member?.nick === "string" && member.nick);
  const name = fromMember || interaction.user.globalName || interaction.user.username || "user";
  return name.slice(0, SUPPORT_TICKET_LIMITS.displayNameMax);
}

function optionalField(interaction: ModalSubmitInteraction, id: string): string | null {
  try {
    const value = interaction.fields.getTextInputValue(id).trim();
    return value || null;
  } catch {
    return null;
  }
}

export type OpenTicketResult = { ok: true; channelId: string } | { ok: false };

/**
 * Turns an OPENING reservation into a live private channel. Every failure is
 * compensated so no active-ticket key stays locked and no private channel
 * stays untracked:
 * - channel create fails            → abort the reservation
 * - create ok, activate fails       → delete the channel, then abort
 * - compensation delete also fails  → high-signal ORPHAN log (ticket + channel id)
 * The opening header is best effort: the ticket is already live and visible.
 */
export async function openReservedTicket(deps: TicketDeps, ticket: BotSupportTicket): Promise<OpenTicketResult> {
  const { api, port, env } = deps;
  const staffRoleIds = staffRoleIdsForTicketType(ticket.type, env);
  const name = buildSupportTicketChannelName(ticket.number, ticket.creatorDisplayName);

  let channelId: string;
  try {
    const channel = await port.createTicketChannel({
      name,
      parentId: env.categoryId,
      topic: `BoostingHub ticket #${formatSupportTicketNumber(ticket.number)} (${ticket.id})`,
      overwrites: buildTicketPermissionOverwrites({
        guildId: port.guildId,
        botUserId: port.botUserId(),
        creatorDiscordUserId: ticket.creatorDiscordUserId,
        staffRoleIds,
        reportedDiscordUserId: ticket.type === "REPORT_BOOSTER" ? ticket.reportedDiscordUserId : null,
      }),
      reason: `BoostingHub support ticket ${ticket.id}`,
    });
    channelId = channel.id;
  } catch (error) {
    console.error(`[discord-bot] ticket ${ticket.id}: channel create failed — releasing reservation`, error);
    await api.abortTicketOpening(ticket.id, `channel create failed: ${summarizeDiscordError(error)}`).catch((abortError) => {
      console.error(`[discord-bot] ticket ${ticket.id}: abort-opening failed (reservation goes stale)`, abortError);
    });
    return { ok: false };
  }

  let activated: BotSupportTicket;
  try {
    activated = await api.activateTicket(ticket.id, { channelId, channelName: name });
  } catch (error) {
    console.error(`[discord-bot] ticket ${ticket.id}: activate failed — deleting channel ${channelId}`, error);
    try {
      await port.deleteChannel(channelId, `BoostingHub ticket ${ticket.id} could not be recorded`);
    } catch (deleteError) {
      console.error(
        `[discord-bot] ORPHAN TICKET CHANNEL: ticket=${ticket.id} channel=${channelId} — created but not recorded and not deleted; delete it manually`,
        deleteError,
      );
    }
    await api.abortTicketOpening(ticket.id, `activate failed: ${summarizeDiscordError(error)}`).catch((abortError) => {
      console.error(`[discord-bot] ticket ${ticket.id}: abort-opening failed (reservation goes stale)`, abortError);
    });
    return { ok: false };
  }

  try {
    await port.send(channelId, buildTicketOpeningMessage(activated, staffRoleIds));
  } catch (error) {
    console.error(`[discord-bot] ticket ${ticket.id}: opening message failed in channel ${channelId}`, error);
  }
  return { ok: true, channelId };
}

function typeLabel(type: SupportTicketType): string {
  return SUPPORT_TICKET_TYPE_DEFINITIONS[type].label;
}

/**
 * Modal submit → reserve → private channel → reply with the channel link.
 * Creator identity is the interaction user; the API re-validates every field.
 * An existing active ticket of the same type is linked instead of duplicated
 * (and released first if Discord says its channel no longer exists).
 */
export async function handleTicketModalSubmit(
  interaction: ModalSubmitInteraction,
  deps: TicketDeps,
  type: SupportTicketType,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const request = {
    type,
    creatorDiscordUserId: interaction.user.id,
    creatorDisplayName: interactionDisplayName(interaction),
    subject: optionalField(interaction, TICKET_MODAL_FIELDS.subject) ?? "",
    description: optionalField(interaction, TICKET_MODAL_FIELDS.description) ?? "",
    reference: optionalField(interaction, TICKET_MODAL_FIELDS.reference),
    booster: type === "REPORT_BOOSTER" ? optionalField(interaction, TICKET_MODAL_FIELDS.booster) : null,
  };

  try {
    let reserved = await deps.api.reserveTicket(request);
    if (reserved.outcome === "EXISTING" && reserved.ticket.status === "OPEN" && reserved.ticket.channelId) {
      const exists = await deps.port.channelExists(reserved.ticket.channelId).catch(() => true);
      if (!exists) {
        await deps.api.markTicketChannelMissing(reserved.ticket.id, reserved.ticket.channelId);
        reserved = await deps.api.reserveTicket(request);
      }
    }

    if (reserved.outcome === "EXISTING") {
      const existing = reserved.ticket;
      await interaction.editReply({
        content: existing.channelId
          ? `You already have an open ${typeLabel(type)} ticket: <#${existing.channelId}>`
          : `Your ${typeLabel(type)} ticket is still being created — try again in a moment.`,
      });
      return;
    }

    const opened = await openReservedTicket(deps, reserved.ticket);
    await interaction.editReply({
      content: opened.ok
        ? `Your ${typeLabel(type)} ticket is open: <#${opened.channelId}>`
        : "Your ticket could not be created right now. Please try again in a moment.",
    });
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error) });
  }
}
