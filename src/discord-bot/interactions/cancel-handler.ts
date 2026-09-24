import {
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { BotApiError, type BotApiClient } from "@/discord-bot/bot-api-client";
import { buildCustomId } from "@/discord-bot/custom-ids";
import { describeBotApiError } from "@/discord-bot/interactions/error-copy";
import { requestImmediateSync } from "@/discord-bot/sync-loop";
import { WITHDRAW_REASON_MAX_LENGTH, WITHDRAW_REASON_MIN_LENGTH } from "@/services/signup-state";

export const WITHDRAW_REASON_INPUT_ID = "reason";

/** Asks a picked player why they withdraw — the answer is DMed to the Raid Lead. */
export function buildWithdrawReasonModal(runId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildCustomId("withdraw-reason", runId))
    .setTitle("Withdraw from the roster")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Why are you withdrawing?")
        .setDescription("You are on the roster. Your reason is sent to the raid lead.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(WITHDRAW_REASON_INPUT_ID)
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(WITHDRAW_REASON_MIN_LENGTH)
            .setMaxLength(WITHDRAW_REASON_MAX_LENGTH)
            .setRequired(true),
        ),
    );
}

function withdrawnReply(withdrawn: number): string {
  return withdrawn > 0 ? "Your signup for this run was cancelled." : "You had no active signup to cancel.";
}

/**
 * The Cancel Signup button: withdraws the User's entire active BOOSTER and
 * LOOTBUDDY participation for this Run. A picked User must give a reason:
 * the API answers WITHDRAW_REASON_REQUIRED (writing nothing) and the button
 * opens the reason modal instead. A modal has to be the first response to
 * the interaction, so this replies without deferring.
 */
export async function handleCancelButton(interaction: ButtonInteraction, api: BotApiClient, runId: string): Promise<void> {
  try {
    const result = await api.cancelSignup(runId, interaction.user.id);
    await interaction.reply({ content: withdrawnReply(result.withdrawn), ephemeral: true });
    if (result.withdrawn > 0) requestImmediateSync();
  } catch (error) {
    if (error instanceof BotApiError && error.code === "WITHDRAW_REASON_REQUIRED") {
      await interaction.showModal(buildWithdrawReasonModal(runId));
      return;
    }
    await interaction.reply({ content: describeBotApiError(error), ephemeral: true });
  }
}

/** Reason modal submit: withdraws with the given reason. */
export async function handleWithdrawReasonModal(
  interaction: ModalSubmitInteraction,
  api: BotApiClient,
  runId: string,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try {
    const reason = interaction.fields.getTextInputValue(WITHDRAW_REASON_INPUT_ID);
    const result = await api.cancelSignup(runId, interaction.user.id, reason);
    await interaction.editReply({
      content:
        result.withdrawn > 0
          ? "You withdrew from this run. The raid lead has been told why."
          : withdrawnReply(result.withdrawn),
    });
    if (result.withdrawn > 0) requestImmediateSync();
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error) });
  }
}
