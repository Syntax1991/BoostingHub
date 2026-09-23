import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized, resolveActingDiscordUser } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { signupService } from "@/services/signup.service";
import { setCharacterOffersSchema } from "@/validators/signup";

const botSetCharacterOffersBodySchema = setCharacterOffersSchema.omit({ runId: true });

/**
 * PUT /api/bot/runs/:runId/signup
 *
 * setCharacterOffers over HTTP: the Discord Signup button flow submits the
 * whole desired BOOSTER offer-set in one request, exactly like the Web
 * dialog. The runId always comes from the URL, never the body, so a client
 * cannot target a different Run than the one it authenticated for. Lootbuddy
 * entries go through their own endpoint — see /api/bot/runs/:runId/lootbuddies.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const actor = await resolveActingDiscordUser(request.headers.get("x-discord-user-id"));
    const characterOffers = botSetCharacterOffersBodySchema.parse(await request.json());
    const offerResult = await signupService.setCharacterOffers(actor, { runId, ...characterOffers });
    return botApiOk(offerResult);
  } catch (error) {
    return botApiError(error);
  }
}
