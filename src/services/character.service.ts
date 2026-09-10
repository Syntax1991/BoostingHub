import type { AuthenticatedUser } from "@/auth/authorization";
import type { WowClass, WowRegion } from "@/models/enums";
import { DomainError } from "@/lib/errors";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { defaultRaidBossTotal } from "@/lib/lockout-display";
import { getCurrentLockoutRaid, getCurrentLockoutRaids } from "@/lib/wow-raid-catalog";
import {
  isValidCharacterName,
  isValidRealmName,
  normalizeCharacterIdentity,
  prepareCharacterName,
  prepareRealmName,
} from "@/lib/character-identity";
import { resolveClassSpecialization } from "@/lib/wow-specializations";
import { activityRepository } from "@/repositories/activity.repository";
import { characterRepository } from "@/repositories/character.repository";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import { characterBlizzardImportService } from "@/services/character-blizzard-import.service";
import { lockoutService } from "@/services/lockout.service";

/**
 * Low-level, already-resolved creation input. Not reachable from any
 * controller — the public Add Character flow always resolves wowClass and
 * itemLevel from Blizzard first via addCharacterFromBlizzard below.
 */
export type CharacterWriteInput = {
  name: string;
  realm: string;
  region: WowRegion;
  wowClass: WowClass;
  specialization: string;
  itemLevel: number | null;
};

export type CharacterLookupInput = {
  name: string;
  realm: string;
  region: WowRegion;
};

export type CharacterCreateFromBlizzardInput = {
  name: string;
  realm: string;
  region: WowRegion;
  specialization: string;
};

function uniqueViolation(error: unknown): boolean {
  return error instanceof Error && /unique|duplicate|constraint/i.test(error.message);
}

function assertOwned(user: AuthenticatedUser, character: { userId: string }) {
  if (character.userId !== user.id) {
    throw new DomainError("CHARACTER_NOT_OWNED", "You can only manage your own characters.", 403);
  }
}

function prepareIdentity(input: { name: string; realm: string; region: WowRegion }) {
  const name = prepareCharacterName(input.name);
  const realm = prepareRealmName(input.realm);

  if (!isValidCharacterName(name)) {
    throw new DomainError(
      "INVALID_CHARACTER_NAME",
      "Enter a character name using letters only, 2 to 16 characters.",
    );
  }
  if (!isValidRealmName(realm)) {
    throw new DomainError("INVALID_REALM", "Enter a valid realm name.");
  }

  return {
    name,
    realm,
    region: input.region,
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity(realm),
  };
}

async function assertIdentityAvailable(input: {
  userId: string;
  region: WowRegion;
  normalizedName: string;
  normalizedRealm: string;
  excludeId?: string;
}) {
  const conflict = await characterRepository.findIdentityConflict(input);
  if (conflict) {
    throw new DomainError(
      "CHARACTER_ALREADY_EXISTS",
      "You already have a character with this name, realm, and region.",
    );
  }
}

function characterLabel(character: { name: string; realm: string; region: WowRegion }) {
  return `${character.name}-${character.realm} (${character.region})`;
}

