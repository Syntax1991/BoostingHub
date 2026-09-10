/**
 * One-off QA diagnostic: sanitized Character Raid Encounters for lockout mapping.
 * Never prints secrets or tokens.
 *
 * Usage: npx tsx --env-file=.env scripts/diagnose-raid-encounters.ts
 */
import {
  getRegionalWeeklyReset,
  isTimestampInRegionalReset,
} from "../src/lib/wow-weekly-reset";

const REGION = "EU" as const;
const REALM = "antonidas";
const CHARACTERS = ["synblast", "synbloom"] as const;

const NAME_HINTS = [
  "venomous",
  "giftige",
  "abyss",
  "abgrund",
  "manaforge",
  "omega",
  "tidebound",
  "grotto",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nameId(value: unknown): { id: number | null; name: string | null } {
  const record = asRecord(value);
  return {
    id: asNumber(record?.id),
    name: asString(record?.name),
  };
}

async function clientCredentialsToken(clientId: string, clientSecret: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
  });
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`token exchange failed: HTTP ${response.status}`);
  }
  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("token exchange returned no access_token");
  }
  return json.access_token;
}

async function fetchEncounters(token: string, characterName: string): Promise<unknown> {
  const url = new URL(
    `https://eu.api.blizzard.com/profile/wow/character/${REALM}/${characterName}/encounters/raids`,
  );
  url.searchParams.set("namespace", "profile-eu");
  url.searchParams.set("locale", "en_GB");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`encounters HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

function interestingInstance(name: string | null): boolean {
  if (!name) return false;
  const n = name.toLocaleLowerCase("en-US");
  return NAME_HINTS.some((hint) => n.includes(hint));
}

function sanitizePayload(payload: unknown, resetStart: Date, resetEnd: Date) {
  const root = asRecord(payload);
  const expansions = Array.isArray(root?.expansions) ? root.expansions : [];
  const matches: unknown[] = [];

  for (const expansion of expansions) {
    const expansionRecord = asRecord(expansion);
    const instances = Array.isArray(expansionRecord?.instances) ? expansionRecord.instances : [];
    for (const instance of instances) {
      const instanceRecord = asRecord(instance);
      const instanceKey = nameId(instanceRecord?.instance);
      if (!interestingInstance(instanceKey.name) && instanceKey.id !== 1296) continue;

      const modes = Array.isArray(instanceRecord?.modes) ? instanceRecord.modes : [];
      const sanitizedModes = modes.map((mode) => {
        const modeRecord = asRecord(mode);
        const difficulty = asRecord(modeRecord?.difficulty);
        const progress = asRecord(modeRecord?.progress);
        const encountersRaw = Array.isArray(progress?.encounters) ? progress.encounters : [];
        return {
          difficultyName: asString(difficulty?.name),
          difficultyType: asString(difficulty?.type),
          difficultyId: asNumber(difficulty?.id),
          progressCompleted: asNumber(progress?.completed_count),
          progressTotal: asNumber(progress?.total_count),
          encounters: encountersRaw.map((row) => {
            const encounterRecord = asRecord(row);
            const encounter = nameId(encounterRecord?.encounter);
            const lastKill = asNumber(encounterRecord?.last_kill_timestamp);
            return {
              encounterId: encounter.id,
              encounterName: encounter.name,
              completedCount: asNumber(encounterRecord?.completed_count),
              lastKillTimestampMs: lastKill,
              lastKillUtc: lastKill != null ? new Date(lastKill).toISOString() : null,
              inCurrentReset:
                lastKill != null &&
                isTimestampInRegionalReset(lastKill, { start: resetStart, end: resetEnd }),
            };
          }),
        };
      });

      matches.push({
        instanceId: instanceKey.id,
        instanceName: instanceKey.name,
        modes: sanitizedModes,
      });
    }
  }

  return matches;
}

async function main() {
  const clientId = process.env.BLIZZARD_CLIENT_ID?.trim();
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    console.error("BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET missing from env");
    process.exit(1);
  }

  const reset = getRegionalWeeklyReset(REGION);
  console.log(
    JSON.stringify(
      {
        region: REGION,
        resetStartUtc: reset.start.toISOString(),
        resetEndUtc: reset.end.toISOString(),
        resetIdentifier: reset.resetIdentifier,
        catalogBeforeFix: "Manaforge Omega (blizzardInstanceId 1296) — only current catalog entry",
      },
      null,
      2,
    ),
  );

  const token = await clientCredentialsToken(clientId, clientSecret);
  // Token never logged.

  for (const character of CHARACTERS) {
    try {
      const payload = await fetchEncounters(token, character);
      const matches = sanitizePayload(payload, reset.start, reset.end);
      console.log(
        JSON.stringify(
          {
            character: `${character}-antonidas-EU`,
            matchingRaids: matches,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.log(
        JSON.stringify(
          {
            character: `${character}-antonidas-EU`,
            error: error instanceof Error ? error.message : String(error),
          },
          null,
          2,
        ),
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
