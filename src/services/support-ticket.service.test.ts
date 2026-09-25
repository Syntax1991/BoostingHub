import { afterAll, afterEach, describe, expect, it } from "vitest";
import { orm } from "@/lib/prisma";
import { isDomainError } from "@/lib/errors";
import { supportTicketRepository } from "@/repositories/support-ticket.repository";
import {
  SUPPORT_TICKET_CLOSE_LOCK_MS,
  SUPPORT_TICKET_OPENING_STALE_MS,
  supportTicketService,
} from "@/services/support-ticket.service";

const CREATOR = "610000000000000001";
const OTHER = "610000000000000002";
const STAFF = "610000000000000003";
const REPORTED = "610000000000000099";
const LINKED_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-5e0000000001";
const DISCORD_IDS = [CREATOR, OTHER];

function input(overrides: Record<string, unknown> = {}) {
  return {
    type: "RAID_SUPPORT",
    creatorDiscordUserId: CREATOR,
    creatorDisplayName: "Syntax",
    subject: "Loot question",
    description: "I did not get my loot from last night's run.",
    reference: "Sat 22:00 HC",
    ...overrides,
  };
}

let channelSeq = 0;
function nextChannelId(): string {
  channelSeq += 1;
  return `7000000000${String(channelSeq).padStart(8, "0")}`;
}

async function openTicket(overrides: Record<string, unknown> = {}) {
  const reserved = await supportTicketService.reserve(input(overrides));
  const channelId = nextChannelId();
  const ticket = await supportTicketService.activate(reserved.ticket.id, { channelId, channelName: "ticket-x" });
  return { ticket, channelId };
}

async function cleanup() {
  for (const discordUserId of DISCORD_IDS) {
    await orm.SupportTicket.where({ creatorDiscordUserId: discordUserId }).deleteAll();
  }
  await orm.DiscordTicketPanel.where({ id: "support" }).deleteAll();
  await orm.User.where({ id: LINKED_USER_ID }).deleteAll();
}

afterEach(cleanup);
afterAll(cleanup);

