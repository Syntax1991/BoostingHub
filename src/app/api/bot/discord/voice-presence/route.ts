import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { VOICE_PRESENCE_MAX_MEMBERS } from "@/lib/voice-presence";
import { voicePresenceService } from "@/services/voice-presence.service";

const snowflake = z.string().regex(/^\d{5,25}$/);

const voicePresenceSchema = z.object({
  runs: z
    .array(
      z.object({
        runId: z.string().uuid(),
        channelId: snowflake,
        discordUserIds: z.array(snowflake).max(VOICE_PRESENCE_MAX_MEMBERS),
      }),
    )
    .max(50),
});

/**
 * POST /api/bot/discord/voice-presence
 *
 * The bot's bounded report (at most once a minute) of who is connected to
 * each running Run's assigned voice channel. Kept in memory only, for the
 * Attendance tab's informational hint (voice-presence.service) — never an
 * attendance status. Reports for other channels / Runs are ignored.
 */
export async function POST(request: NextRequest) {
  try {
    assertBotServiceAuthorized(request);
    const body = voicePresenceSchema.parse(await request.json());
    return botApiOk(await voicePresenceService.record(body.runs));
  } catch (error) {
    return botApiError(error);
  }
}
