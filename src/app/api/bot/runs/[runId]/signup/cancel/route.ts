import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized, resolveActingDiscordUser } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { signupService } from "@/services/signup.service";

/**
 * POST /api/bot/runs/:runId/signup/cancel
 *
 * The Discord "Cancel Signup" button: withdraws the acting User's entire
 * active BOOSTER offer-set for this Run atomically (all-or-nothing). Never
 * touches the User's Lootbuddy entries — those are removed independently via
 * the Lootbuddy editor (see /api/bot/runs/:runId/lootbuddies).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const actor = await resolveActingDiscordUser(request.headers.get("x-discord-user-id"));
    const result = await signupService.cancelBoosterSignup(actor, { runId });
    return botApiOk(result);
  } catch (error) {
    return botApiError(error);
  }
}
