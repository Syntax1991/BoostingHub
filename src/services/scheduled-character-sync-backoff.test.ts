import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import type { CharacterSyncErrorCode } from "@/models/enums";

const apiMocks = vi.hoisted(() => ({
  buildAuthorizationUrl: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  getUserInfo: vi.fn(),
  getAccountProfile: vi.fn(),
  getClientCredentialsToken: vi.fn(),
  getCharacterProfileStatus: vi.fn(),
  getCharacterProfileSummary: vi.fn(),
  getCharacterRaidEncounters: vi.fn(),
}));
const raiderIoMocks = vi.hoisted(() => ({ getCharacterEquippedItemLevel: vi.fn() }));
vi.mock("@/integrations/blizzard/blizzard-api-client", () => ({ blizzardApiClient: apiMocks }));
vi.mock("@/integrations/raider-io/raider-io-api-client", () => ({ raiderIoApiClient: raiderIoMocks }));

import { battleNetConnectionRepository } from "@/repositories/battle-net-connection.repository";
import { characterRepository } from "@/repositories/character.repository";
import { characterBlizzardSyncService } from "@/services/character-blizzard-sync.service";
import {
  BULK_FORCE_REFRESH_STARTED_EVENT,
  characterOperationsService,
  deriveOperationsRow,
} from "@/services/character-operations.service";
import { characterService } from "@/services/character.service";
import { scheduledCharacterSyncService } from "@/services/scheduled-character-sync.service";

/**
 * Scheduler-only failure backoff: a repeatedly failing Character is not
 * attempted by the scheduler until lastSyncAttemptAt + tier wait, while every
 * manual / admin path ignores it and a success clears it.
 */

const HOUR = 60 * 60_000;
const token = Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 4).padEnd(4, "x");
const userIds: string[] = [];
let owner: AuthenticatedUser;
let admin: AuthenticatedUser;
const fx = {} as Record<"P" | "L" | "R", { id: string; name: string }>;
const PROFILE_IDS = { P: "780001", L: "780002", R: "780003" } as const;

