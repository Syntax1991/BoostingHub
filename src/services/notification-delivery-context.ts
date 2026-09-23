import { DEFAULT_TIME_ZONE } from "@/lib/datetime";
import { asStringOrNull } from "@/lib/persistence";
import { parseQuietHoursHm } from "@/lib/quiet-hours";
import { normalizeTimeZone } from "@/lib/timezone";

/** Quiet Hours + timezone snapshotted from a User row at notification creation. */
export function quietHoursDeliveryContextFromUserRow(userRow: Record<string, unknown> | null): {
  quietHours: { enabled: boolean; start: string | null; end: string | null };
  timeZone: string;
} {
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
