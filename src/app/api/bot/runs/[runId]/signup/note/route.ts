import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertBotServiceAuthorized, resolveActingDiscordUser } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { signupService } from "@/services/signup.service";

const noteBodySchema = z.object({ note: z.string().max(2000).nullable() });

/** GET /api/bot/runs/:runId/signup/note — the acting User's note (prefills the Discord modal). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const actor = await resolveActingDiscordUser(request.headers.get("x-discord-user-id"));
    return botApiOk(await signupService.getRunNote(actor, { runId }));
  } catch (error) {
    return botApiError(error);
  }
}

/**
 * PUT /api/bot/runs/:runId/signup/note  body: `{ note }`
 *
 * The Discord "Add / Edit Note" modal: one short note per User and Run, stored
 * on their active signups; blank clears it.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const actor = await resolveActingDiscordUser(request.headers.get("x-discord-user-id"));
    const body = noteBodySchema.parse(await request.json());
    return botApiOk(await signupService.setRunNote(actor, { runId, note: body.note }));
  } catch (error) {
    return botApiError(error);
  }
}
