import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized, resolveActingDiscordUser } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { runService } from "@/services/run.service";

/**
 * POST /api/bot/runs/:runId/archive
 *
 * The Discord "Archive Run" button (after an ephemeral confirm): archives a
 * completed / cancelled Run as the acting Discord User — the same service and
 * the same rules as the app (Raid Lead of the Run or Admin; only COMPLETED /
 * CANCELLED; not twice). The sync loop then closes the Run channel.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const actor = await resolveActingDiscordUser(request.headers.get("x-discord-user-id"));
    return botApiOk(await runService.archiveRun(actor, runId));
  } catch (error) {
    return botApiError(error);
  }
}
