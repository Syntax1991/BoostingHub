import { z } from "zod";

export const markNotificationReadSchema = z.object({
  notificationId: z.string().uuid(),
});

export const updateDmPreferencesSchema = z.object({
  discordDmEnabled: z.boolean(),
  dmRosterSelectedEnabled: z.boolean(),
  dmRaidInviteEnabled: z.boolean(),
  dmRunCancelledEnabled: z.boolean(),
  dmRunRescheduledEnabled: z.boolean(),
  dmRosterRemovedEnabled: z.boolean(),
});

export const updateRegionalPreferencesSchema = z.object({
  timeZone: z.string().min(1).max(64),
});

export const updateGameplayPreferencesSchema = z.object({
  defaultCharacterId: z.string().uuid().nullable(),
});
