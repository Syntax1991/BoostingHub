import type { AuthenticatedUser } from "@/auth/authorization";
import type { WowClass, WowRegion } from "@/models/enums";
import { DomainError, isDomainError } from "@/lib/errors";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { defaultRaidBossTotal } from "@/lib/lockout-display";
import { getCurrentLockoutRaids, raidContentDisplayName } from "@/lib/wow-raid-catalog";
import {
  isValidCharacterName,
  isValidRealmName,
  normalizeCharacterIdentity,
  prepareCharacterName,
  prepareRealmName,
} from "@/lib/character-identity";
import { normalizePlayableSpecs } from "@/lib/character-capabilities";
import { resolveClassSpecialization } from "@/lib/wow-specializations";
import { parseRaiderIoCharacterUrl } from "@/lib/raiderio-character-url";
import { recordRaiderIoParseResult } from "@/lib/integration-provider-events";
import {
  mapWithConcurrency,
  RAIDER_IO_BULK_MAX,
  RAIDER_IO_LOOKUP_CONCURRENCY,
} from "@/lib/map-with-concurrency";
import { activityRepository } from "@/repositories/activity.repository";
import { characterRepository } from "@/repositories/character.repository";
import { settingsRepository } from "@/repositories/settings.repository";
import { getDiscordBoosterTicketUrl } from "@/lib/discord-config";
import { userRepository } from "@/repositories/user.repository";
import { characterScheduleCommitmentsService } from "@/services/character-schedule-commitments.service";
import { characterWeeklyAvailabilityService } from "@/services/character-weekly-availability.service";
import { characterWarcraftLogsService } from "@/services/character-warcraft-logs.service";
import { characterBlizzardImportService } from "@/services/character-blizzard-import.service";
import { lockoutService } from "@/services/lockout.service";
import { deriveBlizzardSyncState } from "@/lib/blizzard/sync-state";
import { resolveSyncHealthStaleMinutes } from "@/lib/blizzard/sync-health";

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
  /** Additional playable specs excluding primary. */
  playableSpecs?: readonly string[];
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
  playableSpecs?: readonly string[];
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

/** Characters-page sync state (never synced / failing / fine), derived from lastSyncedAt — see sync-state.ts. */
function blizzardSyncStateFor(character: {
  isActive: boolean;
  lastSyncedAt: string | null;
  lastSyncAttemptAt: string | null;
  createdAt: string;
}) {
  // A misconfigured env fails the scheduler loudly; the page just uses the default.
  const staleMinutes = resolveSyncHealthStaleMinutes();
  return deriveBlizzardSyncState(
    {
      isActive: character.isActive,
      lastSyncedAt: character.lastSyncedAt,
      lastSyncAttemptAt: character.lastSyncAttemptAt,
      createdAt: character.createdAt,
    },
    { now: new Date(), staleMinutes },
  );
}

function characterLabel(character: { name: string; realm: string; region: WowRegion }) {
  return `${character.name}-${character.realm} (${character.region})`;
}

