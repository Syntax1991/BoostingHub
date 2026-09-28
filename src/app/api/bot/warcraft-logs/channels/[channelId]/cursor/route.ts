import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { warcraftLogsDiscoveryService } from "@/services/warcraft-logs-discovery.service";

const snowflake = z.string().regex(/^\d{15,25}$/);

/**
 * PUT /api/bot/warcraft-logs/channels/:channelId/cursor
 *
 * The newest message of a dedicated Warcraft Logs log channel the bot has
 * fully processed. Forward-only; configured channels only. Lets a restarted
 * bot continue where it stopped instead of re-reading history.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { channelId } = await params;
    const { messageId } = z.object({ messageId: snowflake }).parse(await request.json());
    await warcraftLogsDiscoveryService.advanceCursor({ channelId: snowflake.parse(channelId), messageId });
    return botApiOk({ ok: true });
  } catch (error) {
    return botApiError(error);
  }
}