function asUser(id: string, accountRole: AuthenticatedUser["accountRole"]): AuthenticatedUser {
  return {
    id,
    name: `Backoff ${accountRole} ${token}`,
    email: `${id}@sync-backoff.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createUser(accountRole: AuthenticatedUser["accountRole"]) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name: `Backoff ${accountRole} ${token}`,
    email: `${id}@sync-backoff.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
  userIds.push(id);
  return asUser(id, accountRole);
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** Stale for freshness (last success 2 days ago) with the given failure telemetry. */
async function setFailing(key: keyof typeof fx, input: { count: number; code: CharacterSyncErrorCode | null; attemptedAgoMs: number }) {
  await orm.Character.where({ id: fx[key].id }).update({
    lastSyncedAt: ago(48 * HOUR),
    lastSyncAttemptAt: ago(input.attemptedAgoMs),
    lastSyncErrorAt: input.code ? ago(input.attemptedAgoMs) : null,
    lastSyncErrorCode: input.code,
    syncFailureCount: input.count,
  });
}

async function row(key: keyof typeof fx) {
  return (await characterRepository.findById(fx[key].id))!;
}

/** Was this fixture attempted by Blizzard during the last call? */
function attempted(key: keyof typeof fx) {
  return apiMocks.getCharacterProfileStatus.mock.calls.some((call) => String(call[2]).toLowerCase() === fx[key].name.toLowerCase());
}

beforeAll(async () => {
  vi.stubEnv("BLIZZARD_CLIENT_ID", "test-client-id");
  vi.stubEnv("BLIZZARD_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("BLIZZARD_REDIRECT_URI", "http://localhost:3000/api/integrations/battlenet/callback");
  owner = await createUser("USER");
  admin = await createUser("ADMIN");
  await battleNetConnectionRepository.upsert({
    userId: owner.id,
    region: "EU",
    battleNetAccountId: `acct-${owner.id}`,
    battleTag: "Backoff#EU",
    scope: "wow.profile openid",
  });
  for (const key of ["P", "L", "R"] as const) {
    const created = await characterService.createCharacter(owner, {
      name: `Bo${token}${key.toLowerCase()}`,
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 600,
    });
    fx[key] = { id: created.id, name: created.name };
  }
  await orm.Character.where({ id: fx.L.id }).update({ blizzardCharacterId: PROFILE_IDS.L, blizzardRealmId: "1301" });
  await characterRepository.setActive(fx.R.id, false);
});

afterAll(async () => {
  for (const userId of userIds) {
    await orm.BattleNetConnection.where({ userId }).deleteAll();
    await orm.Character.where({ userId }).deleteAll();
    await orm.ActivityEvent.where({ userId }).deleteAll();
    await orm.User.where({ id: userId }).delete();
  }
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  vi.clearAllMocks();
  const byName = new Map((Object.keys(fx) as Array<keyof typeof fx>).map((key) => [fx[key].name.toLowerCase(), PROFILE_IDS[key]]));
  apiMocks.getClientCredentialsToken.mockResolvedValue("client-token");
  apiMocks.getCharacterProfileStatus.mockImplementation(async (_region: string, _realm: string, name: string) => {
    const id = byName.get(name.toLowerCase());
    if (!id) throw new DomainError("BLIZZARD_CHARACTER_NOT_FOUND", "not a backoff fixture", 404);
    return { id, isValid: true };
  });
  apiMocks.getCharacterProfileSummary.mockImplementation(async (_region: string, realmSlug: string, name: string) => ({
    id: byName.get(name.toLowerCase()) ?? "",
    name,
    realmId: "1301",
    realmSlug,
    realmName: "Twisting Nether",
    wowClass: "SHAMAN",
    equippedItemLevel: 650,
    activeSpecialization: "Restoration",
  }));
  apiMocks.getCharacterRaidEncounters.mockRejectedValue(new Error("encounters unavailable"));
  raiderIoMocks.getCharacterEquippedItemLevel.mockResolvedValue({ status: "NOT_FOUND" });
  await setFailing("P", { count: 0, code: null, attemptedAgoMs: 48 * HOUR });
  await setFailing("L", { count: 0, code: null, attemptedAgoMs: 48 * HOUR });
  await setFailing("R", { count: 0, code: null, attemptedAgoMs: 48 * HOUR });
});

describe("scheduler failure backoff", () => {
  it("a backed-off PROFILE_UNAVAILABLE Character is not attempted and counted as skippedBackoff (not failed)", async () => {
    await setFailing("P", { count: 3, code: "PROFILE_UNAVAILABLE", attemptedAgoMs: 30 * 60_000 });
    const before = await row("P");

    const result = await scheduledCharacterSyncService.runOnce();

    expect(attempted("P")).toBe(false);
    expect(result.skippedBackoff).toBeGreaterThanOrEqual(1);
    const after = await row("P");
    expect(after.lastSyncAttemptAt).toBe(before.lastSyncAttemptAt);
    expect(after.syncFailureCount).toBe(3);
    expect(after.lastSyncErrorCode).toBe("PROFILE_UNAVAILABLE");
    // The linked, healthy-but-stale Character was still attempted.
    expect(attempted("L")).toBe(true);
  });

  it("becomes eligible once retryAt has passed; a success resets the counter and removes the backoff", async () => {
    await setFailing("P", { count: 3, code: "PROFILE_UNAVAILABLE", attemptedAgoMs: HOUR + 60_000 });

    await scheduledCharacterSyncService.runOnce();

    expect(attempted("P")).toBe(true);
    expect(await row("P")).toMatchObject({ syncFailureCount: 0, lastSyncErrorCode: null, lastSyncErrorAt: null, blizzardCharacterId: null });
  });

  it("linked Characters use the same backoff semantics (10 failures → 24h)", async () => {
    await setFailing("L", { count: 10, code: "IDENTITY_CONFLICT", attemptedAgoMs: 2 * HOUR });
    await scheduledCharacterSyncService.runOnce();
    expect(attempted("L")).toBe(false);

    vi.clearAllMocks();
    await setFailing("L", { count: 10, code: "IDENTITY_CONFLICT", attemptedAgoMs: 25 * HOUR });
    await scheduledCharacterSyncService.runOnce();
    expect(attempted("L")).toBe(true);
  });

  it("transient UPSTREAM_UNAVAILABLE is capped at 1h even after many failures", async () => {
    await setFailing("P", { count: 40, code: "UPSTREAM_UNAVAILABLE", attemptedAgoMs: 2 * HOUR });
    await scheduledCharacterSyncService.runOnce();
    expect(attempted("P")).toBe(true);
  });

  it("freshness is unchanged: a fresh successful Character is not a candidate; retired stays excluded", async () => {
    await orm.Character.where({ id: fx.P.id }).update({ lastSyncedAt: new Date().toISOString(), lastSyncAttemptAt: new Date().toISOString() });
    await setFailing("R", { count: 0, code: null, attemptedAgoMs: 48 * HOUR });

    await scheduledCharacterSyncService.runOnce();

    expect(attempted("P")).toBe(false);
    expect(attempted("R")).toBe(false);
  });

  it("dry run reports how many stale candidates are in backoff", async () => {
    await setFailing("P", { count: 10, code: "PROFILE_UNAVAILABLE", attemptedAgoMs: HOUR });
    const dry = await scheduledCharacterSyncService.dryRun();
    expect(dry.inBackoff).toBeGreaterThanOrEqual(1);
    expect(apiMocks.getCharacterProfileStatus).not.toHaveBeenCalled();
  });
});

describe("manual paths ignore the scheduler backoff", () => {
  const deepBackoff = () => setFailing("P", { count: 50, code: "PROFILE_UNAVAILABLE", attemptedAgoMs: 2 * 60_000 });

  it("owner Refresh and owner Refresh all", async () => {
    await deepBackoff();
    await characterBlizzardSyncService.refreshCharacter(owner, fx.P.id);
    expect(await row("P")).toMatchObject({ syncFailureCount: 0, lastSyncErrorCode: null });

    await deepBackoff();
    vi.clearAllMocks();
    const outcome = await characterBlizzardSyncService.refreshLinkedCharactersForRegion(owner, "EU");
    expect(attempted("P")).toBe(true);
    expect(outcome.skipped).toBe(0);
  });

  it("admin Sync now, Force refresh and Force refresh all", async () => {
    for (const force of [false, true]) {
      await deepBackoff();
      const result = await characterOperationsService.syncCharacter(admin, { characterId: fx.P.id, force });
      expect(result.status).toBe("SUCCEEDED");
    }

    await deepBackoff();
    vi.clearAllMocks();
    await orm.ActivityEvent.where({ type: BULK_FORCE_REFRESH_STARTED_EVENT }).deleteAll();
    await characterOperationsService.forceRefreshAll(admin);
    expect(attempted("P")).toBe(true);
    await orm.ActivityEvent.where({ type: BULK_FORCE_REFRESH_STARTED_EVENT }).deleteAll();
  });
});

describe("admin projection uses the same helper", () => {
  it("50 failures, last attempt 6h ago → automatic retry in 18h; none after a success", async () => {
    await setFailing("P", { count: 50, code: "PROFILE_UNAVAILABLE", attemptedAgoMs: 6 * HOUR });
    const now = new Date();
    const detail = await characterOperationsService.getDetail(admin, fx.P.id, now);
    expect(detail.row.syncFailureCount).toBe(50);
    expect(detail.row.autoRetryAt).not.toBeNull();
    expect(Math.round(detail.row.autoRetryInMs / HOUR)).toBe(18);

    await setFailing("P", { count: 0, code: null, attemptedAgoMs: 6 * HOUR });
    const recovered = await characterOperationsService.getDetail(admin, fx.P.id, now);
    expect(recovered.row.autoRetryAt).toBeNull();
  });

  it("retired Characters never show an automatic retry", () => {
    const derived = deriveOperationsRow(
      {
        id: "r1",
        userId: "u1",
        name: "Retired",
        realm: "Twisting Nether",
        region: "EU",
        wowClass: "MAGE",
        specialization: null,
        primaryRole: "RANGED_DPS",
        itemLevel: null,
        isActive: false,
        blizzardCharacterId: null,
        blizzardRealmId: null,
        lastSyncedAt: null,
        lastSyncAttemptAt: ago(HOUR),
        lastSyncErrorAt: ago(HOUR),
        lastSyncErrorCode: "PROFILE_UNAVAILABLE",
        syncFailureCount: 50,
        owner: { id: "u1", name: "Owner", discordUsername: null },
        playableSpecs: [],
        currentLockouts: [],
      },
      { ownerHasRegionConnection: false, now: new Date(), staleMinutes: 120 },
    );
    expect(derived.autoRetryAt).toBeNull();
  });
});

describe("fairness: backoff is applied to the COMPLETE stale set (no bounded window to starve)", () => {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let early: Array<{ id: string; name: string }> = [];
  let later: Array<{ id: string; name: string }> = [];
  let retired: { id: string; name: string };

  beforeAll(async () => {
    const make = async (suffix: string) => {
      const created = await characterService.createCharacter(owner, {
        name: `Bf${token}${suffix}`,
        realm: "Twisting Nether",
        region: "EU",
        wowClass: "SHAMAN",
        specialization: "Restoration",
        itemLevel: 600,
      });
      return { id: created.id, name: created.name };
    };
    // 24 backed-off Characters created (and least-recently synced) FIRST, then 8 eligible ones — more than any
    // plausible page of 20, with the eligible rows "behind" the backed-off ones.
    for (let i = 0; i < 24; i += 1) early.push(await make(`a${letters[i]}`));
    for (let i = 0; i < 8; i += 1) later.push(await make(`z${letters[i]}`));
    retired = await make("rr");
    await characterRepository.setActive(retired.id, false);
  });

  afterAll(() => {
    early = [];
    later = [];
  });

  async function stageFairness(laterBackedOff: boolean) {
    for (const [index, character] of early.entries()) {
      await orm.Character.where({ id: character.id }).update({
        lastSyncedAt: ago(96 * HOUR + index * 60_000),
        lastSyncAttemptAt: ago(30 * 60_000),
        lastSyncErrorAt: ago(30 * 60_000),
        lastSyncErrorCode: "PROFILE_UNAVAILABLE",
        syncFailureCount: 12,
      });
    }
    for (const character of later) {
      await orm.Character.where({ id: character.id }).update({
        lastSyncedAt: ago(48 * HOUR),
        lastSyncAttemptAt: ago(laterBackedOff ? 30 * 60_000 : 48 * HOUR),
        lastSyncErrorAt: laterBackedOff ? ago(30 * 60_000) : null,
        lastSyncErrorCode: laterBackedOff ? "PROFILE_UNAVAILABLE" : null,
        syncFailureCount: laterBackedOff ? 12 : 0,
      });
    }
    await orm.Character.where({ id: retired.id }).update({ lastSyncedAt: ago(96 * HOUR), lastSyncErrorCode: null, syncFailureCount: 0 });
  }

  const callsFor = (name: string) =>
    apiMocks.getCharacterProfileStatus.mock.calls.filter((call) => String(call[2]).toLowerCase() === name.toLowerCase()).length;

  it("backed-off early rows never crowd out eligible later rows; each eligible row is attempted exactly once", async () => {
    await stageFairness(false);
    apiMocks.getCharacterProfileStatus.mockImplementation(async (_region: string, _realm: string, name: string) => {
      if (later.some((character) => character.name.toLowerCase() === name.toLowerCase())) return { id: "", isValid: true };
      throw new DomainError("BLIZZARD_CHARACTER_NOT_FOUND", "not a fairness fixture", 404);
    });
    const listSpy = vi.spyOn(characterRepository, "listScheduledSyncCandidates");

    const result = await scheduledCharacterSyncService.runOnce();

    expect(listSpy).toHaveBeenCalledTimes(1); // one query, no paging loop
    listSpy.mockRestore();
    for (const character of later) expect(callsFor(character.name)).toBe(1);
    for (const character of early) expect(callsFor(character.name)).toBe(0);
    expect(callsFor(retired.name)).toBe(0);
    expect(result.skippedBackoff).toBeGreaterThanOrEqual(early.length);
    expect(result.status).toBe("COMPLETED");
  });

  it("a run where every stale candidate is backed off makes no Blizzard calls and exits cleanly", async () => {
    await stageFairness(true);
    // Park every OTHER active Character of the shared test DB as fresh for this run, then restore it.
    const fixtureIds = new Set([...early, ...later, retired, ...Object.values(fx)].map((character) => character.id));
    const others = ((await orm.Character.where({ isActive: true }).select("id", "lastSyncedAt").all()) as Array<{
      id: string;
      lastSyncedAt: string | null;
    }>).filter((character) => !fixtureIds.has(character.id));
    for (const key of ["P", "L"] as const) {
      await orm.Character.where({ id: fx[key].id }).update({ lastSyncedAt: new Date().toISOString() });
    }
    const freshAt = new Date().toISOString();
    for (const character of others) await orm.Character.where({ id: character.id }).update({ lastSyncedAt: freshAt });
    try {
      const result = await scheduledCharacterSyncService.runOnce();

      expect(apiMocks.getCharacterProfileStatus).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        status: "COMPLETED",
        totalCandidates: early.length + later.length,
        skippedBackoff: early.length + later.length,
        refreshed: 0,
        failed: 0,
        rateLimited: 0,
        skippedInProgress: 0,
      });
    } finally {
      for (const character of others) {
        await orm.Character.where({ id: character.id }).update({ lastSyncedAt: character.lastSyncedAt });
      }
    }
  });
});
