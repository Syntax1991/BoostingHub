import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { discordSyncService } from "@/services/discord-sync.service";

const scheduleStateSchema = z.object({
  bucket: z.enum(["CURRENT", "NEXT"]),
  channelId: z.string().min(1).max(64),
  messageId: z.string().min(1).max(64),
  signature: z.string().min(1).max(128),
});

/**
 * PUT /api/bot/discord/schedule-state
 *
 * Records the persistent CURRENT/NEXT Schedule message the bot just created
 * or edited so the next sync pass can edit in place (or detect a deleted
 * message and create exactly one replacement).
 */
export async function PUT(request: NextRequest) {
  try {
    assertBotServiceAuthorized(request);
    const body = scheduleStateSchema.parse(await request.json());
    await discordSyncService.recordSchedulePost(body);
    return botApiOk({ ok: true });
  } catch (error) {
    return botApiError(error);
  }
}
