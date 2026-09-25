import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { supportTicketService } from "@/services/support-ticket.service";
import { entityIdSchema } from "@/validators/ids";

/**
 * POST /api/bot/tickets/:ticketId/abort-opening  body: `{ reason }`
 *
 * OPENING → FAILED when Discord channel creation (or its compensation) failed;
 * releases the one-active-ticket-per-type key.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const ticketId = entityIdSchema.parse((await params).ticketId);
    const result = await supportTicketService.abortOpening(ticketId, await request.json());
    return botApiOk(result);
  } catch (error) {
    return botApiError(error);
  }
}
