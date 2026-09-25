import { vi } from "vitest";
import type { BotSupportTicket } from "@/discord-bot/bot-api-client";
import type { BotTicketEnv } from "@/discord-bot/env";
import type { TicketDiscordPort } from "@/discord-bot/tickets/ticket-discord-port";

/** Shared fixtures for ticket tests (test-only module). */
export const TICKET_ENV: BotTicketEnv = {
  panelChannelId: "100000000000000001",
  categoryId: "100000000000000002",
  archiveLogChannelId: "100000000000000003",
  adminRoleId: "200000000000000001",
  moderatorRoleId: "200000000000000002",
  raidStaffRoleId: "200000000000000003",
  mythicPlusStaffRoleId: "200000000000000004",
};

export const GUILD_ID = "300000000000000001";
export const BOT_ID = "300000000000000002";
export const CREATOR_ID = "400000000000000001";
export const REPORTED_ID = "400000000000000009";
export const TICKET_CHANNEL_ID = "500000000000000001";
export const TICKET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-7e0000000001";

export function ticketFixture(overrides: Partial<BotSupportTicket> = {}): BotSupportTicket {
  return {
    id: TICKET_ID,
    number: 42,
    type: "RAID_SUPPORT",
    status: "OPEN",
    creatorDiscordUserId: CREATOR_ID,
    creatorDisplayName: "Syntax",
    subject: "Loot question",
    description: "I did not get my loot.",
    reference: "Sat 22:00 HC",
    reportedDiscordUserId: null,
    reportedBoosterLabel: null,
    channelId: TICKET_CHANNEL_ID,
    channelName: "ticket-0042-syntax",
    createdAt: "2026-09-25T10:00:00.000Z",
    openedAt: "2026-09-25T10:00:01.000Z",
    closedAt: null,
    closedByDiscordUserId: null,
    archiveMessageId: null,
    lastError: null,
    ...overrides,
  };
}

export function fakePort(overrides: Partial<TicketDiscordPort> = {}) {
  let seq = 0;
  const port = {
    guildId: GUILD_ID,
    botUserId: vi.fn<TicketDiscordPort["botUserId"]>(() => BOT_ID),
    guildName: vi.fn<TicketDiscordPort["guildName"]>(async () => "Test Guild"),
    createTicketChannel: vi.fn<TicketDiscordPort["createTicketChannel"]>(async () => ({ id: TICKET_CHANNEL_ID })),
    deleteChannel: vi.fn<TicketDiscordPort["deleteChannel"]>(async () => undefined),
    channelExists: vi.fn<TicketDiscordPort["channelExists"]>(async () => true),
    send: vi.fn<TicketDiscordPort["send"]>(async () => ({ id: `600000000000000${String(++seq).padStart(3, "0")}` })),
    sendWithFile: vi.fn<TicketDiscordPort["sendWithFile"]>(async () => ({ id: `610000000000000${String(++seq).padStart(3, "0")}` })),
    editMessage: vi.fn<TicketDiscordPort["editMessage"]>(async () => undefined),
    deleteMessage: vi.fn<TicketDiscordPort["deleteMessage"]>(async () => undefined),
    fetchMessageExists: vi.fn<TicketDiscordPort["fetchMessageExists"]>(async () => undefined),
    fetchTranscript: vi.fn<TicketDiscordPort["fetchTranscript"]>(async () => ({ messages: [], truncated: false })),
  };
  Object.assign(port, overrides);
  return port satisfies TicketDiscordPort;
}

export function discordError(code: number): Error & { code: number } {
  return Object.assign(new Error(`Discord error ${code}`), { code });
}
