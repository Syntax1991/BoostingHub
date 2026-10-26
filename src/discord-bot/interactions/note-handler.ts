import {
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import { buildCustomId } from "@/discord-bot/custom-ids";
import { describeBotApiError } from "@/discord-bot/interactions/error-copy";
import { requestImmediateSync } from "@/discord-bot/sync-loop";
import { SIGNUP_NOTE_MAX_LENGTH } from "@/services/signup-state";

export const SIGNUP_NOTE_INPUT_ID = "note";

/** One short line, prefilled with the current note; clearing the field removes it. */
export function buildSignupNoteModal(runId: string, currentNote: string | null): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(SIGNUP_NOTE_INPUT_ID)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(SIGNUP_NOTE_MAX_LENGTH)
    .setPlaceholder("e.g. can also play Ele · ~10 min late")
    .setRequired(false);
  if (currentNote) input.setValue(currentNote);
  return new ModalBuilder()
    .setCustomId(buildCustomId("note-modal", runId))
    .setTitle(currentNote ? "Edit your note" : "Add a note")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Note for the raid lead")
        .setDescription("Shown on this signup post. Leave empty to remove it.")
        .setTextInputComponent(input),
    );
}

/**
 * "Add / Edit Note": loads the acting User's current note and opens the modal
 * (a modal must be the first response, so this does not defer). Without an
 * active signup the API answers NOT_FOUND and the User gets that message.
 */
export async function handleNoteButton(interaction: ButtonInteraction, api: BotApiClient, runId: string): Promise<void> {
  try {
    const { note } = await api.getSignupNote(runId, interaction.user.id);
    await interaction.showModal(buildSignupNoteModal(runId, note));
  } catch (error) {
    await interaction.reply({ content: describeBotApiError(error), ephemeral: true });
  }
}

export async function handleNoteModal(interaction: ModalSubmitInteraction, api: BotApiClient, runId: string): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try {
    const value = interaction.fields.getTextInputValue(SIGNUP_NOTE_INPUT_ID);
    const result = await api.setSignupNote(runId, interaction.user.id, value.trim() ? value : null);
    await interaction.editReply({ content: result.note ? "Your note was saved." : "Your note was removed." });
    requestImmediateSync();
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error) });
  }
}
