/**
 * Live QA: derive lockouts for configured QA characters. Never prints secrets.
 * Usage: npx tsx --env-file=.env scripts/qa-lockout-derive.ts
 */
import { deriveCurrentResetLockouts } from "../src/lib/blizzard/raid-lockout-derivation";
import { formatCompactLockoutProgress } from "../src/lib/lockout-display";
import { getCurrentLockoutRaid } from "../src/lib/wow-raid-catalog";
import { getRegionalWeeklyReset } from "../src/lib/wow-weekly-reset";
import { mapBlizzardRaidDifficulty } from "../src/lib/blizzard/raid-difficulty";
import type { BlizzardCharacterRaidEncounters } from "../src/lib/blizzard/types";

const REGION = "EU" as const;
const REALM = "antonidas";
const CHARACTERS = ["synblast", "synbloom"] as const;

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
  return { id: asNumber(record?.id), name: asString(record?.name) };
}

async function token(clientId: string, clientSecret: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!response.ok) throw new Error(`token HTTP ${response.status}`);
  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("no access_token");
  return json.access_token;
}

function mapPayload(payload: unknown): BlizzardCharacterRaidEncounters {
  const root = asRecord(payload);
  const expansions = Array.isArray(root?.expansions) ? root.expansions : [];
  const raids: BlizzardCharacterRaidEncounters["raids"] = [];
  for (const expansion of expansions) {
    const instances = Array.isArray(asRecord(expansion)?.instances)
      ? (asRecord(expansion)!.instances as unknown[])
      : [];
    for (const instance of instances) {
      const instanceRecord = asRecord(instance);
      const instanceKey = nameId(instanceRecord?.instance);
      if (instanceKey.id == null) continue;
      const modes = Array.isArray(instanceRecord?.modes) ? instanceRecord!.modes : [];
      const difficulties = [];
      for (const mode of modes) {
        const modeRecord = asRecord(mode);
        const difficultyType = asString(asRecord(modeRecord?.difficulty)?.type);
        const mapped = mapBlizzardRaidDifficulty(difficultyType);
        if (!mapped) continue;
        const progress = asRecord(modeRecord?.progress);
        const encountersRaw = Array.isArray(progress?.encounters) ? progress!.encounters : [];
        difficulties.push({
          difficulty: mapped,
          progressCompleted: asNumber(progress?.completed_count) ?? 0,
          progressTotal: asNumber(progress?.total_count) ?? 0,
          encounters: encountersRaw.flatMap((row) => {
            const encounterRecord = asRecord(row);
            const encounter = nameId(encounterRecord?.encounter);
            if (encounter.id == null) return [];
            return [
              {
                encounterId: String(encounter.id),
                encounterName: encounter.name ?? `Encounter ${encounter.id}`,
                completedCount: asNumber(encounterRecord?.completed_count) ?? 0,
                lastKillTimestampMs: asNumber(encounterRecord?.last_kill_timestamp),
              },
            ];
          }),
        });
      }
      raids.push({
        instanceId: String(instanceKey.id),
        instanceName: instanceKey.name ?? `Instance ${instanceKey.id}`,
        difficulties,
      });
    }
  }
  return { raids };
}

async function main() {
  const clientId = process.env.BLIZZARD_CLIENT_ID?.trim();
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    console.error("missing blizzard env");
    process.exit(1);
  }
  const current = getCurrentLockoutRaid()!;
  const reset = getRegionalWeeklyReset(REGION);
  console.log(
    JSON.stringify(
      {
        currentRaid: current.name,
        blizzardInstanceId: current.blizzardInstanceId,
        resetStartUtc: reset.start.toISOString(),
        resetEndUtc: reset.end.toISOString(),
        resetIdentifier: reset.resetIdentifier,
      },
      null,
      2,
    ),
  );

  const accessToken = await token(clientId, clientSecret);
  for (const character of CHARACTERS) {
    const url = new URL(
      `https://eu.api.blizzard.com/profile/wow/character/${REALM}/${character}/encounters/raids`,
    );
    url.searchParams.set("namespace", "profile-eu");
    url.searchParams.set("locale", "en_GB");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      console.log(JSON.stringify({ character, error: `HTTP ${response.status}` }));
      continue;
    }
    const encounters = mapPayload(await response.json());
    const derived = deriveCurrentResetLockouts({ region: REGION, encounters, resetWindow: reset });
    const currentRaidPayload = encounters.raids.find(
      (raid) => Number(raid.instanceId) === current.blizzardInstanceId,
    );
    const byDiff = Object.fromEntries(
      (derived.status === "derived" ? derived.difficulties : []).map((row) => [
        row.difficulty,
        `${row.bossesDefeated}/${row.bossTotal}`,
      ]),
    );
    console.log(
      JSON.stringify(
        {
          character: `${character}-antonidas-EU`,
          currentRaidFound: Boolean(currentRaidPayload),
          blizzardInstanceId: currentRaidPayload?.instanceId ?? null,
          modesPresent: currentRaidPayload?.difficulties.map((mode) => mode.difficulty) ?? [],
          derivedStatus: derived.status,
          compact: derived.status === "derived" ? formatCompactLockoutProgress(derived.difficulties) : null,
          byDifficulty: byDiff,
          reason: derived.status === "unknown" ? derived.reason : undefined,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