describe("supportTicketService.reserve", () => {
  it("reserves an OPENING ticket with a sequential number", async () => {
    const first = await supportTicketService.reserve(input());
    const second = await supportTicketService.reserve(input({ type: "GENERAL_SUPPORT" }));
    expect(first.outcome).toBe("RESERVED");
    expect(first.ticket.status).toBe("OPENING");
    expect(first.ticket.reference).toBe("Sat 22:00 HC");
    expect(second.ticket.number).toBe(first.ticket.number + 1);
  });

  it("rejects invalid modal input", async () => {
    await expect(supportTicketService.reserve(input({ subject: "   " }))).rejects.toThrow();
    await expect(supportTicketService.reserve(input({ description: "short" }))).rejects.toThrow();
    await expect(supportTicketService.reserve(input({ creatorDiscordUserId: "not-a-snowflake" }))).rejects.toThrow();
    await expect(supportTicketService.reserve(input({ type: "NOPE" }))).rejects.toThrow();
  });

  it("returns the existing ticket for the same user and type", async () => {
    const { ticket, channelId } = await openTicket();
    const again = await supportTicketService.reserve(input());
    expect(again.outcome).toBe("EXISTING");
    expect(again.ticket.id).toBe(ticket.id);
    expect(again.ticket.channelId).toBe(channelId);
  });

  it("allows a different type for the same user, and the same type for another user", async () => {
    await openTicket();
    const otherType = await supportTicketService.reserve(input({ type: "GENERAL_SUPPORT" }));
    const otherUser = await supportTicketService.reserve(input({ creatorDiscordUserId: OTHER }));
    expect(otherType.outcome).toBe("RESERVED");
    expect(otherUser.outcome).toBe("RESERVED");
  });

  it("concurrent duplicate attempts create exactly one active ticket", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => supportTicketService.reserve(input())));
    const reserved = results.filter((result) => result.outcome === "RESERVED");
    expect(reserved).toHaveLength(1);
    expect(new Set(results.map((result) => result.ticket.id)).size).toBe(1);
    const rows = await orm.SupportTicket.where({ creatorDiscordUserId: CREATOR }).all();
    expect(rows).toHaveLength(1);
  });

  it("concurrent different tickets never share a number", async () => {
    const results = await Promise.all([
      supportTicketService.reserve(input({ type: "ADMIN_SUPPORT" })),
      supportTicketService.reserve(input({ type: "GENERAL_SUPPORT" })),
      supportTicketService.reserve(input({ type: "MYTHIC_PLUS_SUPPORT" })),
      supportTicketService.reserve(input({ creatorDiscordUserId: OTHER })),
    ]);
    expect(results.every((result) => result.outcome === "RESERVED")).toBe(true);
    expect(new Set(results.map((result) => result.ticket.number)).size).toBe(4);
  });

  it("closed history does not block a new ticket of the same type", async () => {
    const { ticket, channelId } = await openTicket();
    await supportTicketService.beginClose(ticket.id, { closedByDiscordUserId: STAFF });
    await supportTicketService.markChannelMissing(ticket.id, { channelId });
    const again = await supportTicketService.reserve(input());
    expect(again.outcome).toBe("RESERVED");
    expect(again.ticket.id).not.toBe(ticket.id);
  });

  it("a stale OPENING reservation (bot crash) does not lock the type forever", async () => {
    const past = new Date(Date.now() - SUPPORT_TICKET_OPENING_STALE_MS - 60_000);
    const stale = await supportTicketService.reserve(input(), past);
    const fresh = await supportTicketService.reserve(input());
    expect(fresh.outcome).toBe("RESERVED");
    expect((await supportTicketService.get(stale.ticket.id)).status).toBe("FAILED");
  });

  it("links the creator's BoostingHub account when one exists, and works without one", async () => {
    const now = new Date().toISOString();
    await orm.User.create({
      id: LINKED_USER_ID,
      name: "Linked",
      email: `${LINKED_USER_ID}@ticket.boostting.local`,
      emailVerified: true,
      discordUserId: OTHER,
      accountRole: "USER",
      accountStatus: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });
    const linked = await supportTicketService.reserve(input({ creatorDiscordUserId: OTHER }));
    const unlinked = await supportTicketService.reserve(input());
    expect(linked.ticket.creatorUserId).toBe(LINKED_USER_ID);
    expect(unlinked.ticket.creatorUserId).toBeNull();
  });
});

describe("supportTicketService — Report a Booster", () => {
  it("requires the Booster field", async () => {
    await expect(supportTicketService.reserve(input({ type: "REPORT_BOOSTER" }))).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "VALIDATION_FAILED",
    );
  });

  it("stores the parsed Discord id from a mention", async () => {
    const result = await supportTicketService.reserve(input({ type: "REPORT_BOOSTER", booster: `<@${REPORTED}>` }));
    expect(result.ticket.reportedDiscordUserId).toBe(REPORTED);
    expect(result.ticket.reportedBoosterLabel).toBe(`<@${REPORTED}>`);
  });

  it("stores a plain name as label only", async () => {
    const result = await supportTicketService.reserve(input({ type: "REPORT_BOOSTER", booster: "Titanpal-Blackhand" }));
    expect(result.ticket.reportedDiscordUserId).toBeNull();
    expect(result.ticket.reportedBoosterLabel).toBe("Titanpal-Blackhand");
  });

  it("ignores the Booster field for other types", async () => {
    const result = await supportTicketService.reserve(input({ booster: `<@${REPORTED}>` }));
    expect(result.ticket.reportedDiscordUserId).toBeNull();
    expect(result.ticket.reportedBoosterLabel).toBeNull();
  });
});

