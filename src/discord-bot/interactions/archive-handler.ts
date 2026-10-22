import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ButtonInteraction } from "discord.js";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import { buildCustomId } from "@/discord-bot/custom-ids";
import { describeBotApiError } from "@/discord-bot/interactions/error-copy";
import { requestImmediateSync } from "@/discord-bot/sync-loop";

export const ARCHIVE_CONFIRM_PROMPT =
  "Archive this run? The run moves to the archive in the app, and this Discord channel is closed: " +
  "a transcript is kept, then the channel is removed.";

/**
 * "Archive Run" on an ended Run's Signup message: asks only the clicking user
 * (ephemeral) to confirm — nothing is archived yet. Permission is checked by
 * the server on confirm (Raid Lead of the Run / Admin), like in the app.
 */
export async function handleArchiveButton(interaction: ButtonInteraction, runId: string): Promise<void> {
  await interaction.reply({
    content: ARCHIVE_CONFIRM_PROMPT,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildCustomId("archive-confirm", runId))
          .setLabel("Archive Run")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(buildCustomId("archive-keep", runId))
          .setLabel("Keep")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
    ephemeral: true,
  });
}

/** Confirmed: the server archives through the same service as the app; the sync loop then closes the channel. */
export async function handleArchiveConfirmButton(
  interaction: ButtonInteraction,
  api: BotApiClient,
  runId: string,
): Promise<void> {
  await interaction.update({ content: "Archiving…", components: [] });
  try {
    await api.archiveRun(runId, interaction.user.id);
    await interaction.editReply({
      content: "Run archived. This channel will be closed shortly (a transcript is kept).",
      components: [],
    });
    requestImmediateSync();
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error), components: [] });
  }
}

export async function handleArchiveKeepButton(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({ content: "Not archived.", components: [] });
}
