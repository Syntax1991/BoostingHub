import { realmSlugFromDisplayName } from "@/lib/blizzard/character-domain";
import type { WowRegion } from "@/models/enums";

const REQUEST_TIMEOUT_MS = 15_000;
const RAIDER_IO_PROFILE_URL = "https://raider.io/api/v1/characters/profile";

export type RaiderIoEquippedItemLevelResult =
  | { status: "SUCCESS"; equippedItemLevel: number }
  | { status: "NOT_FOUND" }
  | { status: "TEMPORARY_FAILURE"; message: string };

function toRaiderIoRegion(region: WowRegion): "eu" | "us" | null {
  if (region === "EU") return "eu";
  if (region === "US") return "us";
  return null;
}

/** Blizzard-compatible realm slug (`Twisting Nether` → `twisting-nether`). */
export function raiderIoRealmSlugFromRealm(realm: string): string {
  return realmSlugFromDisplayName(realm);
}

/** Optional app key from raider.io/settings/apps — higher rate limits. */
export function getRaiderIoAccessKey(): string | null {
  const key = process.env.RAIDER_IO_ACCESS_KEY?.trim();
  return key ? key : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/**
 * Use Raider.IO's reported `item_level_equipped` only. Do not recompute from
 * `gear.items` — empty weapon slots correctly lower Blizzard/RIO equipped ilvl
 * (e.g. 272), and averaging present armor would falsely inflate it.
 */
export function resolveRaiderIoEquippedItemLevel(gear: {
  item_level_equipped?: unknown;
  items?: unknown;
}): number | null {
  const equipped = asFiniteNumber(gear.item_level_equipped);
  if (equipped == null) return null;
  return Math.floor(equipped);
}

/**
 * Raider.IO character profile for equipped-ilvl enrichment after Blizzard
 * refresh. Soft-fail on errors. Works without a key; set RAIDER_IO_ACCESS_KEY
 * for higher rate limits at scale.
 */
export const raiderIoApiClient = {
  async getCharacterEquippedItemLevel(input: {
    name: string;
    realm: string;
    region: WowRegion;
  }): Promise<RaiderIoEquippedItemLevelResult> {
    const region = toRaiderIoRegion(input.region);
    if (!region) {
      return { status: "TEMPORARY_FAILURE", message: "Unsupported region for Raider.IO." };
    }

    const url = new URL(RAIDER_IO_PROFILE_URL);
    url.searchParams.set("region", region);
    url.searchParams.set("realm", raiderIoRealmSlugFromRealm(input.realm));
    url.searchParams.set("name", input.name);
    url.searchParams.set("fields", "gear");
    const accessKey = getRaiderIoAccessKey();
    if (accessKey) {
      url.searchParams.set("access_key", accessKey);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Raider.IO request failed.";
      return { status: "TEMPORARY_FAILURE", message };
    }

    if (response.status === 404) {
      return { status: "NOT_FOUND" };
    }

    if (!response.ok) {
      return {
        status: "TEMPORARY_FAILURE",
        message: `Raider.IO HTTP ${response.status}`,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "TEMPORARY_FAILURE", message: "Raider.IO returned invalid JSON." };
    }

    if (!body || typeof body !== "object") {
      return { status: "TEMPORARY_FAILURE", message: "Raider.IO returned an unexpected payload." };
    }

    const gear = (body as { gear?: unknown }).gear;
    if (!gear || typeof gear !== "object") {
      return { status: "NOT_FOUND" };
    }

    const equipped = resolveRaiderIoEquippedItemLevel(gear as {
      item_level_equipped?: unknown;
      items?: unknown;
    });
    if (equipped == null) {
      return { status: "NOT_FOUND" };
    }

    return { status: "SUCCESS", equippedItemLevel: equipped };
  },
};
