import type { AuthenticatedUser } from "@/auth/authorization";
import { hasRaidLeadAccess } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { characterRepository } from "@/repositories/character.repository";
import {
  settingsRepository,
  type GameplayPreferences,
  type NotificationDmPreferences,
  type RegionalPreferences,
  type RunChannelPreferences,
  type UserSettingsRecord,
} from "@/repositories/settings.repository";
import {
  DISCORD_RUN_CHANNEL_NICKNAME_MAX_LENGTH,
  slugDiscordChannelSegment,
} from "@/lib/discord-channel-name";
import { isValidIanaTimeZone, listIanaTimeZones } from "@/lib/timezone";
import { updateDmPreferencesSchema } from "@/validators/notification";

export type SettingsDto = Omit<UserSettingsRecord, "runChannels"> & {
  runChannels: RunChannelPreferences & { canConfigure: boolean };
  /** Active owned characters for the Default Character selector. */
  characters: Array<{ id: string; name: string; realm: string; isActive: boolean }>;
  /** IANA zones for the timezone selector. */
  timeZones: string[];
};

export type { NotificationDmPreferences, RegionalPreferences, GameplayPreferences, RunChannelPreferences };

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

    const canConfigureRunChannels = hasRaidLeadAccess(user.accountRole);

    return {
      notifications: settings.notifications,
      regional: settings.regional,
      gameplay,
      runChannels: {
        canConfigure: canConfigureRunChannels,
        discordRunChannelNickname: canConfigureRunChannels
          ? settings.runChannels.discordRunChannelNickname
          : null,
      },
      characters: active,
      timeZones: listIanaTimeZones(),
    };
  },

  async updateNotificationDmPreferences(
    user: AuthenticatedUser,
    prefs: NotificationDmPreferences,
  ): Promise<SettingsDto> {
    const parsed = updateDmPreferencesSchema.safeParse(prefs);
    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message ?? "Invalid notification preferences.";
      throw new DomainError("VALIDATION_FAILED", message, 400);
    }
    await settingsRepository.updateNotificationDmPreferences(user.id, parsed.data);
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

  async updateRunChannelPreferences(
    user: AuthenticatedUser,
    prefs: { discordRunChannelNickname: string | null },
  ): Promise<SettingsDto> {
    if (!hasRaidLeadAccess(user.accountRole)) {
      throw new DomainError(
        "NOT_AUTHORIZED",
        "Only raid leads and admins can configure Run channel nicknames.",
        403,
      );
    }

    const normalized = normalizeRunChannelNickname(prefs.discordRunChannelNickname);
    await settingsRepository.updateRunChannelPreferences(user.id, {
      discordRunChannelNickname: normalized,
    });
    return this.getSettings(user);
  },
};

/** Trim → null when empty; enforce max length and non-empty channel slug. */
export function normalizeRunChannelNickname(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > DISCORD_RUN_CHANNEL_NICKNAME_MAX_LENGTH) {
    throw new DomainError(
      "VALIDATION_FAILED",
      `Run channel nickname must be at most ${DISCORD_RUN_CHANNEL_NICKNAME_MAX_LENGTH} characters.`,
      400,
    );
  }
  const slug = slugDiscordChannelSegment(trimmed);
  if (!slug) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Run channel nickname must include at least one letter or number.",
      400,
    );
  }
  return trimmed;
}
