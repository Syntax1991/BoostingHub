import { describe, expect, it, vi } from "vitest";
import { OverwriteType, PermissionFlagsBits, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import type { BotApiClient, BotSupportTicket } from "@/discord-bot/bot-api-client";
import { TICKET_MODAL_FIELDS } from "@/discord-bot/tickets/ticket-custom-ids";
import {
  handleTicketModalSubmit,
  handleTicketPanelSelect,
  interactionDisplayName,
  openReservedTicket,
} from "@/discord-bot/tickets/ticket-create";
import { buildTicketModal, buildTicketOpeningMessage } from "@/discord-bot/tickets/ticket-messages";
import {
  BOT_ID,
  CREATOR_ID,
  discordError,
  fakePort,
  GUILD_ID,
  REPORTED_ID,
  TICKET_CHANNEL_ID,
  TICKET_ENV,
  ticketFixture,
} from "@/discord-bot/tickets/ticket-test-fixtures";

function openingTicket(overrides: Partial<BotSupportTicket> = {}) {
  return ticketFixture({ status: "OPENING", channelId: null, channelName: null, openedAt: null, ...overrides });
}

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    reserveTicket: vi.fn(async () => ({ outcome: "RESERVED", ticket: openingTicket() })),
    activateTicket: vi.fn(async (_id: string, input: { channelId: string; channelName: string }) =>
      ticketFixture({ channelId: input.channelId, channelName: input.channelName }),
    ),
    abortTicketOpening: vi.fn(async () => openingTicket({ status: "FAILED" })),
    markTicketChannelMissing: vi.fn(async () => ticketFixture({ status: "CLOSED", channelId: null })),
    ...overrides,
  } as unknown as BotApiClient & Record<string, ReturnType<typeof vi.fn>>;
}

function modalInteraction(fields: Record<string, string>) {
  return {
    user: { id: CREATOR_ID, username: "syntax", globalName: "Syntax" },
    member: { nick: "Syntax HC" },
    fields: {
      getTextInputValue: vi.fn((id: string) => {
        if (!(id in fields)) throw new Error(`no field ${id}`);
        return fields[id];
      }),
    },
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  };
}

const RAID_FIELDS = {
  [TICKET_MODAL_FIELDS.subject]: " Loot question ",
  [TICKET_MODAL_FIELDS.reference]: "Sat 22:00 HC",
  [TICKET_MODAL_FIELDS.description]: "I did not get my loot.",
};

describe("panel select → modal", () => {
  it("shows the category modal", async () => {
    const interaction = { values: ["RAID_SUPPORT"], showModal: vi.fn(async () => undefined), reply: vi.fn() };
    await handleTicketPanelSelect(interaction as unknown as StringSelectMenuInteraction);
    const modal = (interaction.showModal.mock.calls[0] as unknown[])[0] as { toJSON(): { custom_id: string; title: string } };
    expect(modal.toJSON().custom_id).toBe("bhticket:modal:RAID_SUPPORT");
    expect(modal.toJSON().title).toBe("Raid Support");
  });

  it("rejects an unknown select value", async () => {
    const interaction = { values: ["HACK"], showModal: vi.fn(), reply: vi.fn(async () => undefined) };
    await handleTicketPanelSelect(interaction as unknown as StringSelectMenuInteraction);
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
  });
});

describe("buildTicketModal — fields per category", () => {
  function fieldIds(type: Parameters<typeof buildTicketModal>[0]) {
    const json = buildTicketModal(type).toJSON() as unknown as {
      components: Array<{ component: { custom_id: string; required: boolean; max_length: number } }>;
    };
    return json.components.map((label) => [label.component.custom_id, label.component.required]);
  }

  it("Admin / General: subject + description", () => {
    expect(fieldIds("ADMIN_SUPPORT")).toEqual([["subject", true], ["description", true]]);
    expect(fieldIds("GENERAL_SUPPORT")).toEqual([["subject", true], ["description", true]]);
  });

  it("Raid / M+: subject + optional reference + description", () => {
    expect(fieldIds("RAID_SUPPORT")).toEqual([["subject", true], ["reference", false], ["description", true]]);
    expect(fieldIds("MYTHIC_PLUS_SUPPORT")).toEqual([["subject", true], ["reference", false], ["description", true]]);
  });

  it("Report a Booster: required booster, optional run reference, required details", () => {
    expect(fieldIds("REPORT_BOOSTER")).toEqual([
      ["booster", true],
      ["subject", true],
      ["reference", false],
      ["description", true],
    ]);
  });

  it("stays within Discord modal limits (≤5 inputs, title ≤45)", () => {
    for (const type of ["ADMIN_SUPPORT", "RAID_SUPPORT", "MYTHIC_PLUS_SUPPORT", "GENERAL_SUPPORT", "REPORT_BOOSTER"] as const) {
      const json = buildTicketModal(type).toJSON() as unknown as { title: string; components: unknown[] };
      expect(json.components.length).toBeLessThanOrEqual(5);
      expect(json.title.length).toBeLessThanOrEqual(45);
    }
  });
});

