import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertBotServiceAuthorized, resolveActingDiscordUser } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { signupService } from "@/services/signup.service";

const cancelBodySchema = z.object({ reason: z.string().max(2000).nullish() }).nullish();

/**
 * POST /api/bot/runs/:runId/signup/cancel  body: `{ reason? }`
 *
 * The Discord "Cancel Signup" button: withdraws the acting User's entire
 * active BOOSTER and LOOTBUDDY participation for this Run. A picked User
 * (on the roster or its saved draft) must give a reason — without one this
 * fails with WITHDRAW_REASON_REQUIRED and the bot shows a modal for it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const actor = await resolveActingDiscordUser(request.headers.get("x-discord-user-id"));
    const raw = await request.text();
    const body = cancelBodySchema.parse(raw.trim() ? JSON.parse(raw) : null);
    const result = await signupService.withdrawFromRun(actor, { runId, reason: body?.reason ?? null });
    return botApiOk(result);
  } catch (error) {
    return botApiError(error);
  }
}
