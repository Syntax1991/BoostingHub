import { orm } from "@/lib/prisma";

export type NotificationDmPreferences = {
  dmRosterSelectedEnabled: boolean;
  dmRaidInviteEnabled: boolean;
};

export const settingsRepository = {
  async getNotificationDmPreferences(userId: string): Promise<NotificationDmPreferences> {
    const row = await orm.User.where({ id: userId }).first();
    if (!row) {
      return { dmRosterSelectedEnabled: true, dmRaidInviteEnabled: true };
    }
    const data = row as Record<string, unknown>;
    return {
      dmRosterSelectedEnabled: data.dmRosterSelectedEnabled !== false,
      dmRaidInviteEnabled: data.dmRaidInviteEnabled !== false,
    };
  },

  async updateNotificationDmPreferences(
    userId: string,
    prefs: NotificationDmPreferences,
  ): Promise<void> {
    await orm.User.where({ id: userId }).update({
      dmRosterSelectedEnabled: prefs.dmRosterSelectedEnabled,
      dmRaidInviteEnabled: prefs.dmRaidInviteEnabled,
      updatedAt: new Date().toISOString(),
    });
  },
};
