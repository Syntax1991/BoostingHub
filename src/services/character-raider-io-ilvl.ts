import { raiderIoApiClient } from "@/integrations/raider-io/raider-io-api-client";
import type { WowRegion } from "@/models/enums";

/**
 * Pure rule: take Raider.IO equipped ilvl only when it is strictly greater
 * than the Blizzard value just applied (or when Blizzard omitted ilvl).
 */
export function shouldPreferRaiderIoItemLevel(
  blizzardEquippedItemLevel: number | null | undefined,
  raiderIoEquippedItemLevel: number,
): boolean {
  if (!Number.isFinite(raiderIoEquippedItemLevel)) return false;
  if (blizzardEquippedItemLevel == null || !Number.isFinite(blizzardEquippedItemLevel)) {
    return true;
  }
  return raiderIoEquippedItemLevel > blizzardEquippedItemLevel;
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
  const result = await raiderIoApiClient.getCharacterEquippedItemLevel({
    name: input.name,
    realm: input.realm,
    region: input.region,
  });

  if (result.status !== "SUCCESS") {
    return null;
  }

  if (!shouldPreferRaiderIoItemLevel(input.blizzardEquippedItemLevel, result.equippedItemLevel)) {
    return null;
  }

  return result.equippedItemLevel;
}
