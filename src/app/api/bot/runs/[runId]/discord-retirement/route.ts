import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { discordSyncService } from "@/services/discord-sync.service";

/**
 * GET /api/bot/runs/:runId/discord-retirement
 *
 * Fresh TEXT-channel retirement authority for the bot. Queried immediately
 * before every irreversible channel.delete(). Only the current Run row's
 * `archivedAt != null` returns `{ retire: true }` — COMPLETED/CANCELLED alone
 * never authorize deletion, and Restore Archive revokes it immediately.
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
