import { z } from "zod";
import { SUPPORT_TICKET_LIMITS } from "@/lib/support-tickets";
import { SUPPORT_TICKET_TYPES } from "@/models/enums";

const snowflake = z.string().regex(/^\d{17,20}$/, "Invalid Discord id");
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim() ?? "";
      return trimmed ? trimmed : null;
    });

/**
 * Body of POST /api/bot/tickets. `creatorDiscordUserId` is the interaction's
 * own user as seen by the bot — never a value the user typed.
 */
export const reserveSupportTicketSchema = z.object({
  type: z.enum(SUPPORT_TICKET_TYPES),
  creatorDiscordUserId: snowflake,
  creatorDisplayName: z.string().trim().min(1).max(SUPPORT_TICKET_LIMITS.displayNameMax),
  subject: z.string().trim().min(1).max(SUPPORT_TICKET_LIMITS.subjectMax),
  description: z
    .string()
    .trim()
    .min(SUPPORT_TICKET_LIMITS.descriptionMin)
    .max(SUPPORT_TICKET_LIMITS.descriptionMax),
  reference: optionalText(SUPPORT_TICKET_LIMITS.referenceMax),
  /** REPORT_BOOSTER only (required there). */
  booster: optionalText(SUPPORT_TICKET_LIMITS.boosterMax),
});
export type ReserveSupportTicketInput = z.input<typeof reserveSupportTicketSchema>;

export const activateSupportTicketSchema = z.object({
  channelId: snowflake,
  channelName: z.string().min(1).max(100),
});

export const abortSupportTicketOpeningSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const beginSupportTicketCloseSchema = z.object({
  closedByDiscordUserId: snowflake,
});

export const recordSupportTicketTranscriptSchema = z.object({
  transcriptHtml: z.string().min(1).max(5_000_000),
  transcriptFilename: z.string().min(1).max(200),
  messageCount: z.number().int().min(0).max(100_000),
  truncated: z.boolean(),
});

export const recordSupportTicketArchiveSchema = z.object({
  archiveMessageId: snowflake,
});

export const supportTicketCloseFailureSchema = z.object({
  stage: z.enum(["TRANSCRIPT", "ARCHIVE", "DELETE"]),
  message: z.string().trim().min(1).max(500),
});

export const supportTicketChannelMissingSchema = z.object({
  channelId: snowflake,
});

export const recordSupportTicketPanelSchema = z.object({
  channelId: snowflake,
  messageId: snowflake,
  lastSignature: z.string().min(1).max(200),
});
