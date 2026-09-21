import { raiderIoApiClient } from "@/integrations/raider-io/raider-io-api-client";
import { toStoredItemLevel } from "@/lib/character-item-level";
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
  const result = await raiderIoApiClient.getCharacterEquippedItemLevel({
    name: input.name,
    realm: input.realm,
    region: input.region,
  });

  if (result.status !== "SUCCESS") {
    return null;
  }

  const raiderIoEquippedItemLevel = toStoredItemLevel(result.equippedItemLevel);
  if (raiderIoEquippedItemLevel == null) {
    return null;
  }

  if (!shouldPreferRaiderIoItemLevel(input.blizzardEquippedItemLevel, raiderIoEquippedItemLevel)) {
    return null;
  }

  return raiderIoEquippedItemLevel;
}
