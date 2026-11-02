import { describe, expect, it, vi } from "vitest";
import type { ButtonInteraction } from "discord.js";
import { BotApiError, type BotApiClient } from "@/discord-bot/bot-api-client";
import {
  ARCHIVE_CONFIRM_PROMPT,
  handleArchiveButton,
  handleArchiveConfirmButton,
  handleArchiveKeepButton,
} from "@/discord-bot/interactions/archive-handler";
import { requestImmediateSync } from "@/discord-bot/sync-loop";

vi.mock("@/discord-bot/sync-loop", () => ({ requestImmediateSync: vi.fn() }));

const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function buttonInteraction() {
  return {
    user: { id: "discord-user-1" },
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Archive Run button", () => {
  it("asks only the clicking user to confirm — nothing is archived yet", async () => {
    const interaction = buttonInteraction();

    await handleArchiveButton(interaction as unknown as ButtonInteraction, RUN_ID);

    const reply = interaction.reply.mock.calls[0][0];
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toBe(ARCHIVE_CONFIRM_PROMPT);
    const buttons = reply.components[0].toJSON().components as Array<{ custom_id: string; label: string }>;
    expect(buttons.map((button) => button.custom_id)).toEqual([
      `boostinghub:archive-confirm:${RUN_ID}`,
      `boostinghub:archive-keep:${RUN_ID}`,
    ]);
  });

  it("confirm: archives as the acting Discord user, then triggers a sync", async () => {
    const interaction = buttonInteraction();
    const api = { archiveRun: vi.fn().mockResolvedValue({ id: RUN_ID }) } as unknown as BotApiClient;

    await handleArchiveConfirmButton(interaction as unknown as ButtonInteraction, api, RUN_ID);

    expect(api.archiveRun).toHaveBeenCalledWith(RUN_ID, "discord-user-1");
    expect(interaction.update).toHaveBeenCalledWith({ content: "Archiving…", components: [] });
    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: "Run archived. This channel will be closed shortly (a transcript is kept).",
      components: [],
    });
    expect(requestImmediateSync).toHaveBeenCalled();
  });

  it("confirm without permission: shows the server's reason, archives nothing", async () => {
    vi.mocked(requestImmediateSync).mockClear();
    const interaction = buttonInteraction();
    const api = {
      archiveRun: vi.fn().mockRejectedValue(new BotApiError(403, "RUN_NOT_MANAGEABLE", "You cannot manage this run.")),
    } as unknown as BotApiClient;

    await handleArchiveConfirmButton(interaction as unknown as ButtonInteraction, api, RUN_ID);

    expect(interaction.editReply).toHaveBeenLastCalledWith({ content: "You cannot manage this run.", components: [] });
    expect(requestImmediateSync).not.toHaveBeenCalled();
  });

  it("keep: closes the prompt without archiving", async () => {
    const interaction = buttonInteraction();

    await handleArchiveKeepButton(interaction as unknown as ButtonInteraction);

    expect(interaction.update).toHaveBeenCalledWith({ content: "Not archived.", components: [] });
  });
});
