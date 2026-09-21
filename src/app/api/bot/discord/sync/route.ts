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
    const classEmojiFingerprint =
      request.headers.get("x-class-emoji-fingerprint") ??
      request.nextUrl.searchParams.get("classEmojiFingerprint") ??
      "";
    const work = await discordSyncService.listSyncWork(new Date(), { classEmojiFingerprint });
    const signups = await Promise.all(
      work.signups.map(async (item) => ({
        ...item,
        embed: await discordSyncService.getSignupEmbedData(item.runId),
      })),
    );
    return botApiOk({
      channels: work.channels,
      signups,
      roster: work.roster,
      start: work.start,
      raidInvites: work.raidInvites,
      notificationDms: work.notificationDms,
    });
  } catch (error) {
    return botApiError(error);
  }
}