describe("supportTicketService — opening", () => {
  it("activate records the channel and moves to OPEN", async () => {
    const { ticket, channelId } = await openTicket();
    expect(ticket.status).toBe("OPEN");
    expect(ticket.channelId).toBe(channelId);
    expect(ticket.openedAt).not.toBeNull();
  });

  it("abortOpening fails the reservation and releases the active key", async () => {
    const reserved = await supportTicketService.reserve(input());
    const aborted = await supportTicketService.abortOpening(reserved.ticket.id, { reason: "Missing Permissions" });
    expect(aborted.status).toBe("FAILED");
    expect(aborted.activeKey).toBeNull();
    expect(aborted.lastError).toContain("Missing Permissions");
    expect((await supportTicketService.reserve(input())).outcome).toBe("RESERVED");
  });

  it("cannot abort an OPEN ticket", async () => {
    const { ticket } = await openTicket();
    await expect(supportTicketService.abortOpening(ticket.id, { reason: "x" })).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "SUPPORT_TICKET_INVALID_STATE",
    );
  });
});

const TRANSCRIPT = { transcriptHtml: "<p>hi</p>", transcriptFilename: "transcript-ticket-0001.html", messageCount: 3, truncated: false };

describe("supportTicketService — closing", () => {
  it("full close: CLOSING → transcript → archive → CLOSED, channel identity cleared", async () => {
    const { ticket } = await openTicket();
    const begun = await supportTicketService.beginClose(ticket.id, { closedByDiscordUserId: STAFF });
    expect(begun.acquired).toBe(true);
    expect(begun.ticket.status).toBe("CLOSING");
    expect(begun.ticket.activeKey).toBeNull();

    await expect(supportTicketService.recordArchive(ticket.id, { archiveMessageId: "800000000000000001" })).rejects.toThrow();
    const withTranscript = await supportTicketService.recordTranscript(ticket.id, TRANSCRIPT);
    expect(withTranscript.hasTranscript).toBe(true);
    expect(withTranscript.transcriptMessageCount).toBe(3);

    await supportTicketService.recordArchive(ticket.id, { archiveMessageId: "800000000000000001" });
    const closed = await supportTicketService.finalizeClose(ticket.id);
    expect(closed.status).toBe("CLOSED");
    expect(closed.channelId).toBeNull();
    expect(closed.closedByDiscordUserId).toBe(STAFF);
    expect(closed.closedAt).not.toBeNull();
    expect(await supportTicketRepository.findTranscriptHtml(ticket.id)).toBe("<p>hi</p>");
  });

  it("finalize is refused before the archive is recorded", async () => {
    const { ticket } = await openTicket();
    await supportTicketService.beginClose(ticket.id, { closedByDiscordUserId: STAFF });
    await expect(supportTicketService.finalizeClose(ticket.id)).rejects.toThrow();
  });

  it("concurrent confirmations: exactly one acquires the close", async () => {
    const { ticket } = await openTicket();
    const results = await Promise.all([
      supportTicketService.beginClose(ticket.id, { closedByDiscordUserId: STAFF }),
      supportTicketService.beginClose(ticket.id, { closedByDiscordUserId: CREATOR }),
    ]);
    expect(results.filter((result) => result.acquired)).toHaveLength(1);
  });

  it("archive failure keeps CLOSING and a retry can re-acquire the close", async () => {
    const { ticket } = await openTicket();
    await supportTicketService.beginClose(ticket.id, { closedByDiscordUserId: STAFF });
    const blocked = await supportTicketService.beginClose(ticket.id, { closedByDiscordUserId: STAFF });
    expect(blocked.acquired).toBe(false);

    const failed = await supportTicketService.recordCloseFailure(ticket.id, { stage: "ARCHIVE", message: "Missing Access" });
    expect(failed.status).toBe("CLOSING");
    expect(failed.lastError).toBe("ARCHIVE_FAILED: Missing Access");
    expect(failed.channelId).not.toBeNull();

    const retry = await supportTicketService.beginClose(ticket.id, { closedByDiscordUserId: STAFF });
    expect(retry.acquired).toBe(true);
  });

  it("an expired close lease can be taken over", async () => {
    const { ticket } = await openTicket();
    await supportTicketService.beginClose(ticket.id, { closedByDiscordUserId: STAFF });
    const later = new Date(Date.now() + SUPPORT_TICKET_CLOSE_LOCK_MS + 1000);
    const takeover = await supportTicketService.beginClose(ticket.id, { closedByDiscordUserId: STAFF }, later);
    expect(takeover.acquired).toBe(true);
  });

  it("delete failure after archive: archive kept, retry skips resend, later finalize closes", async () => {
    const { ticket } = await openTicket();
    await supportTicketService.beginClose(ticket.id, { closedByDiscordUserId: STAFF });
    await supportTicketService.recordTranscript(ticket.id, TRANSCRIPT);
    await supportTicketService.recordArchive(ticket.id, { archiveMessageId: "800000000000000002" });
    await supportTicketService.recordCloseFailure(ticket.id, { stage: "DELETE", message: "rate limited" });

    const pending = await supportTicketService.listPendingChannelDeletes();
    expect(pending.map((row) => row.id)).toContain(ticket.id);

    const retry = await supportTicketService.beginClose(ticket.id, { closedByDiscordUserId: STAFF });
    expect(retry.acquired).toBe(true);
    expect(retry.ticket.archiveMessageId).toBe("800000000000000002");
    // A second archive record / transcript never replaces the first.
    await supportTicketService.recordArchive(ticket.id, { archiveMessageId: "800000000000000003" });
    await supportTicketService.recordTranscript(ticket.id, { ...TRANSCRIPT, transcriptHtml: "<p>other</p>" });
    expect((await supportTicketService.get(ticket.id)).archiveMessageId).toBe("800000000000000002");

    const closed = await supportTicketService.finalizeClose(ticket.id);
    expect(closed.status).toBe("CLOSED");
    expect((await supportTicketService.finalizeClose(ticket.id)).status).toBe("CLOSED");
  });

  it("Unknown Channel after a successful archive finalizes CLOSED", async () => {
    const { ticket, channelId } = await openTicket();
    await supportTicketService.beginClose(ticket.id, { closedByDiscordUserId: STAFF });
    await supportTicketService.recordTranscript(ticket.id, TRANSCRIPT);
    await supportTicketService.recordArchive(ticket.id, { archiveMessageId: "800000000000000004" });
    const closed = await supportTicketService.markChannelMissing(ticket.id, { channelId });
    expect(closed.status).toBe("CLOSED");
    expect(closed.lastError).toBeNull();
  });

  it("channel gone before any transcript: CLOSED with an operator-visible error, no transcript", async () => {
    const { ticket, channelId } = await openTicket();
    const closed = await supportTicketService.markChannelMissing(ticket.id, { channelId });
    expect(closed.status).toBe("CLOSED");
    expect(closed.hasTranscript).toBe(false);
    expect(closed.lastError).toContain("CHANNEL_MISSING_BEFORE_TRANSCRIPT");
  });

  it("markChannelMissing ignores a channel id that is not the ticket's", async () => {
    const { ticket } = await openTicket();
    const unchanged = await supportTicketService.markChannelMissing(ticket.id, { channelId: nextChannelId() });
    expect(unchanged.status).toBe("OPEN");
  });

  it("a CLOSED ticket cannot be closed again", async () => {
    const { ticket, channelId } = await openTicket();
    await supportTicketService.markChannelMissing(ticket.id, { channelId });
    await expect(supportTicketService.beginClose(ticket.id, { closedByDiscordUserId: STAFF })).rejects.toThrow();
  });
});

describe("supportTicketService — panel identity", () => {
  it("stores and replaces the singleton panel identity", async () => {
    expect(await supportTicketService.getPanel()).toBeNull();
    await supportTicketService.recordPanel({ channelId: "900000000000000001", messageId: "900000000000000002", lastSignature: "v1" });
    await supportTicketService.recordPanel({ channelId: "900000000000000001", messageId: "900000000000000003", lastSignature: "v2" });
    expect(await supportTicketService.getPanel()).toEqual({
      channelId: "900000000000000001",
      messageId: "900000000000000003",
      lastSignature: "v2",
    });
    expect(await orm.DiscordTicketPanel.where({ id: "support" }).all()).toHaveLength(1);
  });
});
