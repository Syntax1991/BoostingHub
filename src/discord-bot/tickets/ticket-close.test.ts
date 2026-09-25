import { describe, expect, it, vi } from "vitest";
import type { ButtonInteraction } from "discord.js";
import { BotApiError, type BotApiClient, type BotSupportTicket } from "@/discord-bot/bot-api-client";
import type { TranscriptMessage } from "@/discord-bot/archive-transcript";
import {
  authorizeTicketClose,
  closeTicket,
  handleCloseButton,
  handleCloseCancel,
  handleCloseConfirm,
  retryPendingTicketDeletes,
} from "@/discord-bot/tickets/ticket-close";
import {
  CREATOR_ID,
  discordError,
  fakePort,
  REPORTED_ID,
  TICKET_CHANNEL_ID,
  TICKET_ENV,
  TICKET_ID,
  ticketFixture,
} from "@/discord-bot/tickets/ticket-test-fixtures";

const STAFF_ID = "400000000000000050";
const STRANGER_ID = "400000000000000060";

function msg(i: number, overrides: Partial<TranscriptMessage> = {}): TranscriptMessage {
  return {
    id: `m${i}`,
    createdAt: new Date(Date.UTC(2026, 8, 25, 10, i)).toISOString(),
    authorDisplayName: i % 2 ? "Staff" : "Syntax",
    authorUsername: i % 2 ? "staff" : "syntax",
    authorDiscriminator: "0",
    authorId: i % 2 ? STAFF_ID : CREATOR_ID,
    content: `message ${i}`,
    ...overrides,
  };
}

/**
 * In-memory Bot API mirroring the server lifecycle rules closely enough to
 * exercise retries: begin-close lease, transcript/archive written once.
 */
function fakeApi(initial: Partial<BotSupportTicket> = {}) {
  const state = {
    ticket: ticketFixture(initial),
    locked: false,
    transcriptHtml: null as string | null,
    failures: [] as string[],
  };
  const api = {
    state,
    getTicket: vi.fn(async (id: string) => {
      if (id !== state.ticket.id) throw new BotApiError(404, "SUPPORT_TICKET_NOT_FOUND", "Ticket not found.");
      return { ...state.ticket };
    }),
    beginTicketClose: vi.fn(async (_id: string, actor: string) => {
      if (state.locked) return { acquired: false, ticket: { ...state.ticket } };
      state.locked = true;
      state.ticket = { ...state.ticket, status: "CLOSING", closedByDiscordUserId: actor };
      return { acquired: true, ticket: { ...state.ticket } };
    }),
    recordTicketTranscript: vi.fn(async (_id: string, input: { transcriptHtml: string }) => {
      if (!state.ticket.archiveMessageId) state.transcriptHtml = input.transcriptHtml;
      return { ...state.ticket };
    }),
    recordTicketArchive: vi.fn(async (_id: string, archiveMessageId: string) => {
      state.ticket = { ...state.ticket, archiveMessageId: state.ticket.archiveMessageId ?? archiveMessageId };
      return { ...state.ticket };
    }),
    recordTicketCloseFailure: vi.fn(async (_id: string, stage: string) => {
      state.locked = false;
      state.failures.push(stage);
      return { ...state.ticket };
    }),
    finalizeTicketClose: vi.fn(async () => {
      if (!state.ticket.archiveMessageId) throw new BotApiError(409, "SUPPORT_TICKET_INVALID_STATE", "no archive");
      state.ticket = { ...state.ticket, status: "CLOSED", channelId: null };
      state.locked = false;
      return { ...state.ticket };
    }),
    markTicketChannelMissing: vi.fn(async () => {
      state.ticket = { ...state.ticket, status: "CLOSED", channelId: null, lastError: "CHANNEL_MISSING_BEFORE_TRANSCRIPT" };
      return { ...state.ticket };
    }),
    listTicketsPendingChannelDelete: vi.fn(async () =>
      state.ticket.status === "CLOSING" && state.ticket.archiveMessageId ? [{ ...state.ticket }] : [],
    ),
  };
  return api as typeof api & BotApiClient;
}

function deps(api: ReturnType<typeof fakeApi>, port = fakePort()) {
  return { api, port, env: TICKET_ENV };
}

function silence() {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  return () => {
    error.mockRestore();
    warn.mockRestore();
  };
}

