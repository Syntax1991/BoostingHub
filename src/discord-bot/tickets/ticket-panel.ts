import type { BotApiClient } from "@/discord-bot/bot-api-client";
import { isDiscordUnknownChannelError, isDiscordUnknownMessageError } from "@/discord-bot/discord-api-errors";
import type { BotTicketEnv } from "@/discord-bot/env";
import type { TicketDiscordPort } from "@/discord-bot/tickets/ticket-discord-port";
import { buildSupportPanelMessage, supportPanelSignature } from "@/discord-bot/tickets/ticket-messages";

export type PanelSyncResult = "created" | "edited" | "unchanged" | "replaced" | "failed";

/**
 * Reconciles the one Support panel against its persisted identity. Runs once
 * on bot ready — never on a timer, never by scanning channel history:
 * - no stored identity                → post once, persist
 * - stored in the configured channel  → verify it exists; edit only when the
 *                                        content signature changed
 * - stored message deleted            → post one replacement, persist
 * - configured channel changed        → post in the new channel, persist,
 *                                        best-effort delete the old message
 */
export async function syncSupportPanel(deps: {
  api: Pick<BotApiClient, "getTicketPanel" | "recordTicketPanel">;
  port: TicketDiscordPort;
  env: BotTicketEnv;
}): Promise<PanelSyncResult> {
  const { api, port, env } = deps;
  const payload = buildSupportPanelMessage();
  const signature = supportPanelSignature(payload);
  const stored = await api.getTicketPanel();

  if (stored && stored.channelId === env.panelChannelId) {
    try {
      if (stored.lastSignature === signature) {
        await port.fetchMessageExists(stored.channelId, stored.messageId);
        return "unchanged";
      }
      await port.editMessage(stored.channelId, stored.messageId, payload);
      await api.recordTicketPanel({ channelId: stored.channelId, messageId: stored.messageId, lastSignature: signature });
      return "edited";
    } catch (error) {
      if (isDiscordUnknownChannelError(error)) {
        console.error(
          `[discord-bot] ticket panel channel ${env.panelChannelId} does not exist — check DISCORD_TICKET_PANEL_CHANNEL_ID`,
        );
        return "failed";
      }
      if (!isDiscordUnknownMessageError(error)) throw error;
      // Deleted panel message: fall through to exactly one replacement.
    }
  }

  let posted: { id: string };
  try {
    posted = await port.send(env.panelChannelId, payload);
  } catch (error) {
    console.error(`[discord-bot] failed to post the ticket panel in ${env.panelChannelId}`, error);
    return "failed";
  }
  try {
    await api.recordTicketPanel({ channelId: env.panelChannelId, messageId: posted.id, lastSignature: signature });
  } catch (error) {
    // Untracked panel would be duplicated on the next restart — remove it.
    console.error(`[discord-bot] failed to persist ticket panel message ${posted.id} — removing it`, error);
    await port.deleteMessage(env.panelChannelId, posted.id).catch(() => undefined);
    return "failed";
  }

  if (stored && stored.channelId !== env.panelChannelId) {
    await port.deleteMessage(stored.channelId, stored.messageId).catch(() => undefined);
  }
  return stored ? "replaced" : "created";
}
