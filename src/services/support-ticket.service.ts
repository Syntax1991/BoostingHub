import { DomainError } from "@/lib/errors";
import { parseReportedBooster, supportTicketActiveKey } from "@/lib/support-tickets";
import {
  supportTicketRepository,
  type SupportTicketPanelRecord,
  type SupportTicketRecord,
} from "@/repositories/support-ticket.repository";
import { userRepository } from "@/repositories/user.repository";
import {
  abortSupportTicketOpeningSchema,
  activateSupportTicketSchema,
  beginSupportTicketCloseSchema,
  recordSupportTicketArchiveSchema,
  recordSupportTicketPanelSchema,
  recordSupportTicketTranscriptSchema,
  reserveSupportTicketSchema,
  supportTicketChannelMissingSchema,
  supportTicketCloseFailureSchema,
} from "@/validators/support-ticket";

/**
 * Authoritative Support-ticket lifecycle behind the Bot API:
 *
 *   OPENING ──activate──▶ OPEN ──beginClose──▶ CLOSING ──finalize──▶ CLOSED
 *      └──abortOpening / stale──▶ FAILED
 *
 * Discord work (channels, messages, transcripts) happens in the bot process;
 * this service only records what the bot did and decides what is allowed.
 * Close *authorization* (creator or a Staff role for the type) is decided
 * bot-side from the Discord-provided interaction member — role membership
 * is Discord state this service cannot see.
 */

/** An OPENING reservation older than this without a channel is abandoned (bot crash). */
export const SUPPORT_TICKET_OPENING_STALE_MS = 5 * 60 * 1000;
/** Close lease: a crashed close run can be retried after this. */
export const SUPPORT_TICKET_CLOSE_LOCK_MS = 2 * 60 * 1000;
const MAX_NUMBER_ATTEMPTS = 5;

export type ReserveSupportTicketResult =
  | { outcome: "RESERVED"; ticket: SupportTicketRecord }
  | { outcome: "EXISTING"; ticket: SupportTicketRecord };

export type BeginSupportTicketCloseResult = { acquired: boolean; ticket: SupportTicketRecord };

function iso(now: Date): string {
  return now.toISOString();
}

async function requireTicket(ticketId: string): Promise<SupportTicketRecord> {
  const ticket = await supportTicketRepository.findById(ticketId);
  if (!ticket) throw new DomainError("SUPPORT_TICKET_NOT_FOUND", "Ticket not found.", 404);
  return ticket;
}

function invalidState(ticket: SupportTicketRecord, action: string): DomainError {
  return new DomainError(
    "SUPPORT_TICKET_INVALID_STATE",
    `Ticket #${ticket.number} is ${ticket.status} and cannot ${action}.`,
    409,
  );
}

function isStaleOpening(ticket: SupportTicketRecord, now: Date): boolean {
  return (
    ticket.status === "OPENING" &&
    !ticket.channelId &&
    now.getTime() - new Date(ticket.createdAt).getTime() > SUPPORT_TICKET_OPENING_STALE_MS
  );
}

