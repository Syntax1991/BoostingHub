import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { supportTicketService } from "@/services/support-ticket.service";

/**
 * GET /api/bot/ticket-panel — persisted identity of the one Support panel
 * message (`null` before the first post).
 */
export async function GET(request: NextRequest) {
  try {
    assertBotServiceAuthorized(request);
    return botApiOk(await supportTicketService.getPanel());
  } catch (error) {
    return botApiError(error);
  }
}

/**
 * PUT /api/bot/ticket-panel  body: `{ channelId, messageId, lastSignature }`
 *
 * Records the panel message the bot posted or edited, so a restart reuses it.
 */
export async function PUT(request: NextRequest) {
  try {
    assertBotServiceAuthorized(request);
    return botApiOk(await supportTicketService.recordPanel(await request.json()));
  } catch (error) {
    return botApiError(error);
  }
}
