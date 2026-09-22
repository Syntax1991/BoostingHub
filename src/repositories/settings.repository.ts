import { orm } from "@/lib/prisma";
import { asStringOrNull } from "@/lib/persistence";
import { DEFAULT_TIME_ZONE } from "@/lib/datetime";
import { normalizeTimeZone } from "@/lib/timezone";

export type NotificationDmPreferences = {
  discordDmEnabled: boolean;
  dmRosterSelectedEnabled: boolean;
  dmRaidInviteEnabled: boolean;
  dmRunCancelledEnabled: boolean;
  dmRunRescheduledEnabled: boolean;
  dmRosterRemovedEnabled: boolean;
};

export type RegionalPreferences = {
  timeZone: string;
};

export type GameplayPreferences = {
  defaultCharacterId: string | null;
};

export type UserSettingsRecord = {
  notifications: NotificationDmPreferences;
  regional: RegionalPreferences;
  gameplay: GameplayPreferences;
};

const DEFAULT_NOTIFICATIONS: NotificationDmPreferences = {
  discordDmEnabled: true,
  dmRosterSelectedEnabled: true,
  dmRaidInviteEnabled: true,
  dmRunCancelledEnabled: true,
  dmRunRescheduledEnabled: true,
  dmRosterRemovedEnabled: true,
};

function boolPref(value: unknown, fallback = true): boolean {
  return value === false ? false : value === true ? true : fallback;
}

function mapSettings(row: Record<string, unknown> | null): UserSettingsRecord {
  if (!row) {
    return {
      notifications: { ...DEFAULT_NOTIFICATIONS },
      regional: { timeZone: DEFAULT_TIME_ZONE },
      gameplay: { defaultCharacterId: null },
    };
  }
  return {
    notifications: {
      discordDmEnabled: boolPref(row.discordDmEnabled),
      dmRosterSelectedEnabled: boolPref(row.dmRosterSelectedEnabled),
      dmRaidInviteEnabled: boolPref(row.dmRaidInviteEnabled),
      dmRunCancelledEnabled: boolPref(row.dmRunCancelledEnabled),
      dmRunRescheduledEnabled: boolPref(row.dmRunRescheduledEnabled),
      dmRosterRemovedEnabled: boolPref(row.dmRosterRemovedEnabled),
    },
    regional: {
      timeZone: normalizeTimeZone(typeof row.timeZone === "string" ? row.timeZone : null),
    },
    gameplay: {
      defaultCharacterId: asStringOrNull(row.defaultCharacterId),
    },
  };
}

export const settingsRepository = {
  async getSettings(userId: string): Promise<UserSettingsRecord> {
    const row = await orm.User.where({ id: userId }).first();
    return mapSettings(row ? (row as Record<string, unknown>) : null);
  },

  async getNotificationDmPreferences(userId: string): Promise<NotificationDmPreferences> {
    const settings = await this.getSettings(userId);
    return settings.notifications;
  },

  async getTimeZone(userId: string): Promise<string> {
    const settings = await this.getSettings(userId);
    return settings.regional.timeZone;
  },

  async updateNotificationDmPreferences(
    userId: string,
    prefs: NotificationDmPreferences,
  ): Promise<void> {
    await orm.User.where({ id: userId }).update({
      discordDmEnabled: prefs.discordDmEnabled,
      dmRosterSelectedEnabled: prefs.dmRosterSelectedEnabled,
      dmRaidInviteEnabled: prefs.dmRaidInviteEnabled,
      dmRunCancelledEnabled: prefs.dmRunCancelledEnabled,
      dmRunRescheduledEnabled: prefs.dmRunRescheduledEnabled,
      dmRosterRemovedEnabled: prefs.dmRosterRemovedEnabled,
      updatedAt: new Date().toISOString(),
    });
  },

  async updateRegionalPreferences(userId: string, regional: RegionalPreferences): Promise<void> {
    await orm.User.where({ id: userId }).update({
      timeZone: regional.timeZone,
      updatedAt: new Date().toISOString(),
    });
  },

  async updateGameplayPreferences(userId: string, gameplay: GameplayPreferences): Promise<void> {
    await orm.User.where({ id: userId }).update({
      defaultCharacterId: gameplay.defaultCharacterId,
      updatedAt: new Date().toISOString(),
    });
  },

  /** Clears defaultCharacterId when it points at the given Character (e.g. deactivate). */
  async clearDefaultCharacterIfMatches(userId: string, characterId: string): Promise<void> {
    const settings = await this.getSettings(userId);
    if (settings.gameplay.defaultCharacterId !== characterId) return;
    await this.updateGameplayPreferences(userId, { defaultCharacterId: null });
  },
};
