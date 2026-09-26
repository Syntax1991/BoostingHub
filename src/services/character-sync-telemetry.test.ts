import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { DomainError, isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { CHARACTER_SYNC_ERROR_CODES, type WowRegion } from "@/models/enums";
import { deriveCharacterSyncHealth } from "@/lib/blizzard/sync-health";
import {
  releaseCharacterSyncLock,
  tryAcquireCharacterSyncLock,
  withCharacterSyncLock,
} from "@/lib/character-sync-lock";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { getCurrentLockoutRaids, VENOMOUS_ABYSS_RAID_ID, WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";

const apiMocks = vi.hoisted(() => ({
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
import { raidRepository } from "@/repositories/raid.repository";
import { characterBlizzardSyncService } from "@/services/character-blizzard-sync.service";
import { scheduledCharacterSyncService } from "@/services/scheduled-character-sync.service";

/**
 * Character sync telemetry (lastSyncAttemptAt / lastSyncErrorAt /
 * lastSyncErrorCode / syncFailureCount), attempt-based manual cooldown, the
 * per-Character advisory lock and the lockout/data invariants around failures.
 */
const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
let ownerId = "";
let owner: AuthenticatedUser;

async function createUser(name: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name,
    email: `${id}@tel.boostting.local`,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
  createdUserIds.push(id);
  return id;
}

async function createLinkedCharacter(name: string, input: { region?: WowRegion; lastSyncedAt?: string | null } = {}) {
  const realm = "Twisting Nether";
  const id = crypto.randomUUID();
  const record = await characterRepository.create({
    id,
    userId: ownerId,
    name,
    realm,
    region: input.region ?? "EU",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity(realm),
    wowClass: "MAGE",
    specialization: "Arcane",
    primaryRole: "DPS",
    itemLevel: 600,
    isActive: true,
    blizzardCharacterId: `bz-${id}`,
    blizzardRealmId: "1301",
    lastSyncedAt: input.lastSyncedAt ?? null,
  });
  // Skip the best-effort WCL network lookup.
  await orm.Character.where({ id }).update({ warcraftLogsId: "wcl-known", updatedAt: new Date().toISOString() });
  createdCharacterIds.push(record.id);
  return record;
}

async function row(id: string) {
  return (await characterRepository.findById(id))!;
}

function mockSuccess(itemLevel = 650) {
  apiMocks.getCharacterProfileStatus.mockResolvedValue({ id: undefined, isValid: true });
  apiMocks.getCharacterProfileSummary.mockImplementation(async (_region: WowRegion, _slug: string, name: string) => ({
    id: undefined,
    name,
    realmId: undefined,
    realmSlug: "twisting-nether",
    realmName: "Twisting Nether",
    wowClass: "MAGE",
    equippedItemLevel: itemLevel,
    activeSpecialization: "Arcane",
  }));
  const reset = getRegionalWeeklyReset("EU");
  const catalog = WOW_RAID_CATALOG.find((raid) => raid.id === VENOMOUS_ABYSS_RAID_ID)!;
  apiMocks.getCharacterRaidEncounters.mockResolvedValue({
    raids: [
      {
        instanceId: String(catalog.blizzardInstanceId),
        instanceName: catalog.name,
        difficulties: [
          {
            difficulty: "HEROIC",
            progressCompleted: 2,
            progressTotal: catalog.bosses.length,
            encounters: catalog.bosses.slice(0, 2).map((boss) => ({
              encounterId: String(boss.blizzardEncounterIds[0]),
              encounterName: boss.name,
              completedCount: 1,
              lastKillTimestampMs: reset.start.getTime() + 3_600_000,
            })),
          },
        ],
      },
    ],
  });
}

function mockStatusFailure(error: unknown) {
  apiMocks.getCharacterProfileStatus.mockRejectedValue(error);
}

/** The 60s manual cooldown now starts on every attempt — move it into the past between refreshes. */
async function expireCooldown(id: string) {
  await orm.Character.where({ id }).update({ lastSyncAttemptAt: new Date(Date.now() - 120_000).toISOString() });
}

async function failOnce(id: string, error: unknown) {
  mockStatusFailure(error);
  await characterBlizzardSyncService.refreshCharacter(owner, id).catch(() => {});
  await expireCooldown(id);
}

beforeAll(async () => {
  vi.stubEnv("BLIZZARD_CLIENT_ID", "test-client-id");
  vi.stubEnv("BLIZZARD_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("BLIZZARD_REDIRECT_URI", "http://localhost:3000/api/integrations/battlenet/callback");
  vi.stubEnv("BLIZZARD_SYNC_STALE_MINUTES", "");
  await raidRepository.ensureReferenceRaids();
  ownerId = await createUser("Telemetry Owner");
  owner = {
    id: ownerId,
    name: "Telemetry Owner",
    email: null,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole: "USER",
    accountStatus: "ACTIVE",
  };
  await battleNetConnectionRepository.upsert({
    userId: ownerId,
    region: "EU",
    battleNetAccountId: `acct-${ownerId}`,
    battleTag: "Tel#1",
    scope: "wow.profile openid",
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  raiderIoMocks.getCharacterEquippedItemLevel.mockResolvedValue({ status: "TEMPORARY_FAILURE", message: "n/a" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const id of createdCharacterIds) {
    await orm.CharacterRaidLockout.where({ characterId: id }).deleteAll();
    await orm.Character.where({ id }).deleteAll();
  }
  for (const id of createdUserIds) {
    await orm.BattleNetConnection.where({ userId: id }).deleteAll();
    await orm.ActivityEvent.where({ userId: id }).deleteAll();
    await orm.User.where({ id }).deleteAll();
  }
  vi.unstubAllEnvs();
});

const now = () => new Date();

describe("telemetry — success, failure, recovery", () => {
  it("a successful attempt records the attempt, the success, and no active error", async () => {
    const character = await createLinkedCharacter("Telok");
    expect(character).toMatchObject({ lastSyncAttemptAt: null, lastSyncErrorAt: null, lastSyncErrorCode: null, syncFailureCount: 0 });
    mockSuccess(655);
    const before = Date.now();
    await characterBlizzardSyncService.refreshCharacter(owner, character.id);
    const after = await row(character.id);
    expect(new Date(after.lastSyncAttemptAt!).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(after.lastSyncedAt).toBeTruthy();
    expect(after).toMatchObject({ lastSyncErrorAt: null, lastSyncErrorCode: null, syncFailureCount: 0, itemLevel: 655 });
    expect(deriveCharacterSyncHealth(after, { now: now(), staleMinutes: 120 })).toBe("HEALTHY");
  });

  it("a failed attempt keeps lastSyncedAt and all Character data, and records a safe category", async () => {
    const lastGood = new Date(Date.now() - 10 * 60_000).toISOString();
    const character = await createLinkedCharacter("Telfail", { lastSyncedAt: lastGood });
    const updatedBefore = (await row(character.id)).updatedAt;
    mockStatusFailure(new DomainError("BATTLENET_API_UNAVAILABLE", "Battle.net API unavailable (character-status).", 503));

    await expect(characterBlizzardSyncService.refreshCharacter(owner, character.id)).rejects.toMatchObject({
      code: "BLIZZARD_SYNC_FAILED",
    });
    const after = await row(character.id);
    expect(after.lastSyncAttemptAt).toBeTruthy();
    expect(new Date(after.lastSyncedAt!).getTime()).toBe(new Date(lastGood).getTime());
    expect(after.lastSyncErrorAt).toBeTruthy();
    expect(after.lastSyncErrorCode).toBe("UPSTREAM_UNAVAILABLE");
    expect(after.syncFailureCount).toBe(1);
    expect(after.itemLevel).toBe(600);
    // Bookkeeping is not a Character data change — "Updated" keeps its value.
    expect(new Date(after.updatedAt).getTime()).toBe(new Date(updatedBefore).getTime());
    // A failure newer than a fresh success is ERROR, never HEALTHY.
    expect(deriveCharacterSyncHealth(after, { now: now(), staleMinutes: 120 })).toBe("ERROR");
  });

  it("consecutive failures count 1 → 2 → 3, then a success resets everything and is HEALTHY again", async () => {
    const character = await createLinkedCharacter("Telcount");
    const upstream = new DomainError("BATTLENET_API_UNAVAILABLE", "Battle.net API unavailable (character-status).", 503);
    await failOnce(character.id, upstream);
    expect((await row(character.id)).syncFailureCount).toBe(1);
    await failOnce(character.id, upstream);
    expect((await row(character.id)).syncFailureCount).toBe(2);
    await failOnce(character.id, new DomainError("BATTLENET_RATE_LIMITED", "Battle.net rate limit reached.", 429));
    const third = await row(character.id);
    expect(third.syncFailureCount).toBe(3);
    expect(third.lastSyncErrorCode).toBe("RATE_LIMITED");
    expect(deriveCharacterSyncHealth(third, { now: now(), staleMinutes: 120 })).toBe("ERROR");

    mockSuccess(702);
    await characterBlizzardSyncService.refreshCharacter(owner, character.id);
    const recovered = await row(character.id);
    expect(recovered).toMatchObject({ lastSyncErrorAt: null, lastSyncErrorCode: null, syncFailureCount: 0, itemLevel: 702 });
    expect(recovered.lastSyncedAt).toBeTruthy();
    expect(deriveCharacterSyncHealth(recovered, { now: now(), staleMinutes: 120 })).toBe("HEALTHY");
  });
});

describe("safe error categories, end to end", () => {
  const cases: Array<[string, () => void, string]> = [
    ["404 / profile absence", () => mockStatusFailure(new DomainError("BLIZZARD_CHARACTER_NOT_FOUND", "Blizzard resource was not found (character-status).", 404)), "PROFILE_UNAVAILABLE"],
    ["5xx / timeout / network / invalid JSON", () => mockStatusFailure(new DomainError("BATTLENET_API_UNAVAILABLE", "Battle.net request timed out (character-status).", 503)), "UPSTREAM_UNAVAILABLE"],
    ["429", () => mockStatusFailure(new DomainError("BATTLENET_RATE_LIMITED", "Battle.net rate limit reached. Try again shortly.", 429)), "RATE_LIMITED"],
    ["auth failure", () => mockStatusFailure(new DomainError("BATTLENET_AUTH_FAILED", "Battle.net authorization failed (character-status).", 401)), "AUTH_OR_CONFIG"],
    ["unexpected internal failure", () => mockStatusFailure(new Error("socket hang up at 10.0.0.1 token=abc")), "INTERNAL"],
    [
      "identity conflict (class changed)",
      () => {
        mockSuccess();
        apiMocks.getCharacterProfileSummary.mockResolvedValue({ id: undefined, name: "x", wowClass: "WARRIOR", equippedItemLevel: 1 });
      },
      "IDENTITY_CONFLICT",
    ],
  ];

  it.each(cases.map(([label, arrange, expected]) => [label, expected, arrange] as const))("%s → %s", async (_label, expected, arrange) => {
    const character = await createLinkedCharacter(`Telcat${Math.random().toString(36).slice(2, 8)}`);
    arrange();
    await characterBlizzardSyncService.refreshCharacter(owner, character.id).catch(() => {});
    const after = await row(character.id);
    expect(after.lastSyncErrorCode).toBe(expected);
    expect(CHARACTER_SYNC_ERROR_CODES as readonly string[]).toContain(after.lastSyncErrorCode);
  });

  it("rename onto another Character of the same owner → NAME_CONFLICT", async () => {
    await createLinkedCharacter("Telexisting");
    const character = await createLinkedCharacter("Telrename");
    mockSuccess();
    apiMocks.getCharacterProfileSummary.mockResolvedValue({
      id: undefined,
      name: "Telexisting",
      wowClass: "MAGE",
      equippedItemLevel: 650,
    });
    await expect(characterBlizzardSyncService.refreshCharacter(owner, character.id)).rejects.toMatchObject({
      code: "CHARACTER_ALREADY_EXISTS",
    });
    expect((await row(character.id)).lastSyncErrorCode).toBe("NAME_CONFLICT");
  });

  it("stores only the fixed category — never the raw message", async () => {
    const character = await createLinkedCharacter("Telraw");
    mockStatusFailure(new Error("upstream said: token=secret-123 Authorization: Bearer xyz"));
    await characterBlizzardSyncService.refreshCharacter(owner, character.id).catch(() => {});
    const raw = (await orm.Character.where({ id: character.id }).first()) as Record<string, unknown>;
    expect(raw.lastSyncErrorCode).toBe("INTERNAL");
    expect(JSON.stringify(raw)).not.toContain("secret-123");
    expect(JSON.stringify(raw)).not.toContain("Bearer");
  });

  it("logs one safe structured line per failure — no identity, message or upstream data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const character = await createLinkedCharacter("Tellogname");
    mockStatusFailure(new DomainError("BATTLENET_RATE_LIMITED", "Battle.net rate limit reached. Try again shortly.", 429));
    await characterBlizzardSyncService.refreshCharacter(owner, character.id).catch(() => {});
    const lines = warn.mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      event: "character_sync_rate_limited",
      errorCategory: "RATE_LIMITED",
      trigger: "OWNER_MANUAL",
      region: "EU",
      rateLimited: true,
      retryable: true,
    });
    for (const forbidden of ["Tellogname", "tellogname", character.id, ownerId, "Telemetry Owner", "rate limit reached"]) {
      expect(lines[0]).not.toContain(forbidden);
    }
  });
});

describe("manual cooldown is attempt-based", () => {
  it("a successful attempt starts the 60s cooldown", async () => {
    const character = await createLinkedCharacter("Telcoolok");
    mockSuccess();
    await characterBlizzardSyncService.refreshCharacter(owner, character.id);
    await expect(characterBlizzardSyncService.refreshCharacter(owner, character.id)).rejects.toMatchObject({
      code: "BLIZZARD_REFRESH_COOLDOWN",
    });
  });

  it("a FAILED attempt also starts the cooldown (no hammering a failing Character), and it ends after 60s", async () => {
    const character = await createLinkedCharacter("Telcoolfail");
    mockStatusFailure(new DomainError("BATTLENET_API_UNAVAILABLE", "Battle.net API unavailable (character-status).", 503));
    await characterBlizzardSyncService.refreshCharacter(owner, character.id).catch(() => {});
    expect((await row(character.id)).lastSyncedAt).toBeNull();
    await expect(characterBlizzardSyncService.refreshCharacter(owner, character.id)).rejects.toMatchObject({
      code: "BLIZZARD_REFRESH_COOLDOWN",
    });
    expect(apiMocks.getCharacterProfileStatus).toHaveBeenCalledTimes(1);

    await orm.Character.where({ id: character.id }).update({
      lastSyncAttemptAt: new Date(Date.now() - 61_000).toISOString(),
    });
    mockSuccess();
    await expect(characterBlizzardSyncService.refreshCharacter(owner, character.id)).resolves.toBeTruthy();
  });

  it("a fresh lastSyncedAt alone no longer blocks — the basis is the attempt", async () => {
    const character = await createLinkedCharacter("Telcoolbasis", { lastSyncedAt: new Date().toISOString() });
    // A pre-migration row: success known, no attempt recorded yet.
    await orm.Character.where({ id: character.id }).update({ lastSyncAttemptAt: null });
    mockSuccess();
    await expect(characterBlizzardSyncService.refreshCharacter(owner, character.id)).resolves.toBeTruthy();
  });

  it("scheduler freshness stays success-based: a recent failed attempt does not remove a candidate", async () => {
    const failing = await createLinkedCharacter("Telschedfail");
    await orm.Character.where({ id: failing.id }).update({
      lastSyncAttemptAt: new Date().toISOString(),
      lastSyncErrorAt: new Date().toISOString(),
      lastSyncErrorCode: "UPSTREAM_UNAVAILABLE",
      syncFailureCount: 4,
    });
    const fresh = await createLinkedCharacter("Telschedfresh", { lastSyncedAt: new Date().toISOString() });
    const candidates = await characterRepository.listScheduledSyncCandidates({
      staleBefore: new Date(Date.now() - 120 * 60_000).toISOString(),
    });
    const candidateIds = candidates.map((candidate) => candidate.character.id);
    expect(candidateIds).toContain(failing.id);
    expect(candidateIds).not.toContain(fresh.id);
  });
});

describe("per-Character advisory lock", () => {
  it("first acquisition wins, a second for the same Character is refused, other Characters are independent", async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const lockA = await tryAcquireCharacterSyncLock(a);
    expect(lockA).not.toBeNull();
    expect(await tryAcquireCharacterSyncLock(a)).toBeNull();
    const lockB = await tryAcquireCharacterSyncLock(b);
    expect(lockB).not.toBeNull();
    await releaseCharacterSyncLock(lockA!);
    const again = await tryAcquireCharacterSyncLock(a);
    expect(again).not.toBeNull();
    await releaseCharacterSyncLock(again!);
    await releaseCharacterSyncLock(lockB!);
  });

  it("is released after a successful and after a failed sync", async () => {
    const ok = await withCharacterSyncLock(crypto.randomUUID(), async () => "done");
    expect(ok).toEqual({ acquired: true, value: "done" });

    const id = crypto.randomUUID();
    await expect(withCharacterSyncLock(id, async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    const lock = await tryAcquireCharacterSyncLock(id);
    expect(lock).not.toBeNull();
    await releaseCharacterSyncLock(lock!);

    const character = await createLinkedCharacter("Tellockrel");
    mockStatusFailure(new DomainError("BATTLENET_API_UNAVAILABLE", "x", 503));
    await characterBlizzardSyncService.refreshCharacter(owner, character.id).catch(() => {});
    const afterFailure = await tryAcquireCharacterSyncLock(character.id);
    expect(afterFailure).not.toBeNull();
    await releaseCharacterSyncLock(afterFailure!);
  });

  it("a Character already being synced is refused cleanly — no attempt, no telemetry, no Blizzard call", async () => {
    const character = await createLinkedCharacter("Telbusy");
    const held = await tryAcquireCharacterSyncLock(character.id);
    try {
      mockSuccess();
      const error = await characterBlizzardSyncService.refreshCharacter(owner, character.id).catch((caught) => caught);
      expect(isDomainError(error) && error.code).toBe("CHARACTER_SYNC_IN_PROGRESS");
      expect(apiMocks.getCharacterProfileStatus).not.toHaveBeenCalled();
      expect(await row(character.id)).toMatchObject({ lastSyncAttemptAt: null, syncFailureCount: 0 });
    } finally {
      await releaseCharacterSyncLock(held!);
    }
  });

  it("owner regional Refresh All skips a Character that is already syncing", async () => {
    const busy = await createLinkedCharacter("Telregbusy");
    const held = await tryAcquireCharacterSyncLock(busy.id);
    try {
      mockSuccess();
      await characterBlizzardSyncService.refreshLinkedCharactersForRegion(owner, "EU");
      expect((await row(busy.id)).lastSyncAttemptAt).toBeNull();
    } finally {
      await releaseCharacterSyncLock(held!);
    }
  });

  it("the scheduler skips a Character that is already syncing and reports it", async () => {
    const busy = await createLinkedCharacter("Telschedbusy");
    const held = await tryAcquireCharacterSyncLock(busy.id);
    try {
      mockSuccess();
      const result = await scheduledCharacterSyncService.runOnce();
      expect(result.status).toBe("COMPLETED");
      expect(result.skippedInProgress).toBeGreaterThanOrEqual(1);
      expect((await row(busy.id)).lastSyncAttemptAt).toBeNull();
    } finally {
      await releaseCharacterSyncLock(held!);
    }
  });
});

describe("lockouts stay multi-content and UNKNOWN-safe around failures", () => {
  it("a success writes explicit verified rows for every current raid; a later failure keeps them and adds none", async () => {
    const character = await createLinkedCharacter("Tellock");
    mockSuccess();
    await characterBlizzardSyncService.refreshCharacter(owner, character.id);
    const reset = getRegionalWeeklyReset("EU").resetIdentifier;
    const rows = (await orm.CharacterRaidLockout.where({ characterId: character.id, resetIdentifier: reset }).all()) as Array<{
      raidId: string;
      difficulty: string;
      bossesDefeated: number;
    }>;
    const raidIds = new Set(rows.map((lockout) => lockout.raidId));
    for (const raid of getCurrentLockoutRaids()) expect(raidIds.has(raid.id)).toBe(true);
    // Verified zero is an explicit row (0/N), not an absence.
    expect(rows.some((lockout) => Number(lockout.bossesDefeated) === 0)).toBe(true);
    const heroic = rows.find((lockout) => lockout.raidId === VENOMOUS_ABYSS_RAID_ID && lockout.difficulty === "HEROIC");
    expect(Number(heroic?.bossesDefeated)).toBe(2);

    await expireCooldown(character.id);
    mockStatusFailure(new DomainError("BATTLENET_API_UNAVAILABLE", "x", 503));
    await characterBlizzardSyncService.refreshCharacter(owner, character.id).catch(() => {});
    const afterFailure = await orm.CharacterRaidLockout.where({ characterId: character.id, resetIdentifier: reset }).all();
    expect(afterFailure).toHaveLength(rows.length);
  });

  it("a never-synced Character that fails keeps its lockouts UNKNOWN (no rows invented)", async () => {
    const character = await createLinkedCharacter("Telunknown");
    mockStatusFailure(new DomainError("BLIZZARD_CHARACTER_NOT_FOUND", "x", 404));
    await characterBlizzardSyncService.refreshCharacter(owner, character.id).catch(() => {});
    expect(await orm.CharacterRaidLockout.where({ characterId: character.id }).all()).toHaveLength(0);
    expect(deriveCharacterSyncHealth(await row(character.id), { now: now(), staleMinutes: 120 })).toBe("ERROR");
  });
});