export const characterService = {
  async getCharacterPage(user: AuthenticatedUser) {
    const characters = await characterRepository.listByUserId(user.id);
    const currentRaid = getCurrentLockoutRaid();
    const currentRaidIds = new Set(getCurrentLockoutRaids().map((raid) => raid.id));
    const bossTotal = defaultRaidBossTotal(currentRaid?.id);

    return {
      currentResetByRegion: {
        EU: getRegionalWeeklyReset("EU").resetIdentifier,
        US: getRegionalWeeklyReset("US").resetIdentifier,
      },
      currentLockoutRaid: currentRaid
        ? { id: currentRaid.id, name: currentRaid.name }
        : null,
      totalCharacters: characters.length,
      activeCharacters: characters.filter((character) => character.isActive).length,
      characters: characters.map((character) => {
        const access = boosterQualificationService.summarize(character.boosterQualifications);
        const currentReset = getRegionalWeeklyReset(character.region).resetIdentifier;
        const lockouts = lockoutService
          .summarize(
            character.lockouts.filter(
              (lockout) =>
                lockout.resetIdentifier === currentReset && currentRaidIds.has(lockout.raidId),
            ),
          )
          .map((lockout) => ({
            ...lockout,
            bossTotal,
            verified: true,
          }));

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
          updatedAt: character.updatedAt,
          blizzardLinked: Boolean(character.blizzardCharacterId),
          blizzardRealmId: character.blizzardRealmId,
          warcraftLogsLinked: Boolean(character.warcraftLogsId),
          boosterAccess: access,
          currentReset,
          lockouts,
        };
      }),
    };
  },

  async getCharacterDetails(user: AuthenticatedUser, characterId: string) {
    const character = await characterRepository.findById(characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    assertOwned(user, character);

    const currentReset = getRegionalWeeklyReset(character.region).resetIdentifier;
    const currentRaid = getCurrentLockoutRaid();
    const currentRaidIds = new Set(getCurrentLockoutRaids().map((raid) => raid.id));
    const bossTotal = defaultRaidBossTotal(currentRaid?.id);
    const currentLockouts = lockoutService
      .summarize(
        character.lockouts.filter(
          (lockout) =>
            lockout.resetIdentifier === currentReset && currentRaidIds.has(lockout.raidId),
        ),
      )
      .map((lockout) => ({
        ...lockout,
        bossTotal,
        verified: true,
      }));

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
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
      lastSyncedAt: character.lastSyncedAt,
      blizzardLinked: Boolean(character.blizzardCharacterId),
      blizzardCharacterId: character.blizzardCharacterId,
      blizzardRealmId: character.blizzardRealmId,
      warcraftLogsLinked: Boolean(character.warcraftLogsId),
      boosterQualifications: character.boosterQualifications,
      accessPanel: boosterQualificationService.buildAccountAccessPanel(
        character.boosterQualifications,
      ),
      currentReset,
      currentLockoutRaid: currentRaid
        ? { id: currentRaid.id, name: currentRaid.name }
        : null,
      lockouts: currentLockouts,
    };
  },

  async createCharacter(user: AuthenticatedUser, input: CharacterWriteInput) {
    const identity = prepareIdentity(input);
    const spec = resolveClassSpecialization(input.wowClass, input.specialization);
    await assertIdentityAvailable({
      userId: user.id,
      region: identity.region,
      normalizedName: identity.normalizedName,
      normalizedRealm: identity.normalizedRealm,
    });

    try {
      const created = await characterRepository.create({
        id: crypto.randomUUID(),
        userId: user.id,
        ...identity,
        wowClass: input.wowClass,
        specialization: spec.specialization,
        primaryRole: spec.primaryRole,
        itemLevel: input.itemLevel,
        isActive: true,
      });

      await activityRepository.create({
        userId: user.id,
        type: "CHARACTER_CREATED",
        message: `Added character ${characterLabel(created)}.`,
      });

      return created;
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new DomainError(
          "CHARACTER_ALREADY_EXISTS",
          "You already have a character with this name, realm, and region.",
        );
      }
      throw error;
    }
  },

  /**
   * Read-only Blizzard preview for the Add Character lookup step. Does not
   * touch the database and proves nothing about account ownership — it is a
   * public Character Profile read, not the authenticated Battle.net import.
   */
  async previewCharacterFromBlizzard(input: CharacterLookupInput) {
    const identity = prepareIdentity(input);
    return characterBlizzardImportService.lookupPublicCharacterProfile(
      identity.name,
      identity.realm,
      identity.region,
    );
  },

  /**
   * Public Add Character entry point. The caller only identifies which
   * character to look up plus the BoostingHub-owned specialization; wowClass
   * and itemLevel are re-resolved from Blizzard here, never trusted from the
   * request, so a stale/forged client payload cannot persist a fake class or
   * item level.
   */
  async addCharacterFromBlizzard(user: AuthenticatedUser, input: CharacterCreateFromBlizzardInput) {
    const identity = prepareIdentity(input);
    const resolved = await characterBlizzardImportService.lookupPublicCharacterProfile(
      identity.name,
      identity.realm,
      identity.region,
    );

    return this.createCharacter(user, {
      name: input.name,
      realm: input.realm,
      region: input.region,
      wowClass: resolved.wowClass,
      specialization: input.specialization,
      itemLevel: resolved.itemLevel,
    });
  },

  async updateCharacter(
    user: AuthenticatedUser,
    characterId: string,
    input: Omit<CharacterWriteInput, "wowClass" | "itemLevel">,
  ) {
    const character = await characterRepository.findById(characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    assertOwned(user, character);

    const identity = prepareIdentity({ ...input, region: input.region });
    const spec = resolveClassSpecialization(character.wowClass, input.specialization);
    // wowClass is taken from the stored row, not the write payload, so class
    // stays immutable even if a client forges a class field. Item level is
    // Blizzard-authoritative and is never part of an edit.
    await assertIdentityAvailable({
      userId: user.id,
      region: identity.region,
      normalizedName: identity.normalizedName,
      normalizedRealm: identity.normalizedRealm,
      excludeId: character.id,
    });

    try {
      await characterRepository.update(character.id, {
        ...identity,
        specialization: spec.specialization,
        primaryRole: spec.primaryRole,
      });
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new DomainError(
          "CHARACTER_ALREADY_EXISTS",
          "You already have a character with this name, realm, and region.",
        );
      }
      throw error;
    }

    await activityRepository.create({
      userId: user.id,
      type: "CHARACTER_UPDATED",
      message: `Updated character ${identity.name}-${identity.realm} (${identity.region}).`,
    });

    const updated = await characterRepository.findById(character.id);
    if (!updated) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    return updated;
  },

  async deactivateCharacter(user: AuthenticatedUser, characterId: string) {
    const character = await characterRepository.findById(characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    assertOwned(user, character);

    await characterRepository.setActive(character.id, false);
    await activityRepository.create({
      userId: user.id,
      type: "CHARACTER_DEACTIVATED",
      message: `Deactivated character ${characterLabel(character)}.`,
    });
  },

  async reactivateCharacter(user: AuthenticatedUser, characterId: string) {
    const character = await characterRepository.findById(characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    assertOwned(user, character);

    await characterRepository.setActive(character.id, true);
    await activityRepository.create({
      userId: user.id,
      type: "CHARACTER_REACTIVATED",
      message: `Reactivated character ${characterLabel(character)}.`,
    });
  },
};