describe("handleTicketModalSubmit", () => {
  it("reserves with the interaction user's identity, creates the channel, replies with its link", async () => {
    const api = fakeApi();
    const port = fakePort();
    const interaction = modalInteraction(RAID_FIELDS);

    await handleTicketModalSubmit(interaction as unknown as ModalSubmitInteraction, { api, port, env: TICKET_ENV }, "RAID_SUPPORT");

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(api.reserveTicket).toHaveBeenCalledWith({
      type: "RAID_SUPPORT",
      creatorDiscordUserId: CREATOR_ID,
      creatorDisplayName: "Syntax HC",
      subject: "Loot question",
      description: "I did not get my loot.",
      reference: "Sat 22:00 HC",
      booster: null,
    });
    expect(port.createTicketChannel).toHaveBeenCalledTimes(1);
    expect(api.activateTicket).toHaveBeenCalledWith(expect.any(String), {
      channelId: TICKET_CHANNEL_ID,
      channelName: "ticket-0042-syntax",
    });
    expect(port.send).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: `Your Raid Support ticket is open: <#${TICKET_CHANNEL_ID}>` });
  });

  it("same type already open: links the existing channel, creates nothing", async () => {
    const api = fakeApi({ reserveTicket: vi.fn(async () => ({ outcome: "EXISTING", ticket: ticketFixture() })) });
    const port = fakePort();
    const interaction = modalInteraction(RAID_FIELDS);
    await handleTicketModalSubmit(interaction as unknown as ModalSubmitInteraction, { api, port, env: TICKET_ENV }, "RAID_SUPPORT");
    expect(port.createTicketChannel).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: `You already have an open Raid Support ticket: <#${TICKET_CHANNEL_ID}>`,
    });
  });

  it("existing ticket whose channel was deleted outside BoostingHub is released and a new one opens", async () => {
    const reserveTicket = vi
      .fn()
      .mockResolvedValueOnce({ outcome: "EXISTING", ticket: ticketFixture() })
      .mockResolvedValueOnce({ outcome: "RESERVED", ticket: openingTicket({ id: "aaaaaaaa-aaaa-4aaa-8aaa-7e0000000002", number: 43 }) });
    const api = fakeApi({ reserveTicket });
    const port = fakePort({ channelExists: vi.fn(async () => false) });
    const interaction = modalInteraction(RAID_FIELDS);
    await handleTicketModalSubmit(interaction as unknown as ModalSubmitInteraction, { api, port, env: TICKET_ENV }, "RAID_SUPPORT");
    expect(api.markTicketChannelMissing).toHaveBeenCalledWith(ticketFixture().id, TICKET_CHANNEL_ID);
    expect(reserveTicket).toHaveBeenCalledTimes(2);
    expect(port.createTicketChannel).toHaveBeenCalledTimes(1);
  });

  it("Report a Booster passes the Booster field through for server-side parsing", async () => {
    const api = fakeApi();
    const interaction = modalInteraction({ ...RAID_FIELDS, [TICKET_MODAL_FIELDS.booster]: `<@${REPORTED_ID}>` });
    await handleTicketModalSubmit(
      interaction as unknown as ModalSubmitInteraction,
      { api, port: fakePort(), env: TICKET_ENV },
      "REPORT_BOOSTER",
    );
    expect(api.reserveTicket).toHaveBeenCalledWith(expect.objectContaining({ type: "REPORT_BOOSTER", booster: `<@${REPORTED_ID}>` }));
  });
});

