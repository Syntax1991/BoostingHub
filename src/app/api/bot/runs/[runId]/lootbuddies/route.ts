import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized, resolveActingDiscordUser } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { signupService } from "@/services/signup.service";
import { setLootbuddiesSchema } from "@/validators/signup";

const bodySchema = setLootbuddiesSchema.omit({ runId: true });

/**
 * PUT /api/bot/runs/:runId/lootbuddies
 *
 * setLootbuddies over HTTP: the Discord Sign as Lootbuddy flow submits the
 * whole desired Lootbuddy entry set in one request, exactly like the Web
 * dialog. A distinct collection from Booster offers — see
 * /api/bot/runs/:runId/signup. The runId always comes from the URL, never
 * the body, so a client cannot target a different Run than the one it
 * authenticated for.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const actor = await resolveActingDiscordUser(request.headers.get("x-discord-user-id"));
    const body = bodySchema.parse(await request.json());
    const result = await signupService.setLootbuddies(actor, { runId, ...body });
    return botApiOk(result);
  } catch (error) {
    return botApiError(error);
  }
}
