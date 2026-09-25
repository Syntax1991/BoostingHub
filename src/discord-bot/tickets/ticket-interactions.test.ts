import { describe, expect, it, vi } from "vitest";
import type { Interaction } from "discord.js";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import { handleTicketInteraction } from "@/discord-bot/tickets/ticket-interactions";
import { fakePort, TICKET_ENV, TICKET_ID } from "@/discord-bot/tickets/ticket-test-fixtures";

function button(customId: string) {
  return {
    customId,
    isRepliable: () => true,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    reply: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    deferUpdate: vi.fn(async () => undefined),
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    channelId: "500000000000000001",
    user: { id: "400000000000000077" },
    member: { roles: [] },
  };
}

describe("handleTicketInteraction", () => {
  it("feature disabled: stale panel/buttons get an ephemeral refusal and nothing else", async () => {
    const interaction = button(`bhticket:close:${TICKET_ID}`);
    await handleTicketInteraction(interaction as unknown as Interaction, null);
    expect(interaction.reply).toHaveBeenCalledWith({ content: "Support tickets are currently unavailable.", ephemeral: true });
  });

  it("forged / malformed button ids are ignored without any API call", async () => {
    const api = { getTicket: vi.fn() } as unknown as BotApiClient;
    const interaction = button("bhticket:close:../../etc");
    await handleTicketInteraction(interaction as unknown as Interaction, { api, port: fakePort(), env: TICKET_ENV });
    expect((api as unknown as { getTicket: ReturnType<typeof vi.fn> }).getTicket).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("routes Confirm Close through authorization (unrelated user cannot close)", async () => {
    const api = {
      getTicket: vi.fn(async () => ({
        id: TICKET_ID,
        type: "RAID_SUPPORT",
        status: "OPEN",
        creatorDiscordUserId: "400000000000000001",
        channelId: "500000000000000001",
      })),
      beginTicketClose: vi.fn(),
    };
    const interaction = button(`bhticket:close-confirm:${TICKET_ID}`);
    await handleTicketInteraction(interaction as unknown as Interaction, {
      api: api as unknown as BotApiClient,
      port: fakePort(),
      env: TICKET_ENV,
    });
    expect(api.getTicket).toHaveBeenCalledWith(TICKET_ID);
    expect(api.beginTicketClose).not.toHaveBeenCalled();
  });
});
