import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized, resolveActingDiscordUser } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { signupService } from "@/services/signup.service";
import { setCharacterOffersSchema } from "@/validators/signup";

const bodySchema = setCharacterOffersSchema.omit({ runId: true });

/**
 * PUT /api/bot/runs/:runId/signup
 *
 * setCharacterOffers over HTTP: the Discord Signup/Lootbuddy button flow
 * submits the whole desired offer-set in one request, exactly like the Web
 * dialog. The runId always comes from the URL, never the body, so a client
 * cannot target a different Run than the one it authenticated for.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const actor = await resolveActingDiscordUser(request.headers.get("x-discord-user-id"));
    const body = bodySchema.parse(await request.json());
    const result = await signupService.setCharacterOffers(actor, { runId, ...body });
    return botApiOk(result);
  } catch (error) {
    return botApiError(error);
  }
}
