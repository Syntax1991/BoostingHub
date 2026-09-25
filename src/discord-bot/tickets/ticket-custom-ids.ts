import { isSupportTicketType } from "@/lib/support-tickets";
import type { SupportTicketType } from "@/models/enums";

/**
 * Support-ticket component custom ids. Like Run custom ids they carry
 * context only and are never trusted for authorization: the close handlers
 * re-read the ticket from the Bot API, require the interaction channel to be
 * the ticket's own channel, and authorize from Discord-provided member roles.
 * A separate namespace keeps them out of the Run `parseCustomId` grammar.
 */
const NAMESPACE = "bhticket";

export const TICKET_PANEL_SELECT_ID = `${NAMESPACE}:panel`;

export const TICKET_MODAL_FIELDS = {
  subject: "subject",
  reference: "reference",
  description: "description",
  booster: "booster",
} as const;

const TICKET_ACTIONS = ["close", "close-confirm", "close-cancel"] as const;
export type TicketAction = (typeof TICKET_ACTIONS)[number];

const TICKET_ID_PATTERN = /^[0-9a-zA-Z][0-9a-zA-Z-]{7,63}$/;

export function buildTicketModalCustomId(type: SupportTicketType): string {
  return `${NAMESPACE}:modal:${type}`;
}

export function parseTicketModalCustomId(customId: string): SupportTicketType | null {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== NAMESPACE || parts[1] !== "modal") return null;
  return isSupportTicketType(parts[2]) ? parts[2] : null;
}

export function buildTicketActionCustomId(action: TicketAction, ticketId: string): string {
  if (!TICKET_ID_PATTERN.test(ticketId)) {
    throw new Error(`Refusing to build a ticket custom id for an invalid ticketId: ${ticketId}`);
  }
  return `${NAMESPACE}:${action}:${ticketId}`;
}

export function parseTicketActionCustomId(customId: string): { action: TicketAction; ticketId: string } | null {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== NAMESPACE) return null;
  const [, action, ticketId] = parts;
  if (!(TICKET_ACTIONS as readonly string[]).includes(action) || !TICKET_ID_PATTERN.test(ticketId)) return null;
  return { action: action as TicketAction, ticketId };
}

export function isTicketCustomId(customId: string): boolean {
  return customId.startsWith(`${NAMESPACE}:`);
}
