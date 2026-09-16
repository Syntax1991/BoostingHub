import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCharacterOwned } from "@/lib/blizzard/character-domain";
import { DomainError } from "@/lib/errors";
import { warcraftLogsApiClient } from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { characterRepository } from "@/repositories/character.repository";

export type CharacterWarcraftLogsLinkResult =
  | { status: "LINKED"; warcraftLogsId: string }
  | { status: "ALREADY_LINKED"; warcraftLogsId: string }
  | { status: "NOT_FOUND" }
  | { status: "NOT_CONFIGURED" }
  | { status: "UNSUPPORTED_REGION" }
  | { status: "MISMATCH"; storedId: string; discoveredId: string }
  | { status: "TEMPORARY_FAILURE"; message: string };

/**
 * Resolve and optionally persist Character.warcraftLogsId from the public WCL API.
 * Never mutates class/spec/ilvl/Blizzard identity/signup/roster state.
 */
async function linkCharacterById(characterId: string): Promise<CharacterWarcraftLogsLinkResult> {
  const character = await characterRepository.findById(characterId);
  if (!character) {
    throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
  }

  const lookup = await warcraftLogsApiClient.findCharacter({
    name: character.name,
    realm: character.realm,
    region: character.region,
  });

  if (lookup.status === "NOT_CONFIGURED") return { status: "NOT_CONFIGURED" };
  if (lookup.status === "UNSUPPORTED_REGION") return { status: "UNSUPPORTED_REGION" };
  if (lookup.status === "NOT_FOUND") return { status: "NOT_FOUND" };
  if (lookup.status === "TEMPORARY_FAILURE") {
    return { status: "TEMPORARY_FAILURE", message: lookup.message };
  }

  const discoveredId = lookup.character.warcraftLogsId;
  const stored = character.warcraftLogsId?.trim() || null;

  if (!stored) {
    await characterRepository.setWarcraftLogsId(character.id, discoveredId);
    return { status: "LINKED", warcraftLogsId: discoveredId };
  }

  if (stored === discoveredId) {
    return { status: "ALREADY_LINKED", warcraftLogsId: stored };
  }

  // Conservative v1: never silently overwrite an established identity.
  console.warn(
    `[warcraft-logs] identity mismatch for character ${character.id}: stored=${stored} discovered=${discoveredId}`,
  );
  return { status: "MISMATCH", storedId: stored, discoveredId };
}

export const characterWarcraftLogsService = {
  /**
   * Owner-facing explicit retry. Enforces ownership; surfaces typed outcomes.
   */
  async linkForOwner(
    user: AuthenticatedUser,
    characterId: string,
  ): Promise<CharacterWarcraftLogsLinkResult> {
    const character = await characterRepository.findById(characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    assertCharacterOwned(user, character);
    return linkCharacterById(characterId);
  },

  /**
   * Best-effort enrichment for automatic hooks.
   * Skips when already linked. Never throws — WCL outages must not break Character flows.
   */
  async tryAutoLinkIfMissing(characterId: string): Promise<CharacterWarcraftLogsLinkResult | null> {
    try {
      const character = await characterRepository.findById(characterId);
      if (!character) return null;
      if (character.warcraftLogsId?.trim()) {
        return { status: "ALREADY_LINKED", warcraftLogsId: character.warcraftLogsId.trim() };
      }
      return await linkCharacterById(characterId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Warcraft Logs auto-link failed.";
      console.warn(`[warcraft-logs] auto-link skipped for ${characterId}: ${message}`);
      return { status: "TEMPORARY_FAILURE", message };
    }
  },
};
