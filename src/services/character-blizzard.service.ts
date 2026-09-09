import type { AuthenticatedUser } from "@/auth/authorization";
import { DomainError, isDomainError } from "@/lib/errors";
import {
  isValidCharacterName,
  isValidRealmName,
  normalizeCharacterIdentity,
  prepareCharacterName,
  prepareRealmName,
} from "@/lib/character-identity";
import type {
  ImportCandidate,
  ImportCharacterSelection,
  OwnedBlizzardCharacter,
} from "@/lib/blizzard/types";
import { blizzardApiClient } from "@/integrations/blizzard/blizzard-api-client";
import { findSpecialization } from "@/lib/wow-specializations";
import type { CharacterRole, WowClass } from "@/models/enums";
import { activityRepository } from "@/repositories/activity.repository";
import { battleNetConnectionRepository } from "@/repositories/battle-net-connection.repository";
import { characterRepository } from "@/repositories/character.repository";
import { battleNetService } from "@/services/battle-net.service";

const REFRESH_COOLDOWN_MS = 60_000;

function uniqueViolation(error: unknown): boolean {
  return error instanceof Error && /unique|duplicate|constraint/i.test(error.message);
}

function assertOwned(user: AuthenticatedUser, character: { userId: string }) {
  if (character.userId !== user.id) {
    throw new DomainError("CHARACTER_NOT_OWNED", "You can only manage your own characters.", 403);
  }
}

function realmSlugFromDisplayName(realm: string): string {
  return realm.toLocaleLowerCase("en-US").trim().replace(/\s+/g, "-");
}

function resolveClassSpecialization(
  wowClass: WowClass,
  specialization: string,
): { specialization: string; primaryRole: CharacterRole } {
  const match = findSpecialization(wowClass, specialization);
  if (!match) {
    throw new DomainError(
      "INVALID_CLASS_SPECIALIZATION",
      "That specialization is not valid for the selected class.",
    );
  }
  return { specialization: match.name, primaryRole: match.role };
}

function prepareImportedIdentity(owned: OwnedBlizzardCharacter) {
  const name = prepareCharacterName(owned.name);
  const realm = prepareRealmName(owned.realmName);

  if (!isValidCharacterName(name)) {
    throw new DomainError(
      "INVALID_CHARACTER_NAME",
      `Blizzard character name "${owned.name}" is not usable in BoostingHub.`,
    );
  }
  if (!isValidRealmName(realm)) {
    throw new DomainError("INVALID_REALM", `Blizzard realm "${owned.realmName}" is not usable.`);
  }

  return {
    name,
    realm,
    region: owned.region,
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity(realm),
  };
}

async function requireLiveImportSession(user: AuthenticatedUser, sessionId: string) {
  return battleNetService.getImportSession(user, sessionId);
}

function findOwnedInSession(
  characters: OwnedBlizzardCharacter[],
  blizzardCharacterId: string,
): OwnedBlizzardCharacter {
  const owned = characters.find((character) => character.id === blizzardCharacterId);
  if (!owned) {
    throw new DomainError(
      "BLIZZARD_CHARACTER_NOT_OWNED",
      "That Blizzard character is not in this import session.",
      403,
    );
  }
  return owned;
}

async function enrichProfileBestEffort(owned: OwnedBlizzardCharacter): Promise<{
  itemLevel: number | null;
  specialization: string | null;
  synced: boolean;
}> {
  try {
    const status = await blizzardApiClient.getCharacterProfileStatus(
      owned.region,
      owned.realmSlug,
      owned.name,
    );
    if (!status.isValid) {
      return { itemLevel: null, specialization: null, synced: false };
    }

    const summary = await blizzardApiClient.getCharacterProfileSummary(
      owned.region,
      owned.realmSlug,
      owned.name,
    );

    return {
      itemLevel: summary.equippedItemLevel,
      specialization: summary.activeSpecialization,
      synced: typeof summary.equippedItemLevel === "number",
    };
  } catch (error) {
    if (isDomainError(error) && error.code === "BATTLENET_NOT_CONFIGURED") {
      throw error;
    }
    return { itemLevel: null, specialization: null, synced: false };
  }
}

