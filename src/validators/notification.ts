import { z } from "zod";
import { parseQuietHoursHm } from "@/lib/quiet-hours";

export const markNotificationReadSchema = z.object({
  notificationId: z.string().uuid(),
});

/** Nested Quiet Hours block inside updateNotificationPreferencesSchema. */
export const updateQuietHoursPreferencesSchema = z
  .object({
    enabled: z.boolean(),
    start: z.string().nullable(),
    end: z.string().nullable(),
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) return;
    if (!value.start || !parseQuietHoursHm(value.start)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quiet Hours start is required as HH:MM when enabled.",
        path: ["start"],
      });
    }
    if (!value.end || !parseQuietHoursHm(value.end)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quiet Hours end is required as HH:MM when enabled.",
        path: ["end"],
      });
    }
    if (
      value.start &&
      value.end &&
      parseQuietHoursHm(value.start) &&
      parseQuietHoursHm(value.end) &&
      value.start === value.end
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quiet Hours start and end must differ.",
        path: ["end"],
      });
    }
  });

export const updateNotificationPreferencesSchema = z.object({
  discordDmEnabled: z.boolean(),
  dmRosterSelectedEnabled: z.boolean(),
  dmRaidInviteEnabled: z.boolean(),
  dmRunCancelledEnabled: z.boolean(),
  dmRunRescheduledEnabled: z.boolean(),
  dmRosterRemovedEnabled: z.boolean(),
  quietHours: updateQuietHoursPreferencesSchema,
});

export const updateRegionalPreferencesSchema = z.object({
  timeZone: z.string().min(1).max(64),
});

export const updateGameplayPreferencesSchema = z.object({
  defaultCharacterId: z.string().uuid().nullable(),
});

export const updateRunChannelPreferencesSchema = z.object({
  discordRunChannelNickname: z.string().max(24).nullable(),
});
