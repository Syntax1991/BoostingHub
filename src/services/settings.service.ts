import type { AuthenticatedUser } from "@/auth/authorization";
import {
  settingsRepository,
  type NotificationDmPreferences,
} from "@/repositories/settings.repository";

export type SettingsDto = {
  notifications: NotificationDmPreferences;
};

export type { NotificationDmPreferences };

/**
 * User-owned application preferences. Distinct from Profile (identity /
 * operational account data). Only the authenticated owner may read/update.
 */
export const settingsService = {
  async getSettings(user: AuthenticatedUser): Promise<SettingsDto> {
    const notifications = await settingsRepository.getNotificationDmPreferences(user.id);
    return { notifications };
  },

  async updateNotificationDmPreferences(
    user: AuthenticatedUser,
    prefs: NotificationDmPreferences,
  ): Promise<SettingsDto> {
    await settingsRepository.updateNotificationDmPreferences(user.id, {
      dmRosterSelectedEnabled: prefs.dmRosterSelectedEnabled,
      dmRaidInviteEnabled: prefs.dmRaidInviteEnabled,
    });
    return this.getSettings(user);
  },
};
