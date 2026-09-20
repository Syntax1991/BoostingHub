import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized, resolveActingDiscordUser } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { signupService } from "@/services/signup.service";

/**
 * POST /api/bot/runs/:runId/signup/cancel
 *
 * The Discord "Cancel Signup" button: withdraws the acting User's entire
 * active BOOSTER and LOOTBUDDY participation for this Run. A protected row
 * (roster-selected or published-locked) rejects the whole cancellation.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const actor = await resolveActingDiscordUser(request.headers.get("x-discord-user-id"));
    const result = await signupService.cancelActiveSignups(actor, { runId });
    return botApiOk(result);
  } catch (error) {
    return botApiError(error);
  }
}
