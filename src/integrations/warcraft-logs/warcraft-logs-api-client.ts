import { realmSlugFromDisplayName } from "@/lib/blizzard/character-domain";
import {
  getWarcraftLogsConfigOrNull,
  isWarcraftLogsConfigured,
  toWarcraftLogsServerRegion,
  warcraftLogsGraphqlUrl,
  warcraftLogsOAuthTokenUrl,
} from "@/lib/warcraft-logs/config";
import type { WowRegion } from "@/models/enums";

const REQUEST_TIMEOUT_MS = 15_000;
const CLIENT_TOKEN_SKEW_MS = 60_000;

type CachedClientToken = {
  accessToken: string;
  expiresAtMs: number;
};

let cachedClientToken: CachedClientToken | null = null;
let tokenInFlight: Promise<string> | null = null;

/** Test-only: clear in-memory token state between cases. */
export function resetWarcraftLogsClientTokenCacheForTests(): void {
  cachedClientToken = null;
  tokenInFlight = null;
}

export type WarcraftLogsCharacterIdentity = {
  /** Value suitable for `/character/id/<id>` — prefers WCL `canonicalID`. */
  warcraftLogsId: string;
  id: string;
  canonicalId: string;
  name: string;
  serverSlug: string | null;
  serverRegion: string | null;
};

export type WarcraftLogsFindCharacterResult =
  | { status: "SUCCESS"; character: WarcraftLogsCharacterIdentity }
  | { status: "NOT_FOUND" }
  | { status: "NOT_CONFIGURED" }
  | { status: "UNSUPPORTED_REGION" }
  | { status: "TEMPORARY_FAILURE"; message: string };

type GraphqlResponse = {
  data?: {
    characterData?: {
      character?: Record<string, unknown> | null;
    } | null;
  } | null;
  errors?: Array<{ message?: string }>;
};

const FIND_CHARACTER_QUERY = `
query FindCharacter($name: String!, $serverSlug: String!, $serverRegion: String!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      id
      canonicalID
      name
      server {
        slug
        region {
          slug
        }
      }
    }
  }
}
`.trim();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return null;
}

/**
 * WCL retail server slugs match Blizzard-style hyphenated lowercase names
 * for the realms BoostingHub supports (EU/US). Reuse the shared helper.
 */
export function warcraftLogsServerSlugFromRealm(realm: string): string {
  return realmSlugFromDisplayName(realm);
}

async function fetchJson(url: string, init: RequestInit, context: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error(`Warcraft Logs request failed (${context}).`);
  }

  if (!response.ok) {
    throw new Error(`Warcraft Logs HTTP ${response.status} (${context}).`);
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error(`Warcraft Logs returned invalid JSON (${context}).`);
  }
}

async function requestAccessToken(): Promise<string> {
  const config = getWarcraftLogsConfigOrNull();
  if (!config) {
    throw new Error("Warcraft Logs is not configured.");
  }

  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const payload = await fetchJson(
    warcraftLogsOAuthTokenUrl(),
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    },
    "token",
  );

  const record = asRecord(payload);
  const accessToken = asString(record?.access_token);
  const expiresIn = typeof record?.expires_in === "number" ? record.expires_in : null;
  if (!accessToken || expiresIn === null || expiresIn <= 0) {
    throw new Error("Warcraft Logs token response was incomplete.");
  }

  cachedClientToken = {
    accessToken,
    expiresAtMs: Date.now() + expiresIn * 1000,
  };
  return accessToken;
}

async function getAccessToken(): Promise<string> {
  if (cachedClientToken && cachedClientToken.expiresAtMs > Date.now() + CLIENT_TOKEN_SKEW_MS) {
    return cachedClientToken.accessToken;
  }

  if (tokenInFlight) {
    return tokenInFlight;
  }

  tokenInFlight = requestAccessToken()
    .catch((error) => {
      cachedClientToken = null;
      throw error;
    })
    .finally(() => {
      tokenInFlight = null;
    });

  return tokenInFlight;
}

function mapCharacter(raw: Record<string, unknown>): WarcraftLogsCharacterIdentity | null {
  const id = asString(raw.id);
  const canonicalId = asString(raw.canonicalID) ?? asString(raw.canonicalId);
  const name = asString(raw.name);
  if (!name || (!id && !canonicalId)) {
    return null;
  }

  const server = asRecord(raw.server);
  const region = asRecord(server?.region);
  // Prefer canonicalID for `/character/id/<id>` — WCL documents it as the
  // stable identity that survives rename/transfer and is used in profile URLs.
  const warcraftLogsId = canonicalId ?? id!;
  return {
    warcraftLogsId,
    id: id ?? warcraftLogsId,
    canonicalId: canonicalId ?? warcraftLogsId,
    name,
    serverSlug: asString(server?.slug),
    serverRegion: asString(region?.slug) ?? asString(server?.region),
  };
}

export const warcraftLogsApiClient = {
  isConfigured(): boolean {
    return isWarcraftLogsConfigured();
  },

  /**
   * Public Character identity lookup by name + server slug + region.
   * Never throws for business outcomes — returns typed status results.
   */
  async findCharacter(input: {
    name: string;
    realm: string;
    region: WowRegion;
  }): Promise<WarcraftLogsFindCharacterResult> {
    if (!isWarcraftLogsConfigured()) {
      return { status: "NOT_CONFIGURED" };
    }

    const serverRegion = toWarcraftLogsServerRegion(input.region);
    if (!serverRegion) {
      return { status: "UNSUPPORTED_REGION" };
    }

    const name = input.name.trim();
    const serverSlug = warcraftLogsServerSlugFromRealm(input.realm);
    if (!name || !serverSlug) {
      return { status: "NOT_FOUND" };
    }

    try {
      const accessToken = await getAccessToken();
      const payload = await fetchJson(
        warcraftLogsGraphqlUrl(),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: FIND_CHARACTER_QUERY,
            variables: {
              name,
              serverSlug,
              serverRegion,
            },
          }),
        },
        "graphql-character",
      );

      const root = payload as GraphqlResponse;
      if (Array.isArray(root.errors) && root.errors.length > 0) {
        const message = root.errors.map((row) => row.message).filter(Boolean).join("; ") || "GraphQL error";
        return { status: "TEMPORARY_FAILURE", message };
      }

      const characterRaw = root.data?.characterData?.character ?? null;
      if (!characterRaw) {
        return { status: "NOT_FOUND" };
      }

      const mapped = mapCharacter(characterRaw);
      if (!mapped) {
        return { status: "TEMPORARY_FAILURE", message: "Warcraft Logs character payload was malformed." };
      }
      return { status: "SUCCESS", character: mapped };
    } catch (error) {
      return {
        status: "TEMPORARY_FAILURE",
        message: error instanceof Error ? error.message : "Warcraft Logs request failed.",
      };
    }
  },
};
