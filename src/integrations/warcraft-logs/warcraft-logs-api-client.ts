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
/** Report event pages (CombatantInfo carries gear/talents) are much larger than profile lookups. */
const REPORT_REQUEST_TIMEOUT_MS = 45_000;
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
    reportData?: {
      report?: Record<string, unknown> | null;
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
  $zoneID: Int
  $difficulty: Int
  $metric: CharacterPageRankingMetricType
  $specName: String
  $role: RoleType
) {
  characterData {
    character(id: $id) {
      zoneRankings(
        zoneID: $zoneID
        difficulty: $difficulty
        metric: $metric
        specName: $specName
        role: $role
      )
    }
  }
}
`.trim();

/** Single-boss rankings (e.g. Nymrissa). Returns JSON — no sub-selection. */
const ENCOUNTER_RANKINGS_QUERY = `
query EncounterRankings(
  $id: Int!
  $encounterID: Int!
  $difficulty: Int
  $metric: CharacterRankingMetricType
  $specName: String
  $role: RoleType
) {
  characterData {
    character(id: $id) {
      encounterRankings(
        encounterID: $encounterID
        difficulty: $difficulty
        metric: $metric
        specName: $specName
        role: $role
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

async function fetchJson(
  url: string,
  init: RequestInit,
  context: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
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

/** Map GraphQL zoneRankings JSON payload — null averages mean no usable logs. */
export function mapZoneRankings(raw: unknown): WarcraftLogsZoneRankings | null {
  const record = asRecord(raw);
  if (!record) return null;
  if (typeof record.error === "string" && record.error.trim()) return null;
  return {
    bestPerformanceAverage: asFiniteNumber(record.bestPerformanceAverage),
    medianPerformanceAverage: asFiniteNumber(record.medianPerformanceAverage),
  };
}

/**
 * Map encounterRankings JSON into the same Best/Avg shape used for zone rankings.
 * Best = highest parse rankPercent; Avg = WCL medianPerformance.
 */
export function mapEncounterRankings(raw: unknown): WarcraftLogsZoneRankings | null {
  const record = asRecord(raw);
  if (!record) return null;
  if (typeof record.error === "string" && record.error.trim()) return null;

  const ranks = Array.isArray(record.ranks) ? record.ranks : [];
  let bestFromRanks: number | null = null;
  for (const row of ranks) {
    const rank = asRecord(row);
    const pct = asFiniteNumber(rank?.rankPercent);
    if (pct == null) continue;
    if (bestFromRanks == null || pct > bestFromRanks) bestFromRanks = pct;
  }

  const median = asFiniteNumber(record.medianPerformance);
  const average = asFiniteNumber(record.averagePerformance);
  return {
    bestPerformanceAverage: bestFromRanks ?? average,
    medianPerformanceAverage: median ?? average,
  };
}

async function postGraphql(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
  context: string,
  timeoutMs?: number,
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
    timeoutMs,
  );
  return payload as GraphqlResponse;
}

export type WarcraftLogsReportFight = {
  id: number;
  encounterId: number;
  name: string;
  /** Report-relative milliseconds. */
  startTime: number;
  endTime: number;
  kill: boolean;
  /** 3 Normal, 4 Heroic, 5 Mythic; null when WCL omits it. */
  difficulty: number | null;
  /** Report actor ids of friendly players; null when WCL omits the list. */
  friendlyPlayers: number[] | null;
};

export type WarcraftLogsReportActor = {
  id: number;
  name: string;
  server: string | null;
  /** Class name as WCL spells it, e.g. "Warlock", "DeathKnight". */
  subType: string | null;
};

export type WarcraftLogsRankedCharacter = {
  id: string;
  canonicalId: string;
  name: string;
  serverSlug: string | null;
};

export type WarcraftLogsReportMetadata = {
  code: string;
  title: string | null;
  /** Epoch milliseconds. */
  startTime: number;
  endTime: number;
  /** Uppercase WCL region slug ("EU", "US"), null when absent. */
  regionSlug: string | null;
  fights: WarcraftLogsReportFight[];
  actors: WarcraftLogsReportActor[];
  rankedCharacters: WarcraftLogsRankedCharacter[];
};

export type WarcraftLogsReportMetadataResult =
  | { status: "SUCCESS"; report: WarcraftLogsReportMetadata }
  | { status: "NOT_FOUND" }
  | { status: "NOT_CONFIGURED" }
  | { status: "TEMPORARY_FAILURE"; message: string };

/** Minimal projection of one WCL event — everything else is dropped on receipt. */
/** `fight` is null for a cast outside any fight (e.g. a pre-pull potion). */
export type WarcraftLogsCastEvent = { fight: number | null; timestamp: number; sourceId: number; abilityId: number };
export type WarcraftLogsDeathEvent = { fight: number; timestamp: number; targetId: number };
/** One equipped item in a CombatantInfo snapshot; `slot` is its position in the gear array. */
export type WarcraftLogsGearItem = {
  slot: number;
  itemId: number;
  permanentEnchantId: number | null;
  temporaryEnchantId: number | null;
  gemIds: number[];
  bonusIds: number[];
};

/** CombatantInfo snapshot at pull, reduced to auras (ids + names) and equipped gear. */
export type WarcraftLogsCombatantSnapshot = {
  fight: number;
  timestamp: number;
  sourceId: number;
  auraIds: number[];
  /** Aura id → in-game name (food / Vantus buffs are recognized by name). */
  auraNames?: Record<number, string>;
  /** Equipped items; absent when the log carried no gear for this snapshot. */
  gear?: WarcraftLogsGearItem[];
};

export type WarcraftLogsConsumableEvents = {
  casts: WarcraftLogsCastEvent[];
  deaths: WarcraftLogsDeathEvent[];
  combatants: WarcraftLogsCombatantSnapshot[];
};

export type WarcraftLogsConsumableEventsResult =
  | { status: "SUCCESS"; events: WarcraftLogsConsumableEvents }
  | { status: "NOT_FOUND" }
  | { status: "NOT_CONFIGURED" }
  | { status: "TEMPORARY_FAILURE"; message: string };

const REPORT_METADATA_QUERY = `
query ReportMetadata($code: String!) {
  reportData {
    report(code: $code) {
      code
      title
      startTime
      endTime
      region { slug }
      fights(killType: Encounters) {
        id
        encounterID
        name
        startTime
        endTime
        kill
        difficulty
        friendlyPlayers
      }
      masterData {
        actors(type: "Player") { id name server subType }
      }
      rankedCharacters { id canonicalID name server { slug } }
    }
  }
}
`.trim();

type EventStream = "casts" | "deaths" | "combatants";

/** Hard ceiling per stream — a boss-only report never needs this many pages. */
const MAX_EVENT_PAGES_PER_STREAM = 25;
const EVENTS_PAGE_LIMIT = 10_000;

function eventStreamSelection(stream: EventStream, castFilter: string): string {
  const common = `fightIDs: $fightIds, startTime: $${stream}Start, endTime: $endTime, limit: ${EVENTS_PAGE_LIMIT}`;
  switch (stream) {
    case "casts":
      // Time-window only (no fightIDs) so pre-pull uses just before a pull are
      // included; the catalog filter keeps this stream small.
      return `casts: events(dataType: Casts, hostilityType: Friendlies, startTime: $castsStart, endTime: $endTime, limit: ${EVENTS_PAGE_LIMIT}, filterExpression: "${castFilter}") { data nextPageTimestamp }`;
    case "deaths":
      return `deaths: events(dataType: Deaths, hostilityType: Friendlies, ${common}) { data nextPageTimestamp }`;
    case "combatants":
      return `combatants: events(dataType: CombatantInfo, ${common}) { data nextPageTimestamp }`;
  }
}

/**
 * One GraphQL request fetching every still-pending event stream as aliases.
 * The first request covers all three streams; follow-ups only re-request the
 * streams that returned a `nextPageTimestamp`.
 */
export function buildConsumableEventsQuery(streams: EventStream[], castSpellIds: number[]): string {
  const castFilter = `ability.id in (${castSpellIds.map((id) => Math.trunc(id)).join(", ")})`;
  // GraphQL rejects declared-but-unused variables, so $fightIds is only
  // declared when a fight-scoped stream is still being paged.
  const vars = [
    "$code: String!",
    "$endTime: Float!",
    ...(streams.some((stream) => stream !== "casts") ? ["$fightIds: [Int]!"] : []),
    ...streams.map((stream) => `$${stream}Start: Float!`),
  ].join(", ");
  return `
query ReportConsumableEvents(${vars}) {
  reportData {
    report(code: $code) {
      ${streams.map((stream) => eventStreamSelection(stream, castFilter)).join("\n      ")}
    }
  }
}
`.trim();
}

function asInt(value: unknown): number | null {
  const parsed = asFiniteNumber(value);
  return parsed == null ? null : Math.trunc(parsed);
}

export function mapReportMetadata(raw: Record<string, unknown>): WarcraftLogsReportMetadata | null {
  const code = asString(raw.code);
  const startTime = asFiniteNumber(raw.startTime);
  const endTime = asFiniteNumber(raw.endTime);
  if (!code || startTime == null || endTime == null) return null;

  const fights: WarcraftLogsReportFight[] = [];
  for (const row of Array.isArray(raw.fights) ? raw.fights : []) {
    const fight = asRecord(row);
    const id = asInt(fight?.id);
    const encounterId = asInt(fight?.encounterID);
    const start = asInt(fight?.startTime);
    const end = asInt(fight?.endTime);
    if (!fight || id == null || encounterId == null || encounterId <= 0 || start == null || end == null) continue;
    fights.push({
      id,
      encounterId,
      name: asString(fight.name) ?? `Encounter ${encounterId}`,
      startTime: start,
      endTime: end,
      kill: fight.kill === true,
      difficulty: asInt(fight.difficulty),
      friendlyPlayers: Array.isArray(fight.friendlyPlayers)
        ? fight.friendlyPlayers.map(asInt).filter((value): value is number => value != null)
        : null,
    });
  }

  const masterData = asRecord(raw.masterData);
  const actors: WarcraftLogsReportActor[] = [];
  for (const row of Array.isArray(masterData?.actors) ? masterData.actors : []) {
    const actor = asRecord(row);
    const id = asInt(actor?.id);
    const name = asString(actor?.name);
    if (!actor || id == null || !name) continue;
    actors.push({ id, name, server: asString(actor.server), subType: asString(actor.subType) });
  }

  const rankedCharacters: WarcraftLogsRankedCharacter[] = [];
  for (const row of Array.isArray(raw.rankedCharacters) ? raw.rankedCharacters : []) {
    const character = asRecord(row);
    const id = asString(character?.id);
    const name = asString(character?.name);
    if (!character || !id || !name) continue;
    rankedCharacters.push({
      id,
      canonicalId: asString(character.canonicalID) ?? id,
      name,
      serverSlug: asString(asRecord(character.server)?.slug),
    });
  }

  return {
    code,
    title: asString(raw.title),
    startTime,
    endTime,
    regionSlug: asString(asRecord(raw.region)?.slug)?.toUpperCase() ?? null,
    fights,
    actors,
    rankedCharacters,
  };
}

function mapEventPage(stream: EventStream, rows: unknown[], into: WarcraftLogsConsumableEvents): void {
  for (const row of rows) {
    const event = asRecord(row);
    const fight = asInt(event?.fight);
    const timestamp = asInt(event?.timestamp);
    if (!event || timestamp == null) continue;
    if (stream === "casts") {
      const sourceId = asInt(event.sourceID);
      const abilityId = asInt(event.abilityGameID);
      // "begincast" precedes a cast-time use; only the completed cast counts.
      if (event.type !== "cast" || sourceId == null || abilityId == null) continue;
      into.casts.push({ fight, timestamp, sourceId, abilityId });
    } else if (stream === "deaths") {
      const targetId = asInt(event.targetID);
      if (event.type !== "death" || fight == null || targetId == null) continue;
      into.deaths.push({ fight, timestamp, targetId });
    } else {
      const sourceId = asInt(event.sourceID);
      if (event.type !== "combatantinfo" || fight == null || sourceId == null) continue;
      const auraIds: number[] = [];
      const auraNames: Record<number, string> = {};
      for (const aura of Array.isArray(event.auras) ? event.auras : []) {
        const id = asInt(asRecord(aura)?.ability);
        if (id == null) continue;
        auraIds.push(id);
        const name = asString(asRecord(aura)?.name);
        if (name) auraNames[id] = name;
      }
      into.combatants.push({ fight, timestamp, sourceId, auraIds, auraNames, gear: mapGear(event.gear) });
    }
  }
}

/** CombatantInfo `gear`: position = equipment slot; empty slots (id 0) are skipped. */
function mapGear(value: unknown): WarcraftLogsGearItem[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const ids = (list: unknown, key?: string) =>
    (Array.isArray(list) ? list : [])
      .map((entry) => asInt(key ? asRecord(entry)?.[key] : entry))
      .filter((id): id is number => id != null && id > 0);
  const gear: WarcraftLogsGearItem[] = [];
  value.forEach((entry, slot) => {
    const item = asRecord(entry);
    const itemId = asInt(item?.id);
    if (!item || itemId == null || itemId <= 0) return;
    const permanent = asInt(item.permanentEnchant);
    const temporary = asInt(item.temporaryEnchant);
    gear.push({
      slot,
      itemId,
      permanentEnchantId: permanent && permanent > 0 ? permanent : null,
      temporaryEnchantId: temporary && temporary > 0 ? temporary : null,
      gemIds: ids(item.gems, "id"),
      bonusIds: ids(item.bonusIDs),
    });
  });
  return gear;
}

function graphqlErrorMessage(root: GraphqlResponse): string | null {
  if (!Array.isArray(root.errors) || root.errors.length === 0) return null;
  return root.errors.map((row) => row.message).filter(Boolean).join("; ") || "GraphQL error";
}

/** WCL answers a private/unknown report code with an error and a null report. */
function isMissingReportError(message: string): boolean {
  return /does not exist|private|not found|permission/i.test(message);
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
   *
   * WCL quirks:
   * - `zoneRankings` is a JSON scalar (`CharacterPageRankingMetricType`), no sub-selection.
   * - Single-boss lairs use `encounterRankings` (`CharacterRankingMetricType` + encounterID).
   */
  async fetchZoneRankings(input: {
    warcraftLogsId: string;
    zoneId: number;
    difficulty: number;
    metric: WarcraftLogsRankingMetric;
    role?: WarcraftLogsRankingRole;
    specName?: string;
    /** When set, uses encounterRankings for this boss (e.g. Nymrissa). */
    encounterId?: number;
  }): Promise<WarcraftLogsZoneRankingsResult> {
    if (!isWarcraftLogsConfigured()) {
      return { status: "NOT_CONFIGURED" };
    }

    const characterId = Number.parseInt(input.warcraftLogsId.trim(), 10);
    if (!Number.isFinite(characterId) || characterId <= 0) {
      return { status: "NOT_FOUND" };
    }

    const useEncounter = input.encounterId != null && input.encounterId > 0;

    try {
      const accessToken = await getAccessToken();
      const root = await postGraphql(
        accessToken,
        useEncounter ? ENCOUNTER_RANKINGS_QUERY : ZONE_RANKINGS_QUERY,
        useEncounter
          ? {
              id: characterId,
              encounterID: input.encounterId,
              difficulty: input.difficulty,
              metric: input.metric,
              specName: input.specName?.trim() || null,
              role: input.role ?? null,
            }
          : {
              id: characterId,
              zoneID: input.zoneId,
              difficulty: input.difficulty,
              metric: input.metric,
              specName: input.specName?.trim() || null,
              role: input.role ?? null,
            },
        useEncounter ? "graphql-encounter-rankings" : "graphql-zone-rankings",
      );

      if (Array.isArray(root.errors) && root.errors.length > 0) {
        const message = root.errors.map((row) => row.message).filter(Boolean).join("; ") || "GraphQL error";
        return { status: "TEMPORARY_FAILURE", message };
      }

      const characterRaw = root.data?.characterData?.character ?? null;
      if (!characterRaw) {
        return { status: "NOT_FOUND" };
      }

      const rankings = useEncounter
        ? mapEncounterRankings(characterRaw.encounterRankings)
        : mapZoneRankings(characterRaw.zoneRankings);
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
  /**
   * Report header, boss fights (kills and wipes), player actors and ranked
   * characters in ONE request. Never throws for business outcomes.
   */
  async fetchReportMetadata(code: string): Promise<WarcraftLogsReportMetadataResult> {
    if (!isWarcraftLogsConfigured()) {
      return { status: "NOT_CONFIGURED" };
    }
    try {
      const accessToken = await getAccessToken();
      const root = await postGraphql(
        accessToken,
        REPORT_METADATA_QUERY,
        { code },
        "graphql-report-metadata",
        REPORT_REQUEST_TIMEOUT_MS,
      );
      const reportRaw = root.data?.reportData?.report ?? null;
      const errorMessage = graphqlErrorMessage(root);
      if (!reportRaw) {
        if (!errorMessage || isMissingReportError(errorMessage)) return { status: "NOT_FOUND" };
        return { status: "TEMPORARY_FAILURE", message: errorMessage };
      }
      if (errorMessage) {
        return { status: "TEMPORARY_FAILURE", message: errorMessage };
      }
      const report = mapReportMetadata(reportRaw);
      if (!report) {
        return { status: "TEMPORARY_FAILURE", message: "Warcraft Logs report payload was malformed." };
      }
      return { status: "SUCCESS", report };
    } catch (error) {
      return {
        status: "TEMPORARY_FAILURE",
        message: error instanceof Error ? error.message : "Warcraft Logs request failed.",
      };
    }
  },

  /**
   * Casts (filtered server-side to `castSpellIds`), friendly deaths and
   * CombatantInfo snapshots for the given fights. All three streams share one
   * request; only a stream with more pages triggers a follow-up request.
   * Never one request per player or per death.
   */
  async fetchReportConsumableEvents(input: {
    code: string;
    fightIds: number[];
    /** Report-relative ms covering every requested fight. */
    startTime: number;
    endTime: number;
    castSpellIds: number[];
    /** Casts are fetched from this long before `startTime` (pre-pull uses). */
    castLeadMs?: number;
  }): Promise<WarcraftLogsConsumableEventsResult> {
    if (!isWarcraftLogsConfigured()) {
      return { status: "NOT_CONFIGURED" };
    }
    const events: WarcraftLogsConsumableEvents = { casts: [], deaths: [], combatants: [] };
    if (input.fightIds.length === 0 || input.castSpellIds.length === 0) {
      return { status: "SUCCESS", events };
    }

    const cursor: Partial<Record<EventStream, number>> = {
      casts: Math.max(0, input.startTime - (input.castLeadMs ?? 0)),
      deaths: input.startTime,
      combatants: input.startTime,
    };
    const pages: Record<EventStream, number> = { casts: 0, deaths: 0, combatants: 0 };

    try {
      const accessToken = await getAccessToken();
      while (Object.keys(cursor).length > 0) {
        const streams = Object.keys(cursor) as EventStream[];
        const variables: Record<string, unknown> = { code: input.code, endTime: input.endTime };
        if (streams.some((stream) => stream !== "casts")) variables.fightIds = input.fightIds;
        for (const stream of streams) variables[`${stream}Start`] = cursor[stream];

        const root = await postGraphql(
          accessToken,
          buildConsumableEventsQuery(streams, input.castSpellIds),
          variables,
          "graphql-report-events",
          REPORT_REQUEST_TIMEOUT_MS,
        );
        const reportRaw = root.data?.reportData?.report ?? null;
        const errorMessage = graphqlErrorMessage(root);
        if (!reportRaw) {
          if (!errorMessage || isMissingReportError(errorMessage)) return { status: "NOT_FOUND" };
          return { status: "TEMPORARY_FAILURE", message: errorMessage };
        }
        if (errorMessage) {
          return { status: "TEMPORARY_FAILURE", message: errorMessage };
        }

        for (const stream of streams) {
          const page = asRecord(reportRaw[stream]);
          mapEventPage(stream, Array.isArray(page?.data) ? page.data : [], events);
          pages[stream] += 1;
          const next = asFiniteNumber(page?.nextPageTimestamp);
          if (next != null && next > (cursor[stream] ?? 0) && next < input.endTime) {
            if (pages[stream] >= MAX_EVENT_PAGES_PER_STREAM) {
              return { status: "TEMPORARY_FAILURE", message: "Warcraft Logs report is too large to analyze." };
            }
            cursor[stream] = next;
          } else {
            delete cursor[stream];
          }
        }
      }
      return { status: "SUCCESS", events };
    } catch (error) {
      return {
        status: "TEMPORARY_FAILURE",
        message: error instanceof Error ? error.message : "Warcraft Logs request failed.",
      };
    }
  },
};
