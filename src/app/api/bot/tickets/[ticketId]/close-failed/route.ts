import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { supportTicketService } from "@/services/support-ticket.service";
import { entityIdSchema } from "@/validators/ids";

/**
 * POST /api/bot/tickets/:ticketId/close-failed  body: `{ stage, message }`
 *
 * A close step failed; the ticket stays CLOSING (retryable) and the lease is released.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const ticketId = entityIdSchema.parse((await params).ticketId);
    const result = await supportTicketService.recordCloseFailure(ticketId, await request.json());
    return botApiOk(result);
  } catch (error) {
    return botApiError(error);
  }
}
