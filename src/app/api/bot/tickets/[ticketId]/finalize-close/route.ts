import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { supportTicketService } from "@/services/support-ticket.service";
import { entityIdSchema } from "@/validators/ids";

/**
 * POST /api/bot/tickets/:ticketId/finalize-close
 *
 * CLOSING (archive recorded) → CLOSED after the Discord channel was deleted
 * or Discord confirmed it is gone. Idempotent.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const ticketId = entityIdSchema.parse((await params).ticketId);
    return botApiOk(await supportTicketService.finalizeClose(ticketId));
  } catch (error) {
    return botApiError(error);
  }
}