describe("authorizeTicketClose", () => {
  function interaction(userId: string, roles: string[], channelId = TICKET_CHANNEL_ID) {
    return { channelId, user: { id: userId }, member: { roles } } as unknown as ButtonInteraction;
  }

  it("creator allowed", async () => {
    expect((await authorizeTicketClose(interaction(CREATOR_ID, []), deps(fakeApi()), TICKET_ID)).ok).toBe(true);
  });

  it("authorized Staff allowed (roles from the Discord member)", async () => {
    const guard = await authorizeTicketClose(interaction(STAFF_ID, [TICKET_ENV.raidStaffRoleId]), deps(fakeApi()), TICKET_ID);
    expect(guard.ok).toBe(true);
  });

  it("unrelated user denied", async () => {
    const guard = await authorizeTicketClose(interaction(STRANGER_ID, []), deps(fakeApi()), TICKET_ID);
    expect(guard).toEqual({ ok: false, message: expect.stringContaining("Only the ticket creator") });
  });

  it("wrong Staff role denied", async () => {
    const guard = await authorizeTicketClose(
      interaction(STAFF_ID, [TICKET_ENV.mythicPlusStaffRoleId, TICKET_ENV.moderatorRoleId]),
      deps(fakeApi()),
      TICKET_ID,
    );
    expect(guard.ok).toBe(false);
  });

  it("forged custom id: a ticket from another channel cannot be closed from here", async () => {
    const guard = await authorizeTicketClose(
      interaction(STAFF_ID, [TICKET_ENV.adminRoleId], "500000000000000999"),
      deps(fakeApi()),
      TICKET_ID,
    );
    expect(guard).toEqual({ ok: false, message: "This control does not belong to this channel." });
  });

  it("forged custom id: unknown ticket id is refused", async () => {
    const guard = await authorizeTicketClose(
      interaction(CREATOR_ID, []),
      deps(fakeApi()),
      "aaaaaaaa-aaaa-4aaa-8aaa-7e00000000ff",
    );
    expect(guard).toEqual({ ok: false, message: "This ticket no longer exists." });
  });

  it("already closed ticket is refused", async () => {
    const guard = await authorizeTicketClose(interaction(CREATOR_ID, []), deps(fakeApi({ status: "CLOSED" })), TICKET_ID);
    expect(guard.ok).toBe(false);
  });
});

describe("Close Ticket button → confirmation", () => {
  it("first click only shows an ephemeral confirmation; nothing is closed", async () => {
    const api = fakeApi();
    const interaction = {
      channelId: TICKET_CHANNEL_ID,
      user: { id: CREATOR_ID },
      member: { roles: [] },
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
    };
    await handleCloseButton(interaction as unknown as ButtonInteraction, deps(api), TICKET_ID);
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    const payload = (interaction.editReply.mock.calls[0] as unknown[])[0] as { components: unknown[] };
    const json = JSON.stringify(payload.components);
    expect(json).toContain(`bhticket:close-confirm:${TICKET_ID}`);
    expect(json).toContain(`bhticket:close-cancel:${TICKET_ID}`);
    expect(api.beginTicketClose).not.toHaveBeenCalled();
  });

  it("Confirm by an unauthorized member does not close", async () => {
    const api = fakeApi();
    const interaction = {
      channelId: TICKET_CHANNEL_ID,
      user: { id: STRANGER_ID },
      member: { roles: ["299999999999999999"] },
      deferUpdate: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
    };
    await handleCloseConfirm(interaction as unknown as ButtonInteraction, deps(api), TICKET_ID);
    expect(api.beginTicketClose).not.toHaveBeenCalled();
  });

  it("Confirm by Staff closes the ticket", async () => {
    const api = fakeApi();
    const port = fakePort();
    const interaction = {
      channelId: TICKET_CHANNEL_ID,
      user: { id: STAFF_ID },
      member: { roles: [TICKET_ENV.adminRoleId] },
      deferUpdate: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
    };
    await handleCloseConfirm(interaction as unknown as ButtonInteraction, deps(api, port), TICKET_ID);
    expect(api.beginTicketClose).toHaveBeenCalledWith(TICKET_ID, STAFF_ID);
    expect(api.state.ticket.status).toBe("CLOSED");
    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: "Ticket closed. The transcript was archived for Staff.",
      components: [],
    });
  });

  it("Cancel just dismisses", async () => {
    const interaction = { update: vi.fn(async () => undefined) };
    await handleCloseCancel(interaction as unknown as ButtonInteraction);
    expect(interaction.update).toHaveBeenCalledWith({ content: "Close cancelled.", components: [] });
  });
});

