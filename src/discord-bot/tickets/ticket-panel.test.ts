import { describe, expect, it, vi } from "vitest";
import type { BotSupportTicketPanel } from "@/discord-bot/bot-api-client";
import { discordError, fakePort, TICKET_ENV } from "@/discord-bot/tickets/ticket-test-fixtures";
import { buildSupportPanelMessage, supportPanelSignature } from "@/discord-bot/tickets/ticket-messages";
import { syncSupportPanel } from "@/discord-bot/tickets/ticket-panel";

/** In-memory stand-in for the persisted DiscordTicketPanel row. */
function fakeApi(initial: BotSupportTicketPanel | null = null) {
  let stored = initial;
  return {
    getTicketPanel: vi.fn(async () => stored),
    recordTicketPanel: vi.fn(async (input: BotSupportTicketPanel) => {
      stored = { ...input };
      return stored;
    }),
    get stored() {
      return stored;
    },
  };
}

const SIGNATURE = supportPanelSignature();

describe("syncSupportPanel", () => {
  it("first sync posts the panel once and persists its identity", async () => {
    const api = fakeApi();
    const port = fakePort();
    expect(await syncSupportPanel({ api, port, env: TICKET_ENV })).toBe("created");
    expect(port.send).toHaveBeenCalledTimes(1);
    expect(port.send.mock.calls[0][0]).toBe(TICKET_ENV.panelChannelId);
    expect(api.stored).toEqual({ channelId: TICKET_ENV.panelChannelId, messageId: expect.any(String), lastSignature: SIGNATURE });
  });

  it("second sync (restart) reuses the panel: no new post, no edit", async () => {
    const api = fakeApi();
    const port = fakePort();
    await syncSupportPanel({ api, port, env: TICKET_ENV });
    expect(await syncSupportPanel({ api, port, env: TICKET_ENV })).toBe("unchanged");
    expect(port.send).toHaveBeenCalledTimes(1);
    expect(port.editMessage).not.toHaveBeenCalled();
    expect(port.fetchMessageExists).toHaveBeenCalledWith(TICKET_ENV.panelChannelId, api.stored!.messageId);
  });

  it("content signature changed: edits the existing message in place", async () => {
    const api = fakeApi({ channelId: TICKET_ENV.panelChannelId, messageId: "900000000000000001", lastSignature: "panel-v0:old" });
    const port = fakePort();
    expect(await syncSupportPanel({ api, port, env: TICKET_ENV })).toBe("edited");
    expect(port.send).not.toHaveBeenCalled();
    expect(port.editMessage).toHaveBeenCalledWith(TICKET_ENV.panelChannelId, "900000000000000001", expect.any(Object));
    expect(api.stored?.lastSignature).toBe(SIGNATURE);
    expect(api.stored?.messageId).toBe("900000000000000001");
  });

  it("stored message deleted (Unknown Message): posts exactly one replacement", async () => {
    const api = fakeApi({ channelId: TICKET_ENV.panelChannelId, messageId: "900000000000000001", lastSignature: SIGNATURE });
    const port = fakePort({ fetchMessageExists: vi.fn(async () => Promise.reject(discordError(10008))) });
    expect(await syncSupportPanel({ api, port, env: TICKET_ENV })).toBe("replaced");
    expect(port.send).toHaveBeenCalledTimes(1);
    expect(api.stored?.messageId).not.toBe("900000000000000001");
  });

  it("configured panel channel missing: logs and posts nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const api = fakeApi({ channelId: TICKET_ENV.panelChannelId, messageId: "900000000000000001", lastSignature: SIGNATURE });
    const port = fakePort({ fetchMessageExists: vi.fn(async () => Promise.reject(discordError(10003))) });
    expect(await syncSupportPanel({ api, port, env: TICKET_ENV })).toBe("failed");
    expect(port.send).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("configured channel changed: posts in the new channel and removes the old message", async () => {
    const api = fakeApi({ channelId: "100000000000000099", messageId: "900000000000000001", lastSignature: SIGNATURE });
    const port = fakePort();
    expect(await syncSupportPanel({ api, port, env: TICKET_ENV })).toBe("replaced");
    expect(port.send).toHaveBeenCalledWith(TICKET_ENV.panelChannelId, expect.any(Object));
    expect(port.deleteMessage).toHaveBeenCalledWith("100000000000000099", "900000000000000001");
  });

  it("persisting a new panel fails: the untracked message is removed so a restart cannot duplicate it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const api = fakeApi();
    api.recordTicketPanel.mockRejectedValueOnce(new Error("api down"));
    const port = fakePort();
    expect(await syncSupportPanel({ api, port, env: TICKET_ENV })).toBe("failed");
    expect(port.deleteMessage).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe("buildSupportPanelMessage", () => {
  it("never pings anyone", () => {
    expect(buildSupportPanelMessage().allowedMentions).toEqual({ parse: [] });
  });

  it("one select with the five categories and unicode emoji", () => {
    const [row] = buildSupportPanelMessage().components!;
    const select = ("toJSON" in row ? row.toJSON() : row) as unknown as {
      components: Array<{ placeholder: string; options: Array<{ label: string; value: string; emoji: { name: string; id?: string } }> }>;
    };
    const menu = select.components[0];
    expect(menu.placeholder).toBe("Open a ticket");
    expect(menu.options.map((option) => [option.label, option.emoji.name])).toEqual([
      ["Admin Support", "🛡️"],
      ["Raid Support", "⚔️"],
      ["M+ Support", "🗝️"],
      ["General Support", "💬"],
      ["Report a Booster", "🚨"],
    ]);
    expect(menu.options.every((option) => !option.emoji.id)).toBe(true);
  });

  it("panel copy is BoostingHub-owned and promises no SLA", () => {
    const text = JSON.stringify(buildSupportPanelMessage().embeds);
    expect(text).toContain("TICKET • SUPPORT");
    expect(text).not.toMatch(/phoenix|cyclone|24.?h/i);
  });

  it("signature is stable for identical content", () => {
    expect(supportPanelSignature()).toBe(supportPanelSignature());
  });
});