export const supportTicketService = {
  /**
   * Reserves an OPENING ticket, or returns the creator's existing active
   * ticket of the same type. Race-safe: the unique `activeKey` index lets
   * exactly one concurrent INSERT win; losers re-read and get EXISTING.
   */
  async reserve(rawInput: unknown, now: Date = new Date()): Promise<ReserveSupportTicketResult> {
    const input = reserveSupportTicketSchema.parse(rawInput);
    if (input.type === "REPORT_BOOSTER" && !input.booster) {
      throw new DomainError("VALIDATION_FAILED", "Tell us which Booster you are reporting.", 400);
    }

    const activeKey = supportTicketActiveKey(input.creatorDiscordUserId, input.type);
    const existing = await supportTicketRepository.findByActiveKey(activeKey);
    if (existing) {
      if (!isStaleOpening(existing, now)) return { outcome: "EXISTING", ticket: existing };
      await supportTicketRepository.updateIfStatus(
        existing.id,
        "OPENING",
        { status: "FAILED", activeKey: null, lastError: "OPENING_STALE: no Discord channel was ever recorded." },
        iso(now),
      );
    }

    const reported =
      input.type === "REPORT_BOOSTER" && input.booster ? parseReportedBooster(input.booster) : null;
    const linkedUser = await userRepository.findByDiscordUserId(input.creatorDiscordUserId);

    for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt += 1) {
      const number = (await supportTicketRepository.highestNumber()) + 1;
      try {
        const ticket = await supportTicketRepository.insertOpening(
          {
            number,
            type: input.type,
            activeKey,
            creatorUserId: linkedUser?.id ?? null,
            creatorDiscordUserId: input.creatorDiscordUserId,
            creatorDisplayName: input.creatorDisplayName,
            subject: input.subject,
            description: input.description,
            reference: input.reference,
            reportedDiscordUserId: reported?.reportedDiscordUserId ?? null,
            reportedBoosterLabel: reported?.reportedBoosterLabel ?? null,
          },
          iso(now),
        );
        return { outcome: "RESERVED", ticket };
      } catch (error) {
        // Either the activeKey (a concurrent duplicate won) or the number
        // (a concurrent different ticket took it) collided.
        const winner = await supportTicketRepository.findByActiveKey(activeKey);
        if (winner) return { outcome: "EXISTING", ticket: winner };
        if (attempt === MAX_NUMBER_ATTEMPTS - 1) throw error;
      }
    }
    throw new Error("unreachable");
  },

  /** OPENING → OPEN once the bot created the private channel. */
  async activate(ticketId: string, rawInput: unknown, now: Date = new Date()): Promise<SupportTicketRecord> {
    const input = activateSupportTicketSchema.parse(rawInput);
    const ticket = await requireTicket(ticketId);
    if (ticket.status === "OPEN" && ticket.channelId === input.channelId) return ticket;
    const won = await supportTicketRepository.updateIfStatus(
      ticketId,
      "OPENING",
      { status: "OPEN", channelId: input.channelId, channelName: input.channelName, openedAt: iso(now), lastError: null },
      iso(now),
    );
    if (!won) throw invalidState(ticket, "be activated");
    return requireTicket(ticketId);
  },

  /** OPENING → FAILED; frees the active key so the user can simply try again. */
  async abortOpening(ticketId: string, rawInput: unknown, now: Date = new Date()): Promise<SupportTicketRecord> {
    const input = abortSupportTicketOpeningSchema.parse(rawInput);
    const ticket = await requireTicket(ticketId);
    if (ticket.status === "FAILED") return ticket;
    const won = await supportTicketRepository.updateIfStatus(
      ticketId,
      "OPENING",
      { status: "FAILED", activeKey: null, lastError: `OPENING_FAILED: ${input.reason}` },
      iso(now),
    );
    if (!won) throw invalidState(ticket, "abort opening");
    return requireTicket(ticketId);
  },

  async get(ticketId: string): Promise<SupportTicketRecord> {
    return requireTicket(ticketId);
  },

  /**
   * OPEN → CLOSING (first confirmation) or resumes a retryable CLOSING
   * ticket. Takes a short lease; `acquired: false` means another close run
   * holds it right now. The active key is released here: a closing ticket
   * no longer blocks a new one of the same type.
   */
  async beginClose(ticketId: string, rawInput: unknown, now: Date = new Date()): Promise<BeginSupportTicketCloseResult> {
    const input = beginSupportTicketCloseSchema.parse(rawInput);
    const ticket = await requireTicket(ticketId);
    const lockUntil = new Date(now.getTime() + SUPPORT_TICKET_CLOSE_LOCK_MS).toISOString();

    if (ticket.status === "OPEN") {
      const won = await supportTicketRepository.updateIfStatus(
        ticketId,
        "OPEN",
        {
          status: "CLOSING",
          activeKey: null,
          closingStartedAt: iso(now),
          closedByDiscordUserId: input.closedByDiscordUserId,
          closeLockUntil: lockUntil,
          lastError: null,
        },
        iso(now),
      );
      return { acquired: won, ticket: await requireTicket(ticketId) };
    }
    if (ticket.status === "CLOSING") {
      const acquired = await supportTicketRepository.acquireCloseLock(ticketId, lockUntil, iso(now));
      if (acquired) {
        await supportTicketRepository.update(ticketId, { closedByDiscordUserId: input.closedByDiscordUserId }, iso(now));
      }
      return { acquired, ticket: await requireTicket(ticketId) };
    }
    throw invalidState(ticket, "be closed");
  },

  /** Persists the transcript before anything is sent or deleted. Never overwrites an archived one. */
  async recordTranscript(ticketId: string, rawInput: unknown, now: Date = new Date()): Promise<SupportTicketRecord> {
    const input = recordSupportTicketTranscriptSchema.parse(rawInput);
    const ticket = await requireTicket(ticketId);
    if (ticket.status !== "CLOSING") throw invalidState(ticket, "record a transcript");
    if (ticket.archiveMessageId) return ticket;
    await supportTicketRepository.update(
      ticketId,
      {
        transcriptHtml: input.transcriptHtml,
        transcriptFilename: input.transcriptFilename,
        transcriptMessageCount: input.messageCount,
        transcriptTruncated: input.truncated,
      },
      iso(now),
    );
    return requireTicket(ticketId);
  },

  /** Records the archive-log message once; later retries skip the send. */
  async recordArchive(ticketId: string, rawInput: unknown, now: Date = new Date()): Promise<SupportTicketRecord> {
    const input = recordSupportTicketArchiveSchema.parse(rawInput);
    const ticket = await requireTicket(ticketId);
    if (ticket.status !== "CLOSING") throw invalidState(ticket, "record an archive message");
    if (!ticket.hasTranscript) throw invalidState(ticket, "be archived without a transcript");
    if (ticket.archiveMessageId) return ticket;
    await supportTicketRepository.update(ticketId, { archiveMessageId: input.archiveMessageId }, iso(now));
    return requireTicket(ticketId);
  },

  /** CLOSING (archived) → CLOSED after the Discord channel is gone. Idempotent. */
  async finalizeClose(ticketId: string, now: Date = new Date()): Promise<SupportTicketRecord> {
    const ticket = await requireTicket(ticketId);
    if (ticket.status === "CLOSED") return ticket;
    if (ticket.status !== "CLOSING" || !ticket.archiveMessageId) throw invalidState(ticket, "be finalized");
    await supportTicketRepository.updateIfStatus(
      ticketId,
      "CLOSING",
      { status: "CLOSED", channelId: null, closedAt: iso(now), closeLockUntil: null, lastError: null },
      iso(now),
    );
    return requireTicket(ticketId);
  },

  /** A close step failed: keep CLOSING (retryable), release the lease, record why. */
  async recordCloseFailure(ticketId: string, rawInput: unknown, now: Date = new Date()): Promise<SupportTicketRecord> {
    const input = supportTicketCloseFailureSchema.parse(rawInput);
    const ticket = await requireTicket(ticketId);
    if (ticket.status !== "CLOSING") throw invalidState(ticket, "record a close failure");
    await supportTicketRepository.update(
      ticketId,
      { closeLockUntil: null, lastError: `${input.stage}_FAILED: ${input.message}` },
      iso(now),
    );
    return requireTicket(ticketId);
  },

  /**
   * Discord reported Unknown Channel for the ticket's live channel. With an
   * archive already sent this is a normal finalize. Without one, the ticket
   * is CLOSED with an operator-visible error — no transcript is fabricated.
   */
  async markChannelMissing(ticketId: string, rawInput: unknown, now: Date = new Date()): Promise<SupportTicketRecord> {
    const input = supportTicketChannelMissingSchema.parse(rawInput);
    const ticket = await requireTicket(ticketId);
    if (ticket.status === "CLOSED" || ticket.channelId !== input.channelId) return ticket;
    if (ticket.status === "CLOSING" && ticket.archiveMessageId) return this.finalizeClose(ticketId, now);
    if (ticket.status !== "OPEN" && ticket.status !== "CLOSING") throw invalidState(ticket, "lose its channel");
    await supportTicketRepository.updateIfStatus(
      ticketId,
      ticket.status,
      {
        status: "CLOSED",
        activeKey: null,
        channelId: null,
        closedAt: iso(now),
        closeLockUntil: null,
        lastError: "CHANNEL_MISSING_BEFORE_TRANSCRIPT: the Discord channel was deleted outside BoostingHub; no transcript exists.",
      },
      iso(now),
    );
    return requireTicket(ticketId);
  },

  /** Archived-but-not-deleted tickets; the bot retries only the delete (startup pass). */
  async listPendingChannelDeletes(): Promise<SupportTicketRecord[]> {
    return supportTicketRepository.listClosingWithArchive();
  },

  async getPanel(): Promise<SupportTicketPanelRecord | null> {
    return supportTicketRepository.findPanel();
  },

  async recordPanel(rawInput: unknown, now: Date = new Date()): Promise<SupportTicketPanelRecord> {
    const input = recordSupportTicketPanelSchema.parse(rawInput);
    await supportTicketRepository.upsertPanel(input, iso(now));
    return input;
  },
};
