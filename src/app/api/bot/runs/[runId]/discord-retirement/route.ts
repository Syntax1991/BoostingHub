import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { discordSyncService } from "@/services/discord-sync.service";

/**
 * GET /api/bot/runs/:runId/discord-retirement
 *
 * Fresh retirement authority for the bot. Used immediately before destructive
 * channel delete so a stale CANCELLED work item cannot retire a reactivated Run.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await context.params;
    const retire = await discordSyncService.shouldRetireRunChannel(runId);
    return botApiOk({ retire });
  } catch (error) {
    return botApiError(error);
  }
}
