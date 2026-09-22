import { z } from "zod";

export const markNotificationReadSchema = z.object({
  notificationId: z.string().uuid(),
});

export const updateDmPreferencesSchema = z.object({
  dmRosterSelectedEnabled: z.boolean(),
  dmRaidInviteEnabled: z.boolean(),
});
