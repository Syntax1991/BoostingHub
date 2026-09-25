import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { supportTicketService } from "@/services/support-ticket.service";

/**
 * GET /api/bot/tickets/pending-deletes
 *
 * CLOSING tickets whose transcript is already archived but whose Discord
 * channel delete failed. Read once at bot startup to retry the delete.
 */
export async function GET(request: NextRequest) {
  try {
    assertBotServiceAuthorized(request);
    return botApiOk(await supportTicketService.listPendingChannelDeletes());
  } catch (error) {
    return botApiError(error);
  }
}