describe("openReservedTicket — private channel", () => {
  it("creates the channel under the ticket category with the private overwrites", async () => {
    const port = fakePort();
    await openReservedTicket({ api: fakeApi(), port, env: TICKET_ENV }, openingTicket());
    const [input] = port.createTicketChannel.mock.calls[0] as unknown as [
      { name: string; parentId: string; overwrites: Array<{ id: string; type: OverwriteType; allow: bigint[]; deny: bigint[] }> },
    ];
    expect(input.parentId).toBe(TICKET_ENV.categoryId);
    expect(input.name).toBe("ticket-0042-syntax");
    const ids = input.overwrites.map((overwrite) => overwrite.id);
    expect(ids).toEqual([GUILD_ID, CREATOR_ID, TICKET_ENV.raidStaffRoleId, TICKET_ENV.adminRoleId, BOT_ID]);
  });

  it("Report a Booster with a known id adds an explicit deny for the reported user", async () => {
    const port = fakePort();
    await openReservedTicket(
      { api: fakeApi(), port, env: TICKET_ENV },
      openingTicket({ type: "REPORT_BOOSTER", reportedDiscordUserId: REPORTED_ID, reportedBoosterLabel: `<@${REPORTED_ID}>` }),
    );
    const [input] = port.createTicketChannel.mock.calls[0] as unknown as [
      { overwrites: Array<{ id: string; deny: bigint[] }> },
    ];
    const reported = input.overwrites.find((overwrite) => overwrite.id === REPORTED_ID);
    expect(reported?.deny).toEqual([PermissionFlagsBits.ViewChannel]);
    expect(input.overwrites.map((overwrite) => overwrite.id)).not.toContain(TICKET_ENV.raidStaffRoleId);
  });

  it("opening message pings exactly the type's Staff roles and nobody else", async () => {
    const port = fakePort();
    await openReservedTicket({ api: fakeApi(), port, env: TICKET_ENV }, openingTicket());
    const [channelId, payload] = port.send.mock.calls[0] as unknown as [string, { allowedMentions: unknown; content: string }];
    expect(channelId).toBe(TICKET_CHANNEL_ID);
    expect(payload.allowedMentions).toEqual({ parse: [], roles: [TICKET_ENV.raidStaffRoleId, TICKET_ENV.adminRoleId] });
    expect(payload.content).toBe(`<@&${TICKET_ENV.raidStaffRoleId}> <@&${TICKET_ENV.adminRoleId}>`);
  });

  it("Discord create fails: reservation released, no activate", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const api = fakeApi();
    const port = fakePort({ createTicketChannel: vi.fn(async () => Promise.reject(discordError(50013))) });
    expect(await openReservedTicket({ api, port, env: TICKET_ENV }, openingTicket())).toEqual({ ok: false });
    expect(api.abortTicketOpening).toHaveBeenCalledWith(openingTicket().id, expect.stringContaining("50013"));
    expect(api.activateTicket).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("create ok but activation fails: compensating delete, then reservation released", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const api = fakeApi({ activateTicket: vi.fn(async () => Promise.reject(new Error("api down"))) });
    const port = fakePort();
    expect(await openReservedTicket({ api, port, env: TICKET_ENV }, openingTicket())).toEqual({ ok: false });
    expect(port.deleteChannel).toHaveBeenCalledWith(TICKET_CHANNEL_ID, expect.any(String));
    expect(api.abortTicketOpening).toHaveBeenCalledTimes(1);
    expect(port.send).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("compensation delete also fails: high-signal orphan log with ticket and channel id, no throw", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const api = fakeApi({
      activateTicket: vi.fn(async () => Promise.reject(new Error("api down"))),
      abortTicketOpening: vi.fn(async () => Promise.reject(new Error("api still down"))),
    });
    const port = fakePort({ deleteChannel: vi.fn(async () => Promise.reject(discordError(50013))) });
    await expect(openReservedTicket({ api, port, env: TICKET_ENV }, openingTicket())).resolves.toEqual({ ok: false });
    const orphanLog = error.mock.calls.map((call) => String(call[0])).find((line) => line.includes("ORPHAN"));
    expect(orphanLog).toContain(`ticket=${openingTicket().id}`);
    expect(orphanLog).toContain(`channel=${TICKET_CHANNEL_ID}`);
    error.mockRestore();
  });

  it("opening message failure does not fail an already live ticket", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const port = fakePort({ send: vi.fn(async () => Promise.reject(discordError(50013))) });
    expect(await openReservedTicket({ api: fakeApi(), port, env: TICKET_ENV }, openingTicket())).toEqual({
      ok: true,
      channelId: TICKET_CHANNEL_ID,
    });
    error.mockRestore();
  });
});

describe("buildTicketOpeningMessage", () => {
  it("Report a Booster: shows the reported Booster but never pings them", () => {
    const ticket = ticketFixture({
      type: "REPORT_BOOSTER",
      reportedDiscordUserId: REPORTED_ID,
      reportedBoosterLabel: `<@${REPORTED_ID}>`,
    });
    const payload = buildTicketOpeningMessage(ticket, [TICKET_ENV.moderatorRoleId, TICKET_ENV.adminRoleId]);
    expect(payload.content).not.toContain(REPORTED_ID);
    expect(payload.allowedMentions).toEqual({ parse: [], roles: [TICKET_ENV.moderatorRoleId, TICKET_ENV.adminRoleId] });
    expect(JSON.stringify(payload.embeds)).toContain("Reported Booster");
    expect(payload.content).not.toMatch(/@everyone|@here/);
  });

  it("has a Close Ticket button bound to the ticket id", () => {
    const payload = buildTicketOpeningMessage(ticketFixture(), []);
    expect(JSON.stringify(payload.components)).toContain(`bhticket:close:${ticketFixture().id}`);
  });
});

describe("interactionDisplayName", () => {
  it("prefers the server nickname, then global name, then username", () => {
    expect(interactionDisplayName({ member: { displayName: "Nick" }, user: { username: "u", globalName: "G" } })).toBe("Nick");
    expect(interactionDisplayName({ member: null, user: { username: "u", globalName: "G" } })).toBe("G");
    expect(interactionDisplayName({ user: { username: "u" } })).toBe("u");
  });
});
