import { DEFAULT_TIME_ZONE } from "@/lib/datetime";
import { asStringOrNull } from "@/lib/persistence";
import { parseQuietHoursHm, type QuietHoursSnapshot } from "@/lib/quiet-hours";
import { normalizeTimeZone } from "@/lib/timezone";

export type NotificationDmDeliveryContext = {
  quietHours: QuietHoursSnapshot;
  timeZone: string;
};

/**
 * Quiet Hours + timezone snapshotted from a User row at notification creation.
 * Later Settings edits must not rewrite existing UserNotification.discordDeliverAfter.
 */
export function quietHoursDeliveryContextFromUserRow(
  userRow: Record<string, unknown> | null,
): NotificationDmDeliveryContext {
  const startRaw = asStringOrNull(userRow?.discordDmQuietHoursStart);
  const endRaw = asStringOrNull(userRow?.discordDmQuietHoursEnd);
  return {
    quietHours: {
      enabled: userRow?.discordDmQuietHoursEnabled === true,
      start: startRaw && parseQuietHoursHm(startRaw) ? startRaw : null,
      end: endRaw && parseQuietHoursHm(endRaw) ? endRaw : null,
    },
    timeZone:
      normalizeTimeZone(typeof userRow?.timeZone === "string" ? userRow.timeZone : null) ||
      DEFAULT_TIME_ZONE,
  };
}
