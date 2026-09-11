import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized, resolveActingDiscordUser } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { signupService } from "@/services/signup.service";

/**
 * GET /api/bot/runs/:runId/signup-options
 *
 * Eligible Characters and the acting User's current active offer-set, for
 * the ephemeral Character-select step behind the Signup / Lootbuddy button.
 * The acting User comes only from the Discord-signed interaction's own user
 * id (X-Discord-User-Id) — never a client-supplied BoostingHub userId.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const actor = await resolveActingDiscordUser(request.headers.get("x-discord-user-id"));
    const data = await signupService.getSignupOptions(actor, runId);
    return botApiOk(data);
  } catch (error) {
    return botApiError(error);
  }
}
