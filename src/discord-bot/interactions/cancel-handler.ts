import type { ButtonInteraction } from "discord.js";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import { describeBotApiError } from "@/discord-bot/interactions/error-copy";
import { requestImmediateSync } from "@/discord-bot/sync-loop";

/**
 * The Cancel Signup button: withdraws the User's entire active offer-set for
 * this Run atomically. A protected offer (roster-selected, or published and
 * locked) rejects the whole cancellation — the server's own message already
 * explains why, so it is shown directly rather than rewritten here.
 */
export async function handleCancelButton(interaction: ButtonInteraction, api: BotApiClient, runId: string): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await api.cancelSignup(runId, interaction.user.id);
    await interaction.editReply({
      content: result.withdrawn > 0 ? "Your signup for this run was cancelled." : "You had no active signup to cancel.",
    });
    if (result.withdrawn > 0) requestImmediateSync();
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error) });
  }
}
