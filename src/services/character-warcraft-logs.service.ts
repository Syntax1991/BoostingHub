import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCharacterOwned } from "@/lib/blizzard/character-domain";
import { DomainError } from "@/lib/errors";
import { warcraftLogsApiClient } from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { characterRepository } from "@/repositories/character.repository";

/** Bounded concurrency for bulk WCL enrichment — matches Blizzard Refresh All. */
export const WARCRAFT_LOGS_AUTO_LINK_CONCURRENCY = 4;

export type CharacterWarcraftLogsLinkResult =
  | { status: "LINKED"; warcraftLogsId: string }
  | { status: "ALREADY_LINKED"; warcraftLogsId: string }
  | { status: "NOT_FOUND" }
  | { status: "NOT_CONFIGURED" }
  | { status: "UNSUPPORTED_REGION" }
  | { status: "MISMATCH"; storedId: string; discoveredId: string }
  | { status: "TEMPORARY_FAILURE"; message: string };

export type CharacterWarcraftLogsBatchSummary = {
  total: number;
  attempted: number;
  linked: number;
  alreadyLinked: number;
  notFound: number;
  mismatch: number;
  unsupportedRegion: number;
  temporaryFailure: number;
  /** Characters never started after a request-local TEMPORARY_FAILURE circuit trip. */
  skippedAfterFailure: number;
};

function emptyBatchSummary(total: number): CharacterWarcraftLogsBatchSummary {
  return {
    total,
    attempted: 0,
    linked: 0,
    alreadyLinked: 0,
    notFound: 0,
    mismatch: 0,
    unsupportedRegion: 0,
    temporaryFailure: 0,
    skippedAfterFailure: 0,
  };
}

function recordResult(
  summary: CharacterWarcraftLogsBatchSummary,
  result: CharacterWarcraftLogsLinkResult | null,
): void {
  summary.attempted += 1;
  if (!result) return;
  switch (result.status) {
    case "LINKED":
      summary.linked += 1;
      break;
    case "ALREADY_LINKED":
      summary.alreadyLinked += 1;
      break;
    case "NOT_FOUND":
      summary.notFound += 1;
      break;
    case "MISMATCH":
      summary.mismatch += 1;
      break;
    case "UNSUPPORTED_REGION":
      summary.unsupportedRegion += 1;
      break;
    case "TEMPORARY_FAILURE":
      summary.temporaryFailure += 1;
      break;
    case "NOT_CONFIGURED":
      // Batch fast-path should prevent this; treat as temporary stop if it appears.
      summary.temporaryFailure += 1;
      break;
    default:
      break;
  }
}

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

  /**
   * Bounded best-effort enrichment for bulk flows.
   * Request-local circuit: after the first TEMPORARY_FAILURE, in-flight workers
   * finish but no new Character IDs are claimed. Never throws for WCL failures.
   */
  async tryAutoLinkManyIfMissing(
    characterIds: readonly string[],
  ): Promise<CharacterWarcraftLogsBatchSummary> {
    const uniqueIds = [...new Set(characterIds.filter((id) => Boolean(id)))];
    const summary = emptyBatchSummary(uniqueIds.length);
    if (uniqueIds.length === 0) {
      return summary;
    }

    if (!warcraftLogsApiClient.isConfigured()) {
      return summary;
    }

    let nextIndex = 0;
    let circuitOpen = false;

    async function runWorker() {
      while (true) {
        // JS is single-threaded until await — circuit check + claim is atomic.
        if (circuitOpen) return;
        const index = nextIndex;
        nextIndex += 1;
        if (index >= uniqueIds.length) return;

        const characterId = uniqueIds[index]!;
        const result = await characterWarcraftLogsService.tryAutoLinkIfMissing(characterId);
        recordResult(summary, result);
        if (result?.status === "TEMPORARY_FAILURE" || result?.status === "NOT_CONFIGURED") {
          circuitOpen = true;
          return;
        }
      }
    }

    const pool = Math.min(WARCRAFT_LOGS_AUTO_LINK_CONCURRENCY, uniqueIds.length);
    await Promise.all(Array.from({ length: pool }, () => runWorker()));
    summary.skippedAfterFailure = Math.max(0, uniqueIds.length - summary.attempted);
    return summary;
  },
};
