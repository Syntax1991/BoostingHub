import { raiderIoApiClient } from "@/integrations/raider-io/raider-io-api-client";
import { toStoredItemLevel } from "@/lib/character-item-level";
import { recordRaiderIoApiOutcome } from "@/lib/integration-provider-events";
import type { WowRegion } from "@/models/enums";

/**
 * Pure rule: take Raider.IO equipped ilvl only when it is strictly greater
 * than the Blizzard value just applied (or when Blizzard omitted ilvl).
 */
export function shouldPreferRaiderIoItemLevel(
  blizzardEquippedItemLevel: number | null | undefined,
  raiderIoEquippedItemLevel: number,
): boolean {
  const blizzard = toStoredItemLevel(blizzardEquippedItemLevel);
  const raiderIo = toStoredItemLevel(raiderIoEquippedItemLevel);
  if (raiderIo == null) return false;
  if (blizzard == null) return true;
  return raiderIo > blizzard;
}

/**
 * Soft enrichment after Blizzard applyBlizzardSync. Returns the higher RIO
 * ilvl to persist, or null when Blizzard should stand / RIO failed.
 */
export async function resolveRaiderIoItemLevelEnrichment(input: {
  name: string;
  realm: string;
  region: WowRegion;
  blizzardEquippedItemLevel: number | null | undefined;
}): Promise<number | null> {
  const started = Date.now();
  const result = await raiderIoApiClient.getCharacterEquippedItemLevel({
    name: input.name,
    realm: input.realm,
    region: input.region,
  });

  if (result.status === "TEMPORARY_FAILURE") {
    // Soft-fail: never throw into Blizzard sync. Telemetry only.
    await recordRaiderIoApiOutcome({
      status: "TEMPORARY_FAILURE",
      region: input.region,
      durationMs: Date.now() - started,
      reason: result.message,
    });
    return null;
  }

  if (result.status !== "SUCCESS") {
    // NOT_FOUND is domain absence — no provider telemetry flood.
    return null;
  }

  await recordRaiderIoApiOutcome({
    status: "SUCCESS",
    region: input.region,
    durationMs: Date.now() - started,
  });

  const raiderIoEquippedItemLevel = toStoredItemLevel(result.equippedItemLevel);
  if (raiderIoEquippedItemLevel == null) {
    return null;
  }

  if (!shouldPreferRaiderIoItemLevel(input.blizzardEquippedItemLevel, raiderIoEquippedItemLevel)) {
    return null;
  }

  return raiderIoEquippedItemLevel;
}
