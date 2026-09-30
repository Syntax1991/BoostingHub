import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized, resolveActingDiscordUser } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { signupService } from "@/services/signup.service";

/**
 * POST /api/bot/runs/:runId/signup/quick
 *
 * Additive Booster Quick Signup for the Discord Signup embed button. The
 * server derives eligibility and merges into the existing active Booster
 * offer set — the bot sends no Character ids and no complete desired set.
 * Never touches Lootbuddy entries.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const actor = await resolveActingDiscordUser(request.headers.get("x-discord-user-id"));
    const data = await signupService.quickSignupBoosters(actor, { runId });
    return botApiOk(data);
  } catch (error) {
    return botApiError(error);
  }
}
