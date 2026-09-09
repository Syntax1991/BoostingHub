import { DomainError } from "@/lib/errors";
import {
  blizzardApiHost,
  blizzardLocale,
  blizzardOAuthAuthorizeUrl,
  blizzardOAuthTokenUrl,
  blizzardOAuthUserInfoUrl,
  blizzardProfileNamespace,
  getBlizzardConfig,
} from "@/lib/blizzard/config";
import { mapPlayableClassId } from "@/lib/blizzard/playable-class";
import type {
  BlizzardProfileStatus,
  BlizzardProfileSummary,
  OwnedBlizzardCharacter,
} from "@/lib/blizzard/types";
import type { WowClass, WowRegion } from "@/models/enums";
import { findSpecialization } from "@/lib/wow-specializations";

const REQUEST_TIMEOUT_MS = 15_000;
const CLIENT_TOKEN_SKEW_MS = 60_000;

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

type CachedClientToken = {
  accessToken: string;
  expiresAtMs: number;
};

let cachedClientToken: CachedClientToken | null = null;

function mapHttpError(status: number, context: string): never {
  if (status === 401 || status === 403) {
    throw new DomainError("BATTLENET_AUTH_FAILED", `Battle.net authorization failed (${context}).`, 401);
  }
  if (status === 404) {
    throw new DomainError("BLIZZARD_CHARACTER_NOT_FOUND", `Blizzard resource was not found (${context}).`, 404);
  }
  if (status === 429) {
    throw new DomainError("BATTLENET_RATE_LIMITED", "Battle.net rate limit reached. Try again shortly.", 429);
  }
  throw new DomainError("BATTLENET_API_UNAVAILABLE", `Battle.net API unavailable (${context}).`, 503);
}

async function fetchJson(
  url: string,
  init: RequestInit,
  context: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new DomainError("BATTLENET_API_UNAVAILABLE", `Battle.net request timed out (${context}).`, 503);
  }

  if (!response.ok) {
    mapHttpError(response.status, context);
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new DomainError("BATTLENET_API_UNAVAILABLE", `Battle.net returned invalid JSON (${context}).`, 503);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nameIdKey(value: unknown): { id: number; name: string | null } | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asNumber(record.id);
  if (id === null) return null;
  return { id, name: asString(record.name) };
}

function mapActiveSpecialization(wowClass: WowClass | null, activeSpec: unknown): string | null {
  if (!wowClass) return null;
  const key = nameIdKey(activeSpec);
  if (!key?.name) return null;
  return findSpecialization(wowClass, key.name)?.name ?? null;
}

function mapOwnedCharacters(payload: unknown, region: WowRegion): OwnedBlizzardCharacter[] {
  const root = asRecord(payload);
  const accounts = Array.isArray(root?.wow_accounts) ? root.wow_accounts : [];
  const owned: OwnedBlizzardCharacter[] = [];

  for (const account of accounts) {
    const accountRecord = asRecord(account);
    const characters = Array.isArray(accountRecord?.characters) ? accountRecord.characters : [];
    for (const character of characters) {
      const row = asRecord(character);
      if (!row) continue;

      const id = asNumber(row.id);
      const name = asString(row.name);
      const level = asNumber(row.level) ?? 0;
      const playableClass = nameIdKey(row.playable_class);
      const wowClass = playableClass ? mapPlayableClassId(playableClass.id) : null;
      const realm = asRecord(row.realm);
      const realmId = asNumber(realm?.id);
      const realmName = asString(realm?.name);
      const realmSlug = asString(realm?.slug);

      if (id === null || !name || !wowClass || realmId === null || !realmName || !realmSlug) {
        continue;
      }

      owned.push({
        id: String(id),
        name,
        realmId: String(realmId),
        realmName,
        realmSlug,
        wowClass,
        level,
        region,
      });
    }
  }

  return owned;
}