describe("closeTicket — happy path", () => {
  it("transcript persisted → archive sent with HTML → channel deleted only after → CLOSED", async () => {
    const order: string[] = [];
    const api = fakeApi();
    api.recordTicketTranscript.mockImplementation(async (_id: string, input: { transcriptHtml: string }) => {
      order.push("persist-transcript");
      api.state.transcriptHtml = input.transcriptHtml;
      return api.state.ticket;
    });
    const port = fakePort({
      fetchTranscript: vi.fn(async () => {
        order.push("fetch");
        return { messages: [msg(3), msg(1), msg(2)].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), truncated: false };
      }),
      sendWithFile: vi.fn(async () => {
        order.push("archive-send");
        return { id: "620000000000000001" };
      }),
      deleteChannel: vi.fn(async () => {
        order.push("delete");
      }),
    });

    const outcome = await closeTicket(deps(api, port), TICKET_ID, STAFF_ID, () => new Date("2026-09-25T12:00:00.000Z"));

    expect(outcome).toEqual({ kind: "closed" });
    expect(order).toEqual(["fetch", "persist-transcript", "archive-send", "delete"]);
    expect(port.fetchTranscript).toHaveBeenCalledWith(TICKET_CHANNEL_ID, 500);
    const html = api.state.transcriptHtml!;
    expect(html.indexOf("message 1")).toBeLessThan(html.indexOf("message 2"));
    expect(html.indexOf("message 2")).toBeLessThan(html.indexOf("message 3"));

    const [archiveChannel, payload, file] = (port.sendWithFile as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { embeds: Array<{ toJSON(): { fields: Array<{ name: string; value: string }> } }>; allowedMentions: unknown },
      { name: string; content: string },
    ];
    expect(archiveChannel).toBe(TICKET_ENV.archiveLogChannelId);
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(file.name).toBe("transcript-ticket-0042-syntax.html");
    expect(file.content).toBe(html);
    const fields = payload.embeds[0].toJSON().fields.map((field) => field.name);
    expect(fields).toEqual(expect.arrayContaining(["Opened by", "Closed by", "Subject", "Created", "Closed"]));

    expect(api.recordTicketArchive).toHaveBeenCalledWith(TICKET_ID, "620000000000000001");
    expect(api.state.ticket.status).toBe("CLOSED");
  });

  it("Report a Booster archive summary shows the reported Booster", async () => {
    const api = fakeApi({ type: "REPORT_BOOSTER", reportedDiscordUserId: REPORTED_ID, reportedBoosterLabel: `<@${REPORTED_ID}>` });
    const port = fakePort();
    await closeTicket(deps(api, port), TICKET_ID, STAFF_ID);
    const payload = (port.sendWithFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      embeds: Array<{ toJSON(): { fields: Array<{ name: string }> } }>;
    };
    expect(payload.embeds[0].toJSON().fields.map((field) => field.name)).toContain("Reported Booster");
  });
});

