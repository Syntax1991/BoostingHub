import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { supportTicketService } from "@/services/support-ticket.service";
import { entityIdSchema } from "@/validators/ids";

/**
 * POST /api/bot/tickets/:ticketId/activate  body: `{ channelId, channelName }`
 *
 * OPENING → OPEN after the bot created the private ticket channel.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const ticketId = entityIdSchema.parse((await params).ticketId);
    const result = await supportTicketService.activate(ticketId, await request.json());
    return botApiOk(result);
  } catch (error) {
    return botApiError(error);
  }
}
