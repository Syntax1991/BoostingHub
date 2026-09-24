import { describe, expect, it, vi } from "vitest";
import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { BotApiError, type BotApiClient } from "@/discord-bot/bot-api-client";
import {
  handleCancelButton,
  handleWithdrawReasonModal,
  WITHDRAW_REASON_INPUT_ID,
} from "@/discord-bot/interactions/cancel-handler";

vi.mock("@/discord-bot/sync-loop", () => ({ requestImmediateSync: vi.fn() }));

const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function buttonInteraction() {
  return {
    user: { id: "discord-user-1" },
    reply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Cancel Signup button", () => {
  it("not picked: cancels and replies right away", async () => {
    const interaction = buttonInteraction();
    const api = { cancelSignup: vi.fn().mockResolvedValue({ withdrawn: 2 }) } as unknown as BotApiClient;

    await handleCancelButton(interaction as unknown as ButtonInteraction, api, RUN_ID);

    expect(api.cancelSignup).toHaveBeenCalledWith(RUN_ID, "discord-user-1");
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({ content: "Your signup for this run was cancelled.", ephemeral: true });
  });

  it("picked: opens the reason modal instead of replying", async () => {
    const interaction = buttonInteraction();
    const api = {
      cancelSignup: vi.fn().mockRejectedValue(new BotApiError(400, "WITHDRAW_REASON_REQUIRED", "reason needed")),
    } as unknown as BotApiClient;

    await handleCancelButton(interaction as unknown as ButtonInteraction, api, RUN_ID);

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modal = interaction.showModal.mock.calls[0][0].toJSON();
    expect(modal.custom_id).toBe(`boostinghub:withdraw-reason:${RUN_ID}`);
    expect(JSON.stringify(modal.components)).toContain(`"custom_id":"${WITHDRAW_REASON_INPUT_ID}"`);
  });

  it("modal submit: withdraws with the typed reason", async () => {
    const interaction = {
      user: { id: "discord-user-1" },
      fields: { getTextInputValue: vi.fn().mockReturnValue("Sick, sorry") },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const api = { cancelSignup: vi.fn().mockResolvedValue({ withdrawn: 1 }) } as unknown as BotApiClient;

    await handleWithdrawReasonModal(interaction as unknown as ModalSubmitInteraction, api, RUN_ID);

    expect(interaction.fields.getTextInputValue).toHaveBeenCalledWith(WITHDRAW_REASON_INPUT_ID);
    expect(api.cancelSignup).toHaveBeenCalledWith(RUN_ID, "discord-user-1", "Sick, sorry");
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "You withdrew from this run. The raid lead has been told why.",
    });
  });
});
