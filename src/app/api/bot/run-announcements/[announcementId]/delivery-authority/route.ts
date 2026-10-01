import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { discordSyncService } from "@/services/discord-sync.service";

/**
 * GET /api/bot/run-announcements/:announcementId/delivery-authority
 *
 * Fresh deliverability for a RunDiscordAnnouncement. Re-checked immediately
 * before Discord send so stale CANCELLED work cannot post after Reactivate.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ announcementId: string }> },
) {
  try {
    assertBotServiceAuthorized(request);
    const { announcementId } = await context.params;
    const authority = await discordSyncService.getRunAnnouncementDeliveryAuthority(announcementId);
    return botApiOk(authority);
  } catch (error) {
    return botApiError(error);
  }
}
