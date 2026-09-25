import type { Interaction } from "discord.js";
import { handleCloseButton, handleCloseCancel, handleCloseConfirm } from "@/discord-bot/tickets/ticket-close";
import { handleTicketModalSubmit, handleTicketPanelSelect, type TicketDeps } from "@/discord-bot/tickets/ticket-create";
import {
  parseTicketActionCustomId,
  parseTicketModalCustomId,
  TICKET_PANEL_SELECT_ID,
} from "@/discord-bot/tickets/ticket-custom-ids";

/**
 * Routes `bhticket:*` interactions. `deps` is null when the ticket feature is
 * not configured — a stale panel then gets a polite ephemeral refusal.
 */
export async function handleTicketInteraction(interaction: Interaction, deps: TicketDeps | null): Promise<void> {
  if (!interaction.isRepliable()) return;
  if (!deps) {
    await interaction.reply({ content: "Support tickets are currently unavailable.", ephemeral: true });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === TICKET_PANEL_SELECT_ID) {
    await handleTicketPanelSelect(interaction);
    return;
  }

  if (interaction.isButton()) {
    const parsed = parseTicketActionCustomId(interaction.customId);
    if (!parsed) return;
    if (parsed.action === "close") await handleCloseButton(interaction, deps, parsed.ticketId);
    else if (parsed.action === "close-confirm") await handleCloseConfirm(interaction, deps, parsed.ticketId);
    else await handleCloseCancel(interaction);
    return;
  }

  if (interaction.isModalSubmit()) {
    const type = parseTicketModalCustomId(interaction.customId);
    if (type) await handleTicketModalSubmit(interaction, deps, type);
    return;
  }
}