async function resolveCandidate(
  user: AuthenticatedUser,
  owned: OwnedBlizzardCharacter,
): Promise<ImportCandidate> {
  const identity = prepareImportedIdentity(owned);
  const byBlizzard = await characterRepository.findByBlizzardIdentity(
    owned.region,
    owned.realmId,
    owned.id,
  );

  if (byBlizzard) {
    if (byBlizzard.userId !== user.id) {
      return {
        blizzardCharacterId: owned.id,
        name: identity.name,
        realm: identity.realm,
        realmSlug: owned.realmSlug,
        realmId: owned.realmId,
        region: owned.region,
        wowClass: owned.wowClass,
        level: owned.level,
        status: "conflict",
        characterId: null,
        conflictReason: "This Blizzard character is already linked to another BoostingHub account.",
        suggestedSpecialization: null,
        suggestedItemLevel: null,
      };
    }

    return {
      blizzardCharacterId: owned.id,
      name: identity.name,
      realm: identity.realm,
      realmSlug: owned.realmSlug,
      realmId: owned.realmId,
      region: owned.region,
      wowClass: owned.wowClass,
      level: owned.level,
      status: "already_linked",
      characterId: byBlizzard.id,
      conflictReason: null,
      suggestedSpecialization: null,
      suggestedItemLevel: null,
    };
  }

  const byName = await characterRepository.findIdentityConflict({
    userId: user.id,
    region: identity.region,
    normalizedName: identity.normalizedName,
    normalizedRealm: identity.normalizedRealm,
  });

  if (byName) {
    if (byName.wowClass !== owned.wowClass) {
      return {
        blizzardCharacterId: owned.id,
        name: identity.name,
        realm: identity.realm,
        realmSlug: owned.realmSlug,
        realmId: owned.realmId,
        region: owned.region,
        wowClass: owned.wowClass,
        level: owned.level,
        status: "conflict",
        characterId: byName.id,
        conflictReason: "An existing character matches name/realm/region but has a different class.",
        suggestedSpecialization: null,
        suggestedItemLevel: null,
      };
    }

    if (byName.blizzardCharacterId && byName.blizzardCharacterId !== owned.id) {
      return {
        blizzardCharacterId: owned.id,
        name: identity.name,
        realm: identity.realm,
        realmSlug: owned.realmSlug,
        realmId: owned.realmId,
        region: owned.region,
        wowClass: owned.wowClass,
        level: owned.level,
        status: "conflict",
        characterId: byName.id,
        conflictReason: "That BoostingHub character is already linked to a different Blizzard identity.",
        suggestedSpecialization: null,
        suggestedItemLevel: null,
      };
    }

    return {
      blizzardCharacterId: owned.id,
      name: identity.name,
      realm: identity.realm,
      realmSlug: owned.realmSlug,
      realmId: owned.realmId,
      region: owned.region,
      wowClass: owned.wowClass,
      level: owned.level,
      status: "link",
      characterId: byName.id,
      conflictReason: null,
      suggestedSpecialization: null,
      suggestedItemLevel: null,
    };
  }

  return {
    blizzardCharacterId: owned.id,
    name: identity.name,
    realm: identity.realm,
    realmSlug: owned.realmSlug,
    realmId: owned.realmId,
    region: owned.region,
    wowClass: owned.wowClass,
    level: owned.level,
    status: "import",
    characterId: null,
    conflictReason: null,
    suggestedSpecialization: null,
    suggestedItemLevel: null,
  };
}

