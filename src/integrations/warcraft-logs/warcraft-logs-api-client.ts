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

export type WarcraftLogsRankingMetric = "dps" | "hps";
export type WarcraftLogsRankingRole = "Tank" | "Healer" | "DPS";

export type WarcraftLogsZoneRankings = {
  bestPerformanceAverage: number | null;
  medianPerformanceAverage: number | null;
};

export type WarcraftLogsZoneRankingsResult =
  | { status: "SUCCESS"; rankings: WarcraftLogsZoneRankings }
  | { status: "NOT_FOUND" }
  | { status: "NOT_CONFIGURED" }
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

const ZONE_RANKINGS_QUERY = `
query ZoneRankings(
  $id: Int!
  $zoneID: Int!
  $difficulty: Int
  $metric: CharacterRankingMetricType!
  $specName: String
  $role: RoleType
  $encounterID: Int
) {
  characterData {
    character(id: $id) {
      zoneRankings(
        zoneID: $zoneID
        difficulty: $difficulty
        metric: $metric
        specName: $specName
        role: $role
        encounterID: $encounterID
      )
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

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Map GraphQL zoneRankings payload — null averages mean no usable logs. */
export function mapZoneRankings(raw: unknown): WarcraftLogsZoneRankings | null {
  const record = asRecord(raw);
  if (!record) return null;
  return {
    bestPerformanceAverage: asFiniteNumber(record.bestPerformanceAverage),
    medianPerformanceAverage: asFiniteNumber(record.medianPerformanceAverage),
  };
}

async function postGraphql(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
  context: string,
): Promise<GraphqlResponse> {
  const payload = await fetchJson(
    warcraftLogsGraphqlUrl(),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    },
    context,
  );
  return payload as GraphqlResponse;
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
      const root = await postGraphql(
        accessToken,
        FIND_CHARACTER_QUERY,
        { name, serverSlug, serverRegion },
        "graphql-character",
      );

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

  /**
   * Zone (or encounter-scoped) Best/Median performance averages for a Character.
   * Informational only — never throws for missing logs.
   */
  async fetchZoneRankings(input: {
    warcraftLogsId: string;
    zoneId: number;
    difficulty: number;
    metric: WarcraftLogsRankingMetric;
    role?: WarcraftLogsRankingRole;
    specName?: string;
    /** When set, scopes rankings to this encounter within the zone (e.g. Nymrissa). */
    encounterId?: number;
  }): Promise<WarcraftLogsZoneRankingsResult> {
    if (!isWarcraftLogsConfigured()) {
      return { status: "NOT_CONFIGURED" };
    }

    const characterId = Number.parseInt(input.warcraftLogsId.trim(), 10);
    if (!Number.isFinite(characterId) || characterId <= 0) {
      return { status: "NOT_FOUND" };
    }

    try {
      const accessToken = await getAccessToken();
      const root = await postGraphql(
        accessToken,
        ZONE_RANKINGS_QUERY,
        {
          id: characterId,
          zoneID: input.zoneId,
          difficulty: input.difficulty,
          metric: input.metric,
          specName: input.specName?.trim() || null,
          role: input.role ?? null,
          encounterID: input.encounterId && input.encounterId > 0 ? input.encounterId : null,
        },
        "graphql-zone-rankings",
      );

      if (Array.isArray(root.errors) && root.errors.length > 0) {
        const message = root.errors.map((row) => row.message).filter(Boolean).join("; ") || "GraphQL error";
        return { status: "TEMPORARY_FAILURE", message };
      }

      const characterRaw = root.data?.characterData?.character ?? null;
      if (!characterRaw) {
        return { status: "NOT_FOUND" };
      }

      const rankings = mapZoneRankings(characterRaw.zoneRankings);
      if (!rankings) {
        return { status: "NOT_FOUND" };
      }
      if (rankings.bestPerformanceAverage == null && rankings.medianPerformanceAverage == null) {
        return { status: "NOT_FOUND" };
      }
      return { status: "SUCCESS", rankings };
    } catch (error) {
      return {
        status: "TEMPORARY_FAILURE",
        message: error instanceof Error ? error.message : "Warcraft Logs request failed.",
      };
    }
  },
};
