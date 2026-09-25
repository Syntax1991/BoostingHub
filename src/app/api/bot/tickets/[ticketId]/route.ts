import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { supportTicketService } from "@/services/support-ticket.service";
import { entityIdSchema } from "@/validators/ids";

/**
 * GET /api/bot/tickets/:ticketId
 *
 * Ticket lifecycle state for the bot (never the transcript body). Bot
 * service token only — there is no end-user ticket read surface.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const ticketId = entityIdSchema.parse((await params).ticketId);
    return botApiOk(await supportTicketService.get(ticketId));
  } catch (error) {
    return botApiError(error);
  }
}
