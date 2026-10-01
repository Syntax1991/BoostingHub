import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { discordSyncService } from "@/services/discord-sync.service";

/**
 * GET /api/bot/notifications/:notificationId/delivery-authority
 *
 * Fresh deliverability for a UserNotification Discord DM. Re-checked
 * immediately before user.send so stale CANCELLED work cannot DM after Reactivate.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ notificationId: string }> },
) {
  try {
    assertBotServiceAuthorized(request);
    const { notificationId } = await context.params;
    const authority = await discordSyncService.getNotificationDmDeliveryAuthority(notificationId);
    return botApiOk(authority);
  } catch (error) {
    return botApiError(error);
  }
}
