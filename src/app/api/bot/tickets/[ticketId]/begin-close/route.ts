import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { supportTicketService } from "@/services/support-ticket.service";
import { entityIdSchema } from "@/validators/ids";

/**
 * POST /api/bot/tickets/:ticketId/begin-close  body: `{ closedByDiscordUserId }`
 *
 * Confirmed close: OPEN → CLOSING, or resumes a retryable CLOSING ticket.
 * Returns `{ acquired, ticket }`; the bot has already authorized the actor
 * from Discord-provided member roles.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const ticketId = entityIdSchema.parse((await params).ticketId);
    const result = await supportTicketService.beginClose(ticketId, await request.json());
    return botApiOk(result);
  } catch (error) {
    return botApiError(error);
  }
}