describe("closeTicket — failures and retries", () => {
  it("archive send fails: channel kept, ticket retryable, Staff told in channel", async () => {
    const restore = silence();
    const api = fakeApi();
    const port = fakePort({ sendWithFile: vi.fn(async () => Promise.reject(discordError(50013))) });
    const outcome = await closeTicket(deps(api, port), TICKET_ID, STAFF_ID);
    expect(outcome).toEqual({ kind: "failed", stage: "ARCHIVE" });
    expect(port.deleteChannel).not.toHaveBeenCalled();
    expect(api.state.ticket.status).toBe("CLOSING");
    expect(api.state.locked).toBe(false);
    expect(port.send).toHaveBeenCalledWith(TICKET_CHANNEL_ID, expect.objectContaining({ allowedMentions: { parse: [] } }));
    restore();
  });

  it("transcript fetch fails (e.g. Missing Access): nothing sent or deleted", async () => {
    const restore = silence();
    const api = fakeApi();
    const port = fakePort({ fetchTranscript: vi.fn(async () => Promise.reject(discordError(50001))) });
    expect(await closeTicket(deps(api, port), TICKET_ID, STAFF_ID)).toEqual({ kind: "failed", stage: "TRANSCRIPT" });
    expect(port.sendWithFile).not.toHaveBeenCalled();
    expect(port.deleteChannel).not.toHaveBeenCalled();
    restore();
  });

  it("transcript persistence fails: nothing sent or deleted", async () => {
    const restore = silence();
    const api = fakeApi();
    api.recordTicketTranscript.mockRejectedValueOnce(new Error("api down"));
    const port = fakePort();
    expect(await closeTicket(deps(api, port), TICKET_ID, STAFF_ID)).toEqual({ kind: "failed", stage: "TRANSCRIPT" });
    expect(port.sendWithFile).not.toHaveBeenCalled();
    expect(port.deleteChannel).not.toHaveBeenCalled();
    restore();
  });

  it("archive ok, delete fails: retry does not duplicate the archive; later delete closes", async () => {
    const restore = silence();
    const api = fakeApi();
    const deleteChannel = vi.fn().mockRejectedValueOnce(discordError(50013)).mockResolvedValueOnce(undefined);
    const port = fakePort({ deleteChannel });

    expect(await closeTicket(deps(api, port), TICKET_ID, STAFF_ID)).toEqual({ kind: "failed", stage: "DELETE" });
    expect(api.state.ticket.status).toBe("CLOSING");
    expect(api.state.ticket.archiveMessageId).not.toBeNull();

    expect(await closeTicket(deps(api, port), TICKET_ID, STAFF_ID)).toEqual({ kind: "closed" });
    expect(port.sendWithFile).toHaveBeenCalledTimes(1);
    expect(port.fetchTranscript).toHaveBeenCalledTimes(1);
    expect(api.state.ticket.status).toBe("CLOSED");
    restore();
  });

  it("Unknown Channel after a successful archive finalizes CLOSED", async () => {
    const api = fakeApi({ status: "CLOSING", archiveMessageId: "620000000000000009" });
    const port = fakePort({ deleteChannel: vi.fn(async () => Promise.reject(discordError(10003))) });
    expect(await closeTicket(deps(api, port), TICKET_ID, STAFF_ID)).toEqual({ kind: "closed" });
    expect(api.state.ticket.status).toBe("CLOSED");
    expect(port.sendWithFile).not.toHaveBeenCalled();
  });

  it("channel gone before any transcript: no transcript fabricated, operator-visible close", async () => {
    const api = fakeApi();
    const port = fakePort({ fetchTranscript: vi.fn(async () => Promise.reject(discordError(10003))) });
    expect(await closeTicket(deps(api, port), TICKET_ID, STAFF_ID)).toEqual({ kind: "channel-missing" });
    expect(api.recordTicketTranscript).not.toHaveBeenCalled();
    expect(port.sendWithFile).not.toHaveBeenCalled();
    expect(api.markTicketChannelMissing).toHaveBeenCalledWith(TICKET_ID, TICKET_CHANNEL_ID);
  });

  it("a concurrent close already holds the lease: nothing happens", async () => {
    const api = fakeApi();
    api.state.locked = true;
    const port = fakePort();
    expect(await closeTicket(deps(api, port), TICKET_ID, STAFF_ID)).toEqual({ kind: "busy" });
    expect(port.fetchTranscript).not.toHaveBeenCalled();
  });

  it("archive posted but not recorded: logged loudly with the message id, channel kept", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const api = fakeApi();
    api.recordTicketArchive.mockRejectedValueOnce(new Error("api down"));
    const port = fakePort();
    expect(await closeTicket(deps(api, port), TICKET_ID, STAFF_ID)).toEqual({ kind: "failed", stage: "ARCHIVE" });
    expect(port.deleteChannel).not.toHaveBeenCalled();
    expect(error.mock.calls.some((call) => String(call[0]).includes("was posted but not recorded"))).toBe(true);
    error.mockRestore();
  });
});

describe("retryPendingTicketDeletes (startup pass)", () => {
  it("retries only the delete for archived tickets and closes them", async () => {
    const api = fakeApi({ status: "CLOSING", archiveMessageId: "620000000000000010", closedByDiscordUserId: STAFF_ID });
    const port = fakePort();
    expect(await retryPendingTicketDeletes(deps(api, port))).toBe(1);
    expect(api.beginTicketClose).toHaveBeenCalledWith(TICKET_ID, STAFF_ID);
    expect(port.deleteChannel).toHaveBeenCalledTimes(1);
    expect(port.sendWithFile).not.toHaveBeenCalled();
    expect(port.send).not.toHaveBeenCalled();
    expect(api.state.ticket.status).toBe("CLOSED");
  });

  it("a still-failing delete stays retryable without posting notices", async () => {
    const restore = silence();
    const api = fakeApi({ status: "CLOSING", archiveMessageId: "620000000000000011" });
    const port = fakePort({ deleteChannel: vi.fn(async () => Promise.reject(discordError(50013))) });
    expect(await retryPendingTicketDeletes(deps(api, port))).toBe(0);
    expect(api.state.ticket.status).toBe("CLOSING");
    expect(api.state.failures).toEqual(["DELETE"]);
    expect(port.send).not.toHaveBeenCalled();
    restore();
  });
});
