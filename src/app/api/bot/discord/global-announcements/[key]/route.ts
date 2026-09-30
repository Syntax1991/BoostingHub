import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { discordGlobalAnnouncementService } from "@/services/discord-global-announcement.service";

const announcementKey = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]{0,127}$/i);
const snowflake = z.string().regex(/^\d{15,25}$/);

/**
 * GET /api/bot/discord/global-announcements/:key
 *
 * Whether a one-time product announcement was already successfully recorded.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    assertBotServiceAuthorized(_request);
    const { key } = await params;
    const result = await discordGlobalAnnouncementService.getByKey(announcementKey.parse(key));
    return botApiOk(result);
  } catch (error) {
    return botApiError(error);
  }
}

/**
 * PUT /api/bot/discord/global-announcements/:key
 *
 * Record a successful Discord send. Idempotent on key — a second call does
 * not rewrite channelId/messageId (deleted Discord messages are not reposted).
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { key } = await params;
    const body = z
      .object({
        channelId: snowflake,
        messageId: snowflake,
      })
      .parse(await request.json());
    const result = await discordGlobalAnnouncementService.recordDelivery({
      key: announcementKey.parse(key),
      channelId: body.channelId,
      messageId: body.messageId,
    });
    return botApiOk(result);
  } catch (error) {
    return botApiError(error);
  }
}
