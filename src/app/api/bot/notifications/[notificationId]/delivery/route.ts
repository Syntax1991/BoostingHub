import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { discordSyncService } from "@/services/discord-sync.service";

/** Body for PUT /api/bot/notifications/:notificationId/delivery — a stable bot↔API wire contract. */
export const notificationDeliveryUpdateSchema = z.object({
  result: z.enum(["SENT", "FAILED_PERMANENT"]),
});

/**
 * PUT /api/bot/notifications/:notificationId/delivery
 *
 * Records the Discord DM outcome of a PENDING account-level UserNotification
 * (one without a Run, e.g. CHARACTER_BATTLENET_REPAIR). Compare-and-set: a
 * notification that is no longer PENDING is left untouched. Run notifications
 * keep using PUT /api/bot/runs/:runId/discord-state (`notification-dm`).
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ notificationId: string }> },
) {
  try {
    assertBotServiceAuthorized(request);
    const { notificationId } = await context.params;
    const update = notificationDeliveryUpdateSchema.parse(await request.json());
    const { applied } = await discordSyncService.recordNotificationDmDelivery({
      notificationId: z.string().uuid().parse(notificationId),
      result: update.result,
    });
    return botApiOk({ recorded: applied });
  } catch (error) {
    return botApiError(error);
  }
}
