import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized, resolveActingDiscordUser } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { signupService } from "@/services/signup.service";

/**
 * GET /api/bot/my-signups
 *
 * Backs the optional /mysignups convenience command — the acting User's own
 * signups grouped by status, identical to the Web My Runs data.
 */
export async function GET(request: NextRequest) {
  try {
    assertBotServiceAuthorized(request);
    const actor = await resolveActingDiscordUser(request.headers.get("x-discord-user-id"));
    const data = await signupService.getMyRuns(actor);
    return botApiOk(data);
  } catch (error) {
    return botApiError(error);
  }
}