export const blizzardApiClient = {
  buildAuthorizationUrl(region: WowRegion, state: string): string {
    const config = getBlizzardConfig();
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "wow.profile openid",
      state,
      // Region hints the Battle.net login locale / account picker.
      // OAuth host itself is global; game data remains region-scoped.
    });
    void region;
    return `${blizzardOAuthAuthorizeUrl()}?${params.toString()}`;
  },

  async exchangeAuthorizationCode(code: string): Promise<{ accessToken: string; scope: string | null }> {
    const config = getBlizzardConfig();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    });

    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const payload = await fetchJson(
      blizzardOAuthTokenUrl(),
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
      "token-exchange",
    );

    const record = asRecord(payload);
    const accessToken = asString(record?.access_token);
    if (!accessToken) {
      throw new DomainError("BATTLENET_AUTH_FAILED", "Battle.net token exchange failed.", 401);
    }

    return {
      accessToken,
      scope: asString(record?.scope),
    };
  },

  async getUserInfo(accessToken: string): Promise<{ sub: string; battletag: string | null }> {
    const payload = await fetchJson(
      blizzardOAuthUserInfoUrl(),
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      "userinfo",
    );

    const record = asRecord(payload);
    const sub = asString(record?.sub);
    if (!sub) {
      throw new DomainError("BATTLENET_AUTH_FAILED", "Battle.net user info was incomplete.", 401);
    }

    return {
      sub,
      battletag: asString(record?.battle_tag) ?? asString(record?.battletag),
    };
  },

  async getAccountProfile(accessToken: string, region: WowRegion): Promise<OwnedBlizzardCharacter[]> {
    const url = new URL(`${blizzardApiHost(region)}/profile/user/wow`);
    url.searchParams.set("namespace", blizzardProfileNamespace(region));
    url.searchParams.set("locale", blizzardLocale(region));

    const payload = await fetchJson(
      url.toString(),
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      "account-profile",
    );

    return mapOwnedCharacters(payload, region);
  },

  async getClientCredentialsToken(): Promise<string> {
    if (cachedClientToken && cachedClientToken.expiresAtMs > Date.now() + CLIENT_TOKEN_SKEW_MS) {
      return cachedClientToken.accessToken;
    }

    const config = getBlizzardConfig();
    const body = new URLSearchParams({ grant_type: "client_credentials" });
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

    const payload = (await fetchJson(
      blizzardOAuthTokenUrl(),
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
      "client-credentials",
    )) as TokenResponse;

    const accessToken = asString(payload.access_token);
    const expiresIn = asNumber(payload.expires_in) ?? 0;
    if (!accessToken || expiresIn <= 0) {
      throw new DomainError("BATTLENET_AUTH_FAILED", "Battle.net client credentials failed.", 401);
    }

    cachedClientToken = {
      accessToken,
      expiresAtMs: Date.now() + expiresIn * 1000,
    };

    return accessToken;
  },

  async getCharacterProfileStatus(
    region: WowRegion,
    realmSlug: string,
    name: string,
  ): Promise<BlizzardProfileStatus> {
    const token = await this.getClientCredentialsToken();
    const url = new URL(
      `${blizzardApiHost(region)}/profile/wow/character/${encodeURIComponent(realmSlug)}/${encodeURIComponent(name.toLocaleLowerCase("en-US"))}/status`,
    );
    url.searchParams.set("namespace", blizzardProfileNamespace(region));
    url.searchParams.set("locale", blizzardLocale(region));

    const payload = await fetchJson(
      url.toString(),
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      "character-status",
    );

    const record = asRecord(payload);
    const id = asNumber(record?.id);
    return {
      id: id === null ? "" : String(id),
      isValid: Boolean(record?.is_valid),
    };
  },

  async getCharacterProfileSummary(
    region: WowRegion,
    realmSlug: string,
    name: string,
  ): Promise<BlizzardProfileSummary> {
    const token = await this.getClientCredentialsToken();
    const url = new URL(
      `${blizzardApiHost(region)}/profile/wow/character/${encodeURIComponent(realmSlug)}/${encodeURIComponent(name.toLocaleLowerCase("en-US"))}`,
    );
    url.searchParams.set("namespace", blizzardProfileNamespace(region));
    url.searchParams.set("locale", blizzardLocale(region));

    const payload = await fetchJson(
      url.toString(),
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      "character-summary",
    );

    const record = asRecord(payload);
    if (!record) {
      throw new DomainError("BLIZZARD_PROFILE_UNAVAILABLE", "Character profile was empty.", 502);
    }

    const id = asNumber(record.id);
    const characterName = asString(record.name);
    const characterClass = nameIdKey(record.character_class) ?? nameIdKey(record.playable_class);
    const wowClass = characterClass ? mapPlayableClassId(characterClass.id) : null;
    const realm = asRecord(record.realm);

    return {
      id: id === null ? "" : String(id),
      name: characterName ?? name,
      realmId: asNumber(realm?.id) === null ? null : String(asNumber(realm?.id)),
      realmSlug: asString(realm?.slug),
      realmName: asString(realm?.name),
      wowClass,
      equippedItemLevel: asNumber(record.equipped_item_level),
      activeSpecialization: mapActiveSpecialization(wowClass, record.active_spec),
    };
  },
};
