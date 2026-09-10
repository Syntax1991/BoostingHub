import type { AuthenticatedUser } from "@/auth/authorization";
import { DomainError, isDomainError } from "@/lib/errors";
import {
  isValidCharacterName,
  isValidRealmName,
  normalizeCharacterIdentity,
  prepareCharacterName,
  prepareRealmName,
} from "@/lib/character-identity";
import {
  assertCharacterOwned,
  isUniqueConstraintViolation,
  realmSlugFromDisplayName,
} from "@/lib/blizzard/character-domain";
import type {
  ImportCandidate,
  ImportCharacterSelection,
  OwnedBlizzardCharacter,
} from "@/lib/blizzard/types";
import {
  assertImportCharacterLevel,
  meetsImportCharacterLevel,
  MIN_IMPORT_CHARACTER_LEVEL,
} from "@/lib/blizzard/import-rules";
import { blizzardApiClient } from "@/integrations/blizzard/blizzard-api-client";
import { resolveClassSpecialization } from "@/lib/wow-specializations";
import type { CharacterRole, WowClass } from "@/models/enums";
import { activityRepository } from "@/repositories/activity.repository";
import { battleNetConnectionRepository } from "@/repositories/battle-net-connection.repository";
import { characterRepository } from "@/repositories/character.repository";
import { battleNetService } from "@/services/battle-net.service";

/**
 * Owns the Add-Character public lookup and the Battle.net import/link flow:
 * resolving candidates against existing BoostingHub characters, best-effort
 * profile enrichment for prefill, and persisting import/link selections.
 * Refreshing already-linked characters lives in character-blizzard-sync.service.ts.
 */

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

/**
 * Public Character Profile lookup for the manual Add Character flow.
 * Proves the character exists and returns Blizzard's authoritative Class
 * and equipped item level — it does NOT prove BoostingHub-account ownership.
 * Ownership is only established through the authenticated Battle.net import
 * (battleNetService / applySelections below).
 */