export const characterService = {
  async getCharacterPage(user: AuthenticatedUser) {
    const [characters, boostingRoles] = await Promise.all([
      characterRepository.listByUserId(user.id),
      userRepository.findBoostingRoles(user.id),
    ]);
    const currentRaids = getCurrentLockoutRaids();
    const currentRaidIds = new Set(currentRaids.map((raid) => raid.id));
    const weeklyAvailabilityById = await characterWeeklyAvailabilityService.projectCurrentForCharacters(
      characters,
    );

    return {
      currentResetByRegion: {
        EU: getRegionalWeeklyReset("EU").resetIdentifier,
        US: getRegionalWeeklyReset("US").resetIdentifier,
      },
      currentLockoutRaids: currentRaids.map((raid) => ({
        id: raid.id,
        name: raidContentDisplayName(raid.id, raid.name),
      })),
      /** Account-level Boosting Roles — shown once for the account, not per Character. */
      boostingRoles: boostingRoles ?? { isBooster: false, isLootbuddy: false },
      discordTicketUrl: getDiscordBoosterTicketUrl(),
      totalCharacters: characters.length,
      activeCharacters: characters.filter((character) => character.isActive).length,
      characters: characters.map((character) => {
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
            raidName: raidContentDisplayName(lockout.raidId, lockout.raidName),
            bossTotal: defaultRaidBossTotal(lockout.raidId),
            verified: true,
          }));

        return {
          id: character.id,
          name: character.name,
          realm: character.realm,
          region: character.region,
          wowClass: character.wowClass,
          specialization: character.specialization,
          playableSpecs: character.playableSpecs,
          primaryRole: character.primaryRole,
          itemLevel: character.itemLevel,
          isActive: character.isActive,
          lastSyncedAt: character.lastSyncedAt,
          blizzardSyncState: blizzardSyncStateFor(character),
          updatedAt: character.updatedAt,
          blizzardLinked: Boolean(character.blizzardCharacterId),
          blizzardRealmId: character.blizzardRealmId,
          warcraftLogsLinked: Boolean(character.warcraftLogsId),
          warcraftLogsId: character.warcraftLogsId,
          currentReset,
          lockouts,
          weeklyAvailability: weeklyAvailabilityById.get(character.id) ?? {
            characterId: character.id,
            status: "AVAILABLE" as const,
            unavailableDifficulties: [],
            resetIdentifier: currentReset,
            region: character.region,
            resetWindowLabel: `${character.region} · ${currentReset}`,
          },
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
    const currentRaids = getCurrentLockoutRaids();
    const currentRaidIds = new Set(currentRaids.map((raid) => raid.id));
    const currentLockouts = lockoutService
      .summarize(
        character.lockouts.filter(
          (lockout) =>
            lockout.resetIdentifier === currentReset && currentRaidIds.has(lockout.raidId),
        ),
      )
      .map((lockout) => ({
        ...lockout,
        raidName: raidContentDisplayName(lockout.raidId, lockout.raidName),
        bossTotal: defaultRaidBossTotal(lockout.raidId),
        verified: true,
      }));

    const weeklyAvailability = await characterWeeklyAvailabilityService.getCurrentForOwner(
      user,
      characterId,
    );

    return {
      id: character.id,
      name: character.name,
      realm: character.realm,
      region: character.region,
      wowClass: character.wowClass,
      specialization: character.specialization,
      primaryRole: character.primaryRole,
      playableSpecs: character.playableSpecs,
      itemLevel: character.itemLevel,
      isActive: character.isActive,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
      lastSyncedAt: character.lastSyncedAt,
      blizzardSyncState: blizzardSyncStateFor(character),
      blizzardLinked: Boolean(character.blizzardCharacterId),
      blizzardCharacterId: character.blizzardCharacterId,
      blizzardRealmId: character.blizzardRealmId,
      warcraftLogsLinked: Boolean(character.warcraftLogsId),
      warcraftLogsId: character.warcraftLogsId,
      /** The owner's account-level Booster role — explains Booster signup eligibility. */
      ownerIsBooster: character.ownerIsBooster,
      discordTicketUrl: getDiscordBoosterTicketUrl(),
      currentReset,
      currentLockoutRaids: currentRaids.map((raid) => ({
        id: raid.id,
        name: raidContentDisplayName(raid.id, raid.name),
      })),
      lockouts: currentLockouts,
      weeklyAvailability,
      scheduleCommitments: await characterScheduleCommitmentsService.listForOwner(user, characterId),
    };
  },

  async createCharacter(user: AuthenticatedUser, input: CharacterWriteInput) {
    const identity = prepareIdentity(input);
    const spec = resolveClassSpecialization(input.wowClass, input.specialization);
    const playableSpecs = normalizePlayableSpecs({
      wowClass: input.wowClass,
      primarySpecialization: spec.specialization,
      playableSpecs: input.playableSpecs ?? [],
    });
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
        playableSpecs,
        itemLevel: input.itemLevel,
        isActive: true,
      });

      // Best-effort WCL identity enrichment — never rolls back Character create.
      await characterWarcraftLogsService.tryAutoLinkIfMissing(created.id);

      await activityRepository.create({
        userId: user.id,
        type: "CHARACTER_CREATED",
        message: `Added character ${characterLabel(created)}.`,
      });

      return (await characterRepository.findById(created.id)) ?? created;
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
   * Read-only Blizzard preview for tests and internal callers. Does not
   * touch the database — public Character Profile read only.
   */
  async previewCharacterFromBlizzard(input: CharacterLookupInput) {
    const identity = prepareIdentity(input);
    const preview = await characterBlizzardImportService.lookupPublicCharacterProfile(
      identity.name,
      identity.realm,
      identity.region,
    );
    return { wowClass: preview.wowClass, itemLevel: preview.itemLevel };
  },

  /**
   * Raider.IO Character profile URL → Blizzard public profile preview.
   * Parses the URL only (no Raider.IO fetch/API). Canonical Name/Realm come
   * from Blizzard's Character Profile Summary — never from the URL slug.
   * When `user` is supplied, reports whether the account already owns the
   * canonical identity (advisory; final create still re-checks).
   */
  async previewCharacterFromRaiderIoUrl(url: string, user?: AuthenticatedUser) {
    const parsed = parseRaiderIoCharacterUrl(url);
    void recordRaiderIoParseResult(parsed);
    if (!parsed.ok) {
      throw new DomainError("VALIDATION_FAILED", parsed.error.message);
    }

    // Same WoW Character name contract as manual Add Character — reject before
    // any Blizzard call. Do not lowercase; diacritics stay intact (Éowyn).
    const name = prepareCharacterName(parsed.value.characterName);
    if (!isValidCharacterName(name)) {
      throw new DomainError(
        "INVALID_CHARACTER_NAME",
        "Enter a character name using letters only, 2 to 16 characters.",
      );
    }

    const preview = await characterBlizzardImportService.lookupPublicCharacterProfile(
      name,
      parsed.value.realmSlug,
      parsed.value.region,
      { realmSlug: parsed.value.realmSlug },
    );

    const canonicalName = prepareCharacterName(preview.name);
    const canonicalRealm = prepareRealmName(preview.realm);
    let alreadyOwned = false;
    if (user) {
      const conflict = await characterRepository.findIdentityConflict({
        userId: user.id,
        region: parsed.value.region,
        normalizedName: normalizeCharacterIdentity(canonicalName),
        normalizedRealm: normalizeCharacterIdentity(canonicalRealm),
      });
      alreadyOwned = Boolean(conflict);
    }

    return {
      name: preview.name,
      realm: preview.realm,
      region: parsed.value.region,
      wowClass: preview.wowClass,
      itemLevel: preview.itemLevel,
      alreadyOwned,
    };
  },

  /**
   * Bulk Raider.IO → Blizzard preview. Server enforces 1–10 URLs and looks
   * them up with bounded concurrency. Per-URL failures do not abort siblings.
   */
  async previewCharactersFromRaiderIoUrls(user: AuthenticatedUser, urls: readonly string[]) {
    if (urls.length < 1 || urls.length > RAIDER_IO_BULK_MAX) {
      throw new DomainError(
        "VALIDATION_FAILED",
        `Enter between 1 and ${RAIDER_IO_BULK_MAX} Raider.IO character profile links.`,
      );
    }

    return mapWithConcurrency(urls, RAIDER_IO_LOOKUP_CONCURRENCY, async (url) => {
      try {
        const data = await this.previewCharacterFromRaiderIoUrl(url, user);
        return { ok: true as const, url, data };
      } catch (error) {
        if (isDomainError(error)) {
          return {
            ok: false as const,
            url,
            code: error.code,
            message: error.message,
          };
        }
        return {
          ok: false as const,
          url,
          code: "UNEXPECTED",
          message: "Something went wrong looking up this character.",
        };
      }
    });
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
      playableSpecs: input.playableSpecs ?? [],
      itemLevel: resolved.itemLevel,
    });
  },

  /**
   * Bulk Add Character. Each item re-resolves Blizzard independently via
   * addCharacterFromBlizzard. Server enforces 1–10. In-batch duplicate
   * identities fail without creating; other rows continue (partial success).
   */
  async addCharactersFromBlizzard(
    user: AuthenticatedUser,
    items: ReadonlyArray<CharacterCreateFromBlizzardInput & { clientId: string }>,
  ) {
    if (items.length < 1 || items.length > RAIDER_IO_BULK_MAX) {
      throw new DomainError(
        "VALIDATION_FAILED",
        `Add between 1 and ${RAIDER_IO_BULK_MAX} characters at once.`,
      );
    }

    const seen = new Map<string, string>();
    const results: Array<
      | { clientId: string; ok: true }
      | { clientId: string; ok: false; code: string; message: string }
    > = [];

    for (const item of items) {
      let identityKey: string;
      try {
        const identity = prepareIdentity(item);
        identityKey = `${identity.region}|${identity.normalizedRealm}|${identity.normalizedName}`;
      } catch (error) {
        if (isDomainError(error)) {
          results.push({
            clientId: item.clientId,
            ok: false,
            code: error.code,
            message: error.message,
          });
          continue;
        }
        results.push({
          clientId: item.clientId,
          ok: false,
          code: "UNEXPECTED",
          message: "Something went wrong adding this character.",
        });
        continue;
      }

      if (seen.has(identityKey)) {
        results.push({
          clientId: item.clientId,
          ok: false,
          code: "CHARACTER_ALREADY_IN_BATCH",
          message: "This character is already included in this batch.",
        });
        continue;
      }
      seen.set(identityKey, item.clientId);

      try {
        await this.addCharacterFromBlizzard(user, item);
        results.push({ clientId: item.clientId, ok: true });
      } catch (error) {
        if (isDomainError(error)) {
          results.push({
            clientId: item.clientId,
            ok: false,
            code: error.code,
            message: error.message,
          });
        } else {
          results.push({
            clientId: item.clientId,
            ok: false,
            code: "UNEXPECTED",
            message: "Something went wrong adding this character.",
          });
        }
      }
    }

    return results;
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
    const playableSpecs = normalizePlayableSpecs({
      wowClass: character.wowClass,
      primarySpecialization: spec.specialization,
      playableSpecs: input.playableSpecs ?? [],
    });
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
        playableSpecs,
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
    await settingsRepository.clearDefaultCharacterIfMatches(user.id, character.id);
    await activityRepository.create({
      userId: user.id,
      type: "CHARACTER_DEACTIVATED",
      message: `Deactivated character ${characterLabel(character)}.`,
    });
  },

  /**
   * Owner hard delete. Refused while an unfinished Run still has a
   * non-withdrawn signup on it (see characterRepository.deleteGuarded).
   * A later Battle.net import of the same character simply imports it again.
   */
  async deleteCharacter(user: AuthenticatedUser, characterId: string) {
    const character = await characterRepository.findById(characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    assertOwned(user, character);

    await characterRepository.deleteGuarded(character.id);
    await activityRepository.create({
      userId: user.id,
      type: "CHARACTER_DELETED",
      message: `Deleted character ${characterLabel(character)}.`,
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
