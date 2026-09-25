import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { supportTicketService } from "@/services/support-ticket.service";

/**
 * POST /api/bot/tickets
 *
 * Reserves an OPENING Support ticket from a submitted Discord modal, or
 * returns the creator's existing active ticket of the same type
 * (`outcome: "EXISTING"`). `creatorDiscordUserId` is the interaction user.
 */
export async function POST(request: NextRequest) {
  try {
    assertBotServiceAuthorized(request);
    return botApiOk(await supportTicketService.reserve(await request.json()));
  } catch (error) {
    return botApiError(error);
  }
}