export const characterBlizzardService = {
  async resolveImportCandidates(user: AuthenticatedUser, sessionId: string) {
    const session = await requireLiveImportSession(user, sessionId);
    const candidates: ImportCandidate[] = [];

    // Candidate listing must stay DB-only. Live Blizzard profile enrichment
    // (spec / iLvl) runs at import/link/refresh time — never on page load.
    // Doing it here for every owned character blocked /characters for minutes,
    // held the shared pg pool, and made the whole app look infinitely loading.
    for (const owned of session.characters) {
      candidates.push(await resolveCandidate(user, owned));
    }

    return {
      sessionId: session.id,
      region: session.region,
      expiresAt: session.expiresAt,
      candidates,
    };
  },

  /** Best-effort public profile enrichment for one snapshot row (import-time prefill). */
  async enrichImportCandidate(
    user: AuthenticatedUser,
    sessionId: string,
    blizzardCharacterId: string,
  ) {
    const session = await requireLiveImportSession(user, sessionId);
    const owned = findOwnedInSession(session.characters, blizzardCharacterId);
    const candidate = await resolveCandidate(user, owned);
    if (candidate.status !== "import") {
      return {
        blizzardCharacterId,
        suggestedSpecialization: null as string | null,
        suggestedItemLevel: null as number | null,
      };
    }
    const enrichment = await enrichProfileBestEffort(owned);
    return {
      blizzardCharacterId,
      suggestedSpecialization: enrichment.specialization,
      suggestedItemLevel: enrichment.itemLevel,
    };
  },

  /**
   * Applies a mixed import/link selection in one request.
   * External Blizzard profile reads for imports happen before any persistence so a
   * missing specialization fails the whole batch without partial Character creates.
   */
  async applySelections(
    user: AuthenticatedUser,
    sessionId: string,
    selections: ImportCharacterSelection[],
  ) {
    const session = await requireLiveImportSession(user, sessionId);
    if (selections.length === 0) {
      throw new DomainError("VALIDATION_FAILED", "Select at least one character.");
    }

    type PlannedImport = {
      kind: "import";
      owned: OwnedBlizzardCharacter;
      selection: ImportCharacterSelection;
    };
    type PlannedLink = {
      kind: "link";
      owned: OwnedBlizzardCharacter;
      characterId: string;
    };

    const planned: Array<PlannedImport | PlannedLink> = [];

    for (const selection of selections) {
      const owned = findOwnedInSession(session.characters, selection.blizzardCharacterId);
      const candidate = await resolveCandidate(user, owned);

      if (candidate.status === "import") {
        planned.push({ kind: "import", owned, selection });
        continue;
      }

      if (candidate.status === "link" && candidate.characterId) {
        planned.push({ kind: "link", owned, characterId: candidate.characterId });
        continue;
      }

      throw new DomainError(
        candidate.status === "conflict" ? "BLIZZARD_IDENTITY_CONFLICT" : "VALIDATION_FAILED",
        candidate.conflictReason ??
          `Character ${owned.name} cannot be imported or linked (status: ${candidate.status}).`,
      );
    }

    type ReadyImport = PlannedImport & {
      identity: ReturnType<typeof prepareImportedIdentity>;
      enrichment: Awaited<ReturnType<typeof enrichProfileBestEffort>>;
      spec: { specialization: string; primaryRole: CharacterRole };
    };

    const readyImports: ReadyImport[] = [];
    for (const item of planned) {
      if (item.kind !== "import") continue;
      const identity = prepareImportedIdentity(item.owned);
      const enrichment = await enrichProfileBestEffort(item.owned);
      const specializationRaw =
        item.selection.specialization?.trim() || enrichment.specialization || "";
      if (!specializationRaw) {
        throw new DomainError(
          "INVALID_SPECIALIZATION",
          `Choose a specialization for ${identity.name}-${identity.realm}.`,
        );
      }
      const spec = resolveClassSpecialization(item.owned.wowClass, specializationRaw);
      readyImports.push({ ...item, identity, enrichment, spec });
    }

    const importedCharacterIds: string[] = [];
    const linkedCharacterIds: string[] = [];

    for (const item of readyImports) {
      const itemLevel = item.enrichment.itemLevel ?? 0;
      const lastSyncedAt = item.enrichment.synced ? new Date().toISOString() : null;
      try {
        const created = await characterRepository.create({
          id: crypto.randomUUID(),
          userId: user.id,
          ...item.identity,
          wowClass: item.owned.wowClass,
          specialization: item.spec.specialization,
          primaryRole: item.spec.primaryRole,
          itemLevel,
          isActive: true,
          blizzardCharacterId: item.owned.id,
          blizzardRealmId: item.owned.realmId,
          lastSyncedAt,
        });
        importedCharacterIds.push(created.id);
      } catch (error) {
        if (uniqueViolation(error)) {
          throw new DomainError(
            "BLIZZARD_IDENTITY_CONFLICT",
            "That Blizzard character conflicts with an existing BoostingHub character.",
          );
        }
        throw error;
      }
    }

    for (const item of planned) {
      if (item.kind !== "link") continue;
      const character = await characterRepository.findById(item.characterId);
      if (!character) {
        throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
      }
      assertOwned(user, character);

      if (character.region !== item.owned.region) {
        throw new DomainError(
          "BLIZZARD_REGION_MISMATCH",
          "Character region does not match the Battle.net connection region.",
        );
      }
      if (character.wowClass !== item.owned.wowClass) {
        throw new DomainError(
          "BLIZZARD_IDENTITY_CONFLICT",
          "Class mismatch between BoostingHub character and Blizzard identity.",
        );
      }

      const enrichment = await enrichProfileBestEffort(item.owned);
      const lastSyncedAt = enrichment.synced ? new Date().toISOString() : null;

      try {
        await characterRepository.applyBlizzardLink(character.id, {
          blizzardCharacterId: item.owned.id,
          blizzardRealmId: item.owned.realmId,
          ...(typeof enrichment.itemLevel === "number" ? { itemLevel: enrichment.itemLevel } : {}),
          lastSyncedAt,
        });
      } catch (error) {
        if (uniqueViolation(error)) {
          throw new DomainError(
            "BLIZZARD_IDENTITY_CONFLICT",
            "That Blizzard character is already linked elsewhere.",
          );
        }
        throw error;
      }

      linkedCharacterIds.push(character.id);
    }

    const connection = await battleNetConnectionRepository.findByUserAndRegion(
      user.id,
      session.region,
    );
    if (connection && (importedCharacterIds.length > 0 || linkedCharacterIds.length > 0)) {
      await battleNetConnectionRepository.markSuccessfulSync(
        connection.id,
        new Date().toISOString(),
      );
    }

    if (importedCharacterIds.length > 0) {
      await activityRepository.create({
        userId: user.id,
        type: "BATTLENET_CHARACTERS_IMPORTED",
        message: `Imported ${importedCharacterIds.length} character(s) from Battle.net (${session.region}).`,
      });
    }
    if (linkedCharacterIds.length > 0) {
      await activityRepository.create({
        userId: user.id,
        type: "BATTLENET_CHARACTER_LINKED",
        message: `Linked ${linkedCharacterIds.length} character(s) to Battle.net (${session.region}).`,
      });
    }

    return { importedCharacterIds, linkedCharacterIds };
  },

  async importCharacters(
    user: AuthenticatedUser,
    sessionId: string,
    selections: ImportCharacterSelection[],
  ) {
    const result = await this.applySelections(user, sessionId, selections);
    return { importedCharacterIds: result.importedCharacterIds };
  },

  async linkCharacter(
    user: AuthenticatedUser,
    sessionId: string,
    blizzardCharacterId: string,
    characterId: string,
  ) {
    const session = await requireLiveImportSession(user, sessionId);
    const owned = findOwnedInSession(session.characters, blizzardCharacterId);
    const candidate = await resolveCandidate(user, owned);

    if (candidate.status === "already_linked" && candidate.characterId === characterId) {
      return { characterId };
    }

    if (candidate.status !== "link" || candidate.characterId !== characterId) {
      throw new DomainError(
        candidate.status === "conflict" ? "BLIZZARD_IDENTITY_CONFLICT" : "VALIDATION_FAILED",
        candidate.conflictReason ?? "That character cannot be linked from this import session.",
      );
    }

    const result = await this.applySelections(user, sessionId, [{ blizzardCharacterId }]);
    return { characterId: result.linkedCharacterIds[0] ?? characterId };
  },

  async refreshCharacter(user: AuthenticatedUser, characterId: string) {
    const character = await characterRepository.findById(characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    assertOwned(user, character);

    if (!character.blizzardCharacterId || !character.blizzardRealmId) {
      throw new DomainError(
        "BLIZZARD_CHARACTER_NOT_FOUND",
        "Character is not linked to Battle.net.",
        400,
      );
    }

    const connection = await battleNetConnectionRepository.findByUserAndRegion(
      user.id,
      character.region,
    );
    if (!connection) {
      throw new DomainError(
        "BATTLENET_NOT_CONNECTED",
        `Connect Battle.net (${character.region}) before refreshing.`,
        400,
      );
    }

    if (character.lastSyncedAt) {
      const elapsed = Date.now() - new Date(character.lastSyncedAt).getTime();
      if (elapsed < REFRESH_COOLDOWN_MS) {
        throw new DomainError(
          "BLIZZARD_REFRESH_COOLDOWN",
          "Wait at least 60 seconds between Blizzard refreshes.",
          429,
        );
      }
    }

    let summary;
    try {
      const realmSlug = realmSlugFromDisplayName(character.realm);
      const status = await blizzardApiClient.getCharacterProfileStatus(
        character.region,
        realmSlug,
        character.name,
      );
      if (!status.isValid) {
        throw new DomainError(
          "BLIZZARD_PROFILE_UNAVAILABLE",
          "Blizzard reports this character profile as unavailable.",
          502,
        );
      }

      summary = await blizzardApiClient.getCharacterProfileSummary(
        character.region,
        realmSlug,
        character.name,
      );
    } catch (error) {
      if (isDomainError(error)) {
        if (
          error.code === "BLIZZARD_CHARACTER_NOT_FOUND" ||
          error.code === "BLIZZARD_PROFILE_UNAVAILABLE" ||
          error.code === "BATTLENET_RATE_LIMITED" ||
          error.code === "BATTLENET_NOT_CONFIGURED"
        ) {
          throw error;
        }
        throw new DomainError(
          "BLIZZARD_SYNC_FAILED",
          "Could not refresh character from Blizzard.",
          502,
        );
      }
      throw new DomainError("BLIZZARD_SYNC_FAILED", "Could not refresh character from Blizzard.", 502);
    }

    if (summary.wowClass && summary.wowClass !== character.wowClass) {
      throw new DomainError(
        "BLIZZARD_IDENTITY_CONFLICT",
        "Blizzard class no longer matches this BoostingHub character.",
      );
    }

    if (
      summary.id &&
      summary.id !== character.blizzardCharacterId
    ) {
      throw new DomainError(
        "BLIZZARD_IDENTITY_CONFLICT",
        "Blizzard character id no longer matches the linked identity.",
      );
    }

    if (
      summary.realmId &&
      summary.realmId !== character.blizzardRealmId
    ) {
      throw new DomainError(
        "BLIZZARD_IDENTITY_CONFLICT",
        "Realm transfer detected. Automatic transfer handling is not supported.",
      );
    }

    const nextName = prepareCharacterName(summary.name || character.name);
    if (!isValidCharacterName(nextName)) {
      throw new DomainError(
        "INVALID_CHARACTER_NAME",
        "Blizzard returned a character name that BoostingHub cannot store.",
      );
    }

    const nextNormalizedName = normalizeCharacterIdentity(nextName);
    if (nextNormalizedName !== character.normalizedName) {
      const conflict = await characterRepository.findIdentityConflict({
        userId: user.id,
        region: character.region,
        normalizedName: nextNormalizedName,
        normalizedRealm: character.normalizedRealm,
        excludeId: character.id,
      });
      if (conflict) {
        throw new DomainError(
          "CHARACTER_ALREADY_EXISTS",
          "Cannot rename: you already have another character with that name on this realm.",
        );
      }
    }

    if (typeof summary.equippedItemLevel !== "number") {
      throw new DomainError(
        "BLIZZARD_PROFILE_UNAVAILABLE",
        "Blizzard profile did not include item level.",
        502,
      );
    }

    const syncedAt = new Date().toISOString();
    try {
      await characterRepository.applyBlizzardSync(character.id, {
        name: nextName,
        normalizedName: nextNormalizedName,
        itemLevel: summary.equippedItemLevel,
        lastSyncedAt: syncedAt,
      });
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new DomainError(
          "CHARACTER_ALREADY_EXISTS",
          "Cannot rename: identity conflict after Blizzard refresh.",
        );
      }
      throw error;
    }

    await battleNetConnectionRepository.markSuccessfulSync(connection.id, syncedAt);
    await activityRepository.create({
      userId: user.id,
      type: "BATTLENET_CHARACTER_REFRESHED",
      message: `Refreshed ${nextName}-${character.realm} (${character.region}) from Blizzard.`,
    });

    const updated = await characterRepository.findById(character.id);
    if (!updated) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    return updated;
  },
};