async function lookupPublicCharacterProfile(
  name: string,
  realm: string,
  region: "EU" | "US",
): Promise<{ wowClass: WowClass; itemLevel: number | null }> {
  const realmSlug = realmSlugFromDisplayName(realm);
  const status = await blizzardApiClient.getCharacterProfileStatus(region, realmSlug, name);
  if (!status.isValid) {
    throw new DomainError(
      "BLIZZARD_CHARACTER_NOT_FOUND",
      `Blizzard character "${name}-${realm}" was not found.`,
      404,
    );
  }

  const summary = await blizzardApiClient.getCharacterProfileSummary(region, realmSlug, name);
  if (!summary.wowClass) {
    throw new DomainError(
      "BLIZZARD_PROFILE_UNAVAILABLE",
      "Blizzard did not return a class for this character.",
      502,
    );
  }

  return {
    wowClass: summary.wowClass,
    itemLevel: typeof summary.equippedItemLevel === "number" ? summary.equippedItemLevel : null,
  };
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

  if (!meetsImportCharacterLevel(owned.level)) {
    return {
      blizzardCharacterId: owned.id,
      name: identity.name,
      realm: identity.realm,
      realmSlug: owned.realmSlug,
      realmId: owned.realmId,
      region: owned.region,
      wowClass: owned.wowClass,
      level: owned.level,
      status: "level_too_low",
      characterId: null,
      conflictReason: `Requires level ${MIN_IMPORT_CHARACTER_LEVEL}.`,
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

export const characterBlizzardImportService = {
  lookupPublicCharacterProfile,

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
    if (candidate.status !== "import" && candidate.status !== "link") {
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
   * External Blizzard profile reads happen before persistence so missing
   * specialization / item level fails the batch without partial creates.
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
      selection: ImportCharacterSelection;
    };

    const planned: Array<PlannedImport | PlannedLink> = [];

    for (const selection of selections) {
      const owned = findOwnedInSession(session.characters, selection.blizzardCharacterId);
      assertImportCharacterLevel(owned.level, `${owned.name}`);
      const candidate = await resolveCandidate(user, owned);

      if (candidate.status === "import") {
        planned.push({ kind: "import", owned, selection });
        continue;
      }

      if (candidate.status === "link" && candidate.characterId) {
        planned.push({
          kind: "link",
          owned,
          characterId: candidate.characterId,
          selection,
        });
        continue;
      }

      if (candidate.status === "level_too_low") {
        throw new DomainError(
          "BLIZZARD_LEVEL_TOO_LOW",
          candidate.conflictReason ??
            `${owned.name} cannot be imported because level ${MIN_IMPORT_CHARACTER_LEVEL} is required.`,
        );
      }

      throw new DomainError(
        candidate.status === "conflict" ? "BLIZZARD_IDENTITY_CONFLICT" : "VALIDATION_FAILED",
        candidate.conflictReason ??
          `Character ${owned.name} cannot be imported or linked (status: ${candidate.status}).`,
      );
    }

    type ReadyRow = {
      kind: "import" | "link";
      owned: OwnedBlizzardCharacter;
      characterId?: string;
      identity: ReturnType<typeof prepareImportedIdentity>;
      enrichment: Awaited<ReturnType<typeof enrichProfileBestEffort>>;
      spec: { specialization: string; primaryRole: CharacterRole };
      /** Blizzard-authoritative; null when Blizzard did not supply one. No manual fallback. */
      itemLevel: number | null;
      lastSyncedAt: string | null;
    };

    const ready: ReadyRow[] = [];

    for (const item of planned) {
      const identity = prepareImportedIdentity(item.owned);
      const label = `${identity.name}-${identity.realm}`;
      const specializationRaw = item.selection.specialization?.trim() ?? "";
      if (!specializationRaw) {
        throw new DomainError(
          "INVALID_SPECIALIZATION",
          `Choose a specialization for ${label}.`,
        );
      }
      const spec = resolveClassSpecialization(item.owned.wowClass, specializationRaw);
      const enrichment = await enrichProfileBestEffort(item.owned);

      const itemLevel = typeof enrichment.itemLevel === "number" ? enrichment.itemLevel : null;
      const lastSyncedAt = enrichment.synced ? new Date().toISOString() : null;

      ready.push({
        kind: item.kind,
        owned: item.owned,
        characterId: item.kind === "link" ? item.characterId : undefined,
        identity,
        enrichment,
        spec,
        itemLevel,
        lastSyncedAt,
      });
    }

    const importedCharacterIds: string[] = [];
    const linkedCharacterIds: string[] = [];

    for (const item of ready) {
      if (item.kind !== "import") continue;
      try {
        const created = await characterRepository.create({
          id: crypto.randomUUID(),
          userId: user.id,
          ...item.identity,
          wowClass: item.owned.wowClass,
          specialization: item.spec.specialization,
          primaryRole: item.spec.primaryRole,
          itemLevel: item.itemLevel,
          isActive: true,
          blizzardCharacterId: item.owned.id,
          blizzardRealmId: item.owned.realmId,
          lastSyncedAt: item.lastSyncedAt,
        });
        importedCharacterIds.push(created.id);
      } catch (error) {
        if (isUniqueConstraintViolation(error)) {
          throw new DomainError(
            "BLIZZARD_IDENTITY_CONFLICT",
            "That Blizzard character conflicts with an existing BoostingHub character.",
          );
        }
        throw error;
      }
    }

    for (const item of ready) {
      if (item.kind !== "link" || !item.characterId) continue;
      const character = await characterRepository.findById(item.characterId);
      if (!character) {
        throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
      }
      assertCharacterOwned(user, character);

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

      try {
        await characterRepository.applyBlizzardLink(character.id, {
          blizzardCharacterId: item.owned.id,
          blizzardRealmId: item.owned.realmId,
          specialization: item.spec.specialization,
          primaryRole: item.spec.primaryRole,
          // Omitted (not null) when unavailable this time, so linking never
          // clears a previously known item level on a transient failure.
          ...(typeof item.itemLevel === "number" ? { itemLevel: item.itemLevel } : {}),
          lastSyncedAt: item.lastSyncedAt,
        });
      } catch (error) {
        if (isUniqueConstraintViolation(error)) {
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
    options: { specialization: string },
  ) {
    const session = await requireLiveImportSession(user, sessionId);
    const owned = findOwnedInSession(session.characters, blizzardCharacterId);
    const candidate = await resolveCandidate(user, owned);

    if (candidate.status === "already_linked" && candidate.characterId === characterId) {
      return { characterId };
    }

    if (candidate.status !== "link" || candidate.characterId !== characterId) {
      throw new DomainError(
        candidate.status === "conflict"
          ? "BLIZZARD_IDENTITY_CONFLICT"
          : candidate.status === "level_too_low"
            ? "BLIZZARD_LEVEL_TOO_LOW"
            : "VALIDATION_FAILED",
        candidate.conflictReason ?? "That character cannot be linked from this import session.",
      );
    }

    const result = await this.applySelections(user, sessionId, [
      { blizzardCharacterId, specialization: options.specialization },
    ]);
    return { characterId: result.linkedCharacterIds[0] ?? characterId };
  },
};
