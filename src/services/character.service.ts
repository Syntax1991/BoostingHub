import type { AuthenticatedUser } from "@/auth/authorization";
import { characterRepository } from "@/repositories/character.repository";
import { boosterAccessService } from "@/services/booster-access.service";
import { lockoutService } from "@/services/lockout.service";
import { resetIdentifierFor } from "@/lib/datetime";

export const characterService = {
  async getCharacterPage(user: AuthenticatedUser) {
    const characters = await characterRepository.listByUserId(user.id);
    const currentReset = resetIdentifierFor();

    return {
      currentReset,
      characters: characters.map((character) => {
        const access = boosterAccessService.summarize(character.boosterAccess);
        const lockouts = lockoutService.summarize(
          character.lockouts.filter((lockout) => lockout.resetIdentifier === currentReset),
        );

        return {
          id: character.id,
          name: character.name,
          realm: character.realm,
          region: character.region,
          wowClass: character.wowClass,
          specialization: character.specialization,
          primaryRole: character.primaryRole,
          itemLevel: character.itemLevel,
          isActive: character.isActive,
          lastSyncedAt: character.lastSyncedAt,
          blizzardLinked: Boolean(character.blizzardCharacterId),
          warcraftLogsLinked: Boolean(character.warcraftLogsId),
          boosterAccess: access,
          lockouts,
        };
      }),
    };
  },
};
