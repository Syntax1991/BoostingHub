import { orm } from "@/lib/prisma";
import { asNumber, asNumberOrNull, asString, asStringOrNull } from "@/lib/persistence";
import {
  SUPPORT_TICKET_STATUSES,
  SUPPORT_TICKET_TYPES,
  type SupportTicketStatus,
  type SupportTicketType,
} from "@/models/enums";

/** Ticket row without the (potentially large) transcript body. */
export type SupportTicketRecord = {
  id: string;
  number: number;
  type: SupportTicketType;
  status: SupportTicketStatus;
  activeKey: string | null;
  creatorUserId: string | null;
  creatorDiscordUserId: string;
  creatorDisplayName: string;
  subject: string;
  description: string;
  reference: string | null;
  reportedDiscordUserId: string | null;
  reportedBoosterLabel: string | null;
  channelId: string | null;
  channelName: string | null;
  openedAt: string | null;
  closingStartedAt: string | null;
  closeLockUntil: string | null;
  closedAt: string | null;
  closedByDiscordUserId: string | null;
  lastError: string | null;
  archiveMessageId: string | null;
  transcriptFilename: string | null;
  transcriptMessageCount: number | null;
  transcriptTruncated: boolean;
  hasTranscript: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ReserveSupportTicketRow = {
  number: number;
  type: SupportTicketType;
  activeKey: string;
  creatorUserId: string | null;
  creatorDiscordUserId: string;
  creatorDisplayName: string;
  subject: string;
  description: string;
  reference: string | null;
  reportedDiscordUserId: string | null;
  reportedBoosterLabel: string | null;
};

export type SupportTicketPanelRecord = {
  channelId: string;
  messageId: string;
  lastSignature: string | null;
};

type SupportTicketPatch = Partial<{
  status: SupportTicketStatus;
  activeKey: string | null;
  channelId: string | null;
  channelName: string | null;
  openedAt: string | null;
  closingStartedAt: string | null;
  closeLockUntil: string | null;
  closedAt: string | null;
  closedByDiscordUserId: string | null;
  lastError: string | null;
  archiveMessageId: string | null;
  transcriptHtml: string | null;
  transcriptFilename: string | null;
  transcriptMessageCount: number | null;
  transcriptTruncated: boolean;
}>;

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function mapTicketRow(row: Record<string, unknown>): SupportTicketRecord {
  return {
    id: asString(row.id),
    number: asNumber(row.number),
    type: asEnum(row.type, SUPPORT_TICKET_TYPES, "GENERAL_SUPPORT"),
    status: asEnum(row.status, SUPPORT_TICKET_STATUSES, "OPENING"),
    activeKey: asStringOrNull(row.activeKey),
    creatorUserId: asStringOrNull(row.creatorUserId),
    creatorDiscordUserId: asString(row.creatorDiscordUserId),
    creatorDisplayName: asString(row.creatorDisplayName),
    subject: asString(row.subject),
    description: asString(row.description),
    reference: asStringOrNull(row.reference),
    reportedDiscordUserId: asStringOrNull(row.reportedDiscordUserId),
    reportedBoosterLabel: asStringOrNull(row.reportedBoosterLabel),
    channelId: asStringOrNull(row.channelId),
    channelName: asStringOrNull(row.channelName),
    openedAt: asStringOrNull(row.openedAt),
    closingStartedAt: asStringOrNull(row.closingStartedAt),
    closeLockUntil: asStringOrNull(row.closeLockUntil),
    closedAt: asStringOrNull(row.closedAt),
    closedByDiscordUserId: asStringOrNull(row.closedByDiscordUserId),
    lastError: asStringOrNull(row.lastError),
    archiveMessageId: asStringOrNull(row.archiveMessageId),
    transcriptFilename: asStringOrNull(row.transcriptFilename),
    transcriptMessageCount: asNumberOrNull(row.transcriptMessageCount),
    transcriptTruncated: row.transcriptTruncated === true,
    hasTranscript: typeof row.transcriptHtml === "string" && row.transcriptHtml.length > 0,
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  };
}

const PANEL_KEY = "support";

export const supportTicketRepository = {
  async findById(id: string): Promise<SupportTicketRecord | null> {
    const row = await orm.SupportTicket.where({ id }).first();
    return row ? mapTicketRow(row as Record<string, unknown>) : null;
  },

  async findByActiveKey(activeKey: string): Promise<SupportTicketRecord | null> {
    const row = await orm.SupportTicket.where({ activeKey }).first();
    return row ? mapTicketRow(row as Record<string, unknown>) : null;
  },

  async findTranscriptHtml(id: string): Promise<string | null> {
    const row = await orm.SupportTicket.where({ id }).select("transcriptHtml").first();
    return row ? asStringOrNull((row as Record<string, unknown>).transcriptHtml) : null;
  },

  async highestNumber(): Promise<number> {
    const row = await orm.SupportTicket.select("number")
      .orderBy((t) => t.number.desc())
      .first();
    return row ? asNumber((row as Record<string, unknown>).number) : 0;
  },

  /**
   * Plain INSERT. The unique indexes on `number` and `activeKey` are the
   * race guards — the caller interprets a failure by re-reading.
   */
  async insertOpening(input: ReserveSupportTicketRow, now: string): Promise<SupportTicketRecord> {
    const row = await orm.SupportTicket.create({
      id: crypto.randomUUID(),
      number: input.number,
      type: input.type,
      status: "OPENING",
      activeKey: input.activeKey,
      creatorUserId: input.creatorUserId,
      creatorDiscordUserId: input.creatorDiscordUserId,
      creatorDisplayName: input.creatorDisplayName,
      subject: input.subject,
      description: input.description,
      reference: input.reference,
      reportedDiscordUserId: input.reportedDiscordUserId,
      reportedBoosterLabel: input.reportedBoosterLabel,
      channelId: null,
      channelName: null,
      openedAt: null,
      closingStartedAt: null,
      closeLockUntil: null,
      closedAt: null,
      closedByDiscordUserId: null,
      lastError: null,
      archiveMessageId: null,
      transcriptHtml: null,
      transcriptFilename: null,
      transcriptMessageCount: null,
      transcriptTruncated: false,
      createdAt: now,
      updatedAt: now,
    });
    return mapTicketRow(row as Record<string, unknown>);
  },

  /** Unconditional patch by id. */
  async update(id: string, patch: SupportTicketPatch, now: string): Promise<void> {
    await orm.SupportTicket.where({ id }).update({ ...patch, updatedAt: now });
  },

  /**
   * Compare-and-set on `status` — a single UPDATE … WHERE, so exactly one of
   * several concurrent callers wins. Returns whether this caller won.
   */
  async updateIfStatus(
    id: string,
    expected: SupportTicketStatus,
    patch: SupportTicketPatch,
    now: string,
  ): Promise<boolean> {
    const count = await orm.SupportTicket.where({ id, status: expected }).updateAndCount({ ...patch, updatedAt: now });
    return count === 1;
  },

  /** Takes the close lease when it is free or expired (compare-and-set). */
  async acquireCloseLock(id: string, lockUntil: string, now: string): Promise<boolean> {
    const free = await orm.SupportTicket.where({ id, status: "CLOSING" })
      .where((t) => t.closeLockUntil.isNull())
      .updateAndCount({ closeLockUntil: lockUntil, updatedAt: now });
    if (free === 1) return true;
    const expired = await orm.SupportTicket.where({ id, status: "CLOSING" })
      .where((t) => t.closeLockUntil.lte(now))
      .updateAndCount({ closeLockUntil: lockUntil, updatedAt: now });
    return expired === 1;
  },

  /** CLOSING tickets whose archive was already sent — only the channel delete is left. */
  async listClosingWithArchive(limit = 25): Promise<SupportTicketRecord[]> {
    const rows = await orm.SupportTicket.where({ status: "CLOSING" })
      .where((t) => t.archiveMessageId.isNotNull())
      .orderBy((t) => t.updatedAt.asc())
      .limit(limit)
      .all();
    return rows.map((row) => mapTicketRow(row as Record<string, unknown>));
  },

  async findPanel(): Promise<SupportTicketPanelRecord | null> {
    const row = await orm.DiscordTicketPanel.where({ id: PANEL_KEY }).first();
    if (!row) return null;
    const record = row as Record<string, unknown>;
    return {
      channelId: asString(record.channelId),
      messageId: asString(record.messageId),
      lastSignature: asStringOrNull(record.lastSignature),
    };
  },

  async upsertPanel(input: SupportTicketPanelRecord, now: string): Promise<void> {
    const existing = await orm.DiscordTicketPanel.where({ id: PANEL_KEY }).first();
    if (existing) {
      await orm.DiscordTicketPanel.where({ id: PANEL_KEY }).update({ ...input, updatedAt: now });
      return;
    }
    await orm.DiscordTicketPanel.create({ id: PANEL_KEY, ...input, createdAt: now, updatedAt: now });
  },
};
