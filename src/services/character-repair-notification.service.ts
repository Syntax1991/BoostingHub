import { needsBattleNetIdentityRepair } from "@/lib/blizzard/sync-state";
import { isDomainError } from "@/lib/errors";
import { characterRepository } from "@/repositories/character.repository";
import { settingsRepository } from "@/repositories/settings.repository";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { userRepository } from "@/repositories/user.repository";
import { characterBattleNetRepairWebNotification, resolveDiscordDelivery } from "@/services/notification-content";

const SOURCE_KEY_PREFIX = "character-battlenet-repair:";

/**
 * One notification per broken Blizzard identity: keyed by the Character AND
 * the Blizzard id it was linked to, so every further failed sync of the same
 * identity is a duplicate, while a later break of the repaired identity
 * (new id) notifies again.
 */
export function characterBattleNetRepairSourceKey(characterId: string, blizzardCharacterId: string): string {
  return `${SOURCE_KEY_PREFIX}${characterId}:${blizzardCharacterId}`;
}

export function parseCharacterIdFromBattleNetRepairSourceKey(sourceKey: string): string | null {
  if (!sourceKey.startsWith(SOURCE_KEY_PREFIX)) return null;
  const characterId = sourceKey.slice(SOURCE_KEY_PREFIX.length).split(":")[0]?.trim();
  return characterId || null;
}

/**
 * The Character behind a CHARACTER_BATTLENET_REPAIR notification while it
 * still needs the reconnect; null once repaired, deleted or recovered (the
 * DM is then no longer worth sending).
 */
export async function findCharacterStillNeedingBattleNetRepair(sourceKey: string) {
  const characterId = parseCharacterIdFromBattleNetRepairSourceKey(sourceKey);
  if (!characterId) return null;
  const character = await characterRepository.findById(characterId);
  return character && needsBattleNetIdentityRepair(character) ? character : null;
}

export const characterRepairNotificationService = {
  /**
   * After a failed Blizzard sync: tells the owner once (bell + Discord DM,
   * following their global DM switch and Quiet Hours) that reconnecting
   * Battle.net repairs this Character. No-op when the failure does not call
   * for a reconnect or the owner was already told about this identity.
   * Best-effort — never throws into the sync.
   */
  async notifyOwnerIfRepairNeeded(characterId: string): Promise<boolean> {
    try {
      const character = await characterRepository.findById(characterId);
      if (!character?.blizzardCharacterId || !needsBattleNetIdentityRepair(character)) return false;

      const [owner, settings] = await Promise.all([
        userRepository.findAuthenticatedById(character.userId),
        settingsRepository.getSettings(character.userId),
      ]);
      const copy = characterBattleNetRepairWebNotification({
        characterId: character.id,
        characterLabel: `${character.name}-${character.realm} (${character.region})`,
      });
      const delivery = resolveDiscordDelivery({
        discordDmEnabled: settings.notifications.discordDmEnabled,
        // Account maintenance, not a Run event: only the global DM switch applies.
        eventDmEnabled: true,
        discordUserId: owner?.discordUserId,
        quietHours: settings.notifications.quietHours,
        timeZone: settings.regional.timeZone,
      });
      const created = await userNotificationRepository.createIgnoreDuplicate({
        userId: character.userId,
        type: "CHARACTER_BATTLENET_REPAIR",
        runId: null,
        signupId: null,
        sourceKey: characterBattleNetRepairSourceKey(character.id, character.blizzardCharacterId),
        title: copy.title,
        message: copy.message,
        href: copy.href,
        discordDeliveryStatus: delivery.status,
        discordUserId: delivery.discordUserId,
        discordDeliverAfter: delivery.discordDeliverAfter,
      });
      return created !== null;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "character_battlenet_repair_notification_failed",
          errorCode: isDomainError(error) ? error.code : error instanceof Error ? error.name : "UNKNOWN",
        }),
      );
      return false;
    }
  },
};
