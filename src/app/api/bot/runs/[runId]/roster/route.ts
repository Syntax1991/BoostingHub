import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { DomainError } from "@/lib/errors";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { discordSyncService } from "@/services/discord-sync.service";

/**
 * GET /api/bot/runs/:runId/roster
 *
 * Discord-ready final roster DTO: selected participants only, grouped by
 * role (melee/ranged split derived centrally, not by the bot), the exact
 * data the public roster embed renders. Never a per-user endpoint.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const data = await discordSyncService.getRosterEmbedData(runId);
    // Draft and published lineups both power the persistent Roster Discord
    // message (`listSyncWork` maintains that message before Publish). Returning
    // 404 for unpublished drafts stranded REFRESH work forever: the bot could
    // never edit, never advance lastRosterEmojiFingerprint / lastRosterVersion.
    if (!data) {
      throw new DomainError("NOT_FOUND", "This run has no roster.", 404);
    }
    return botApiOk(data);
  } catch (error) {
    return botApiError(error);
  }
}
