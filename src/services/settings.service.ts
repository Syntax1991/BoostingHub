import type { AuthenticatedUser } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { characterRepository } from "@/repositories/character.repository";
import {
  settingsRepository,
  type GameplayPreferences,
  type NotificationDmPreferences,
  type RegionalPreferences,
  type UserSettingsRecord,
} from "@/repositories/settings.repository";
import { isValidIanaTimeZone, listIanaTimeZones } from "@/lib/timezone";

export type SettingsDto = UserSettingsRecord & {
  /** Active owned characters for the Default Character selector. */
  characters: Array<{ id: string; name: string; realm: string; isActive: boolean }>;
  /** IANA zones for the timezone selector. */
  timeZones: string[];
};

export type { NotificationDmPreferences, RegionalPreferences, GameplayPreferences };

/**
 * User-owned application preferences and account security controls (sessions).
 * Distinct from Profile (identity / operational account data).
 * Only the authenticated owner may read/update.
 */
export const settingsService = {
  async getSettings(user: AuthenticatedUser): Promise<SettingsDto> {
    const [settings, characters] = await Promise.all([
      settingsRepository.getSettings(user.id),
      characterRepository.listByUserId(user.id),
    ]);
    const active = characters
      .filter((character) => character.isActive)
      .map((character) => ({
        id: character.id,
        name: character.name,
        realm: character.realm,
        isActive: character.isActive,
      }));

    // Drop stale default if the Character is gone / inactive without blocking the page.
    let gameplay = settings.gameplay;
    if (gameplay.defaultCharacterId) {
      const stillValid = active.some((character) => character.id === gameplay.defaultCharacterId);
      if (!stillValid) {
        gameplay = { defaultCharacterId: null };
      }
    }

    return {
      notifications: settings.notifications,
      regional: settings.regional,
      gameplay,
      characters: active,
      timeZones: listIanaTimeZones(),
    };
  },

  async updateNotificationDmPreferences(
    user: AuthenticatedUser,
    prefs: NotificationDmPreferences,
  ): Promise<SettingsDto> {
    await settingsRepository.updateNotificationDmPreferences(user.id, prefs);
    return this.getSettings(user);
  },

  async updateRegionalPreferences(
    user: AuthenticatedUser,
    regional: RegionalPreferences,
  ): Promise<SettingsDto> {
    if (!isValidIanaTimeZone(regional.timeZone)) {
      throw new DomainError("VALIDATION_FAILED", "Choose a valid IANA timezone.", 400);
    }
    await settingsRepository.updateRegionalPreferences(user.id, {
      timeZone: regional.timeZone.trim(),
    });
    return this.getSettings(user);
  },

  async updateGameplayPreferences(
    user: AuthenticatedUser,
    gameplay: GameplayPreferences,
  ): Promise<SettingsDto> {
    if (gameplay.defaultCharacterId == null) {
      await settingsRepository.updateGameplayPreferences(user.id, { defaultCharacterId: null });
      return this.getSettings(user);
    }

    const character = await characterRepository.findById(gameplay.defaultCharacterId);
    if (!character || character.userId !== user.id) {
      throw new DomainError("CHARACTER_NOT_OWNED", "That character does not belong to you.", 403);
    }
    if (!character.isActive) {
      throw new DomainError(
        "CHARACTER_INACTIVE",
        "Only an active character can be set as the default.",
        400,
      );
    }

    await settingsRepository.updateGameplayPreferences(user.id, {
      defaultCharacterId: character.id,
    });
    return this.getSettings(user);
  },
};
