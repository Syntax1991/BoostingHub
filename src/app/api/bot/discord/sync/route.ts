import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { discordSyncService } from "@/services/discord-sync.service";

/**
 * GET /api/bot/discord/sync
 *
 * What the Discord bot polls to learn (a) which Runs' existing dedicated
 * channels need name/category reconciliation (`channels`, independent of
 * message state) and (b) which Runs need their public embed created or
 * refreshed (`signups`/`roster`). Run/Signup/Roster state is never posted to
 * Discord speculatively — this is the single place that decides "something
 * changed".
 */
export async function GET(request: NextRequest) {
  try {
    assertBotServiceAuthorized(request);
    const work = await discordSyncService.listSyncWork();
    const signups = await Promise.all(
      work.signups.map(async (item) => ({
        ...item,
        embed: await discordSyncService.getSignupEmbedData(item.runId),
      })),
    );
    return botApiOk({ channels: work.channels, signups, roster: work.roster });
  } catch (error) {
    return botApiError(error);
  }
}
