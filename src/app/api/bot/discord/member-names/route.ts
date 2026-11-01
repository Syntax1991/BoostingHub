import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { discordMemberNameSyncService } from "@/services/discord-member-name-sync.service";

/**
 * POST /api/bot/discord/member-names
 *
 * The bot's ~10 min name refresh tick: one bounded pass reading the Discord
 * guild member of people in upcoming Runs whose displayed name is older than
 * a day (discord-member-name-sync). The API decides who is due; the bot only
 * ticks.
 */
export async function POST(request: NextRequest) {
  try {
    assertBotServiceAuthorized(request);
    return botApiOk(await discordMemberNameSyncService.runDuePass());
  } catch (error) {
    return botApiError(error);
  }
}
