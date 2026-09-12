import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError, isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { characterRepository } from "@/repositories/character.repository";
import { battleNetConnectionRepository } from "@/repositories/battle-net-connection.repository";
import { scheduledJobLockRepository } from "@/repositories/scheduled-job-lock.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { getCurrentLockoutRaid } from "@/lib/wow-raid-catalog";
import type { WowRegion } from "@/models/enums";

const apiMocks = vi.hoisted(() => ({
  getClientCredentialsToken: vi.fn(),
  getCharacterProfileStatus: vi.fn(),
  getCharacterProfileSummary: vi.fn(),
  getCharacterRaidEncounters: vi.fn(),
}));

vi.mock("@/integrations/blizzard/blizzard-api-client", () => ({
  blizzardApiClient: apiMocks,
}));

import {
  SCHEDULED_CHARACTER_SYNC_LOCK_KEY,
  resolveScheduledSyncStaleMs,
  scheduledCharacterSyncService,
} from "@/services/scheduled-character-sync.service";

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];

async function createUser(name: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name,
    email: `${id}@sc.boostting.local`,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
  createdUserIds.push(id);
  return id;
}

async function createConnection(userId: string, region: WowRegion) {
  return battleNetConnectionRepository.upsert({
    userId,
    region,
    battleNetAccountId: `acct-${userId}-${region}`,
    battleTag: `Tag#${region}`,
    scope: "wow.profile openid",
  });
}

async function createCharacter(input: {
  userId: string;
  name: string;
  realm?: string;
  region?: WowRegion;
  isActive?: boolean;
  blizzardCharacterId?: string | null;
  blizzardRealmId?: string | null;
  lastSyncedAt?: string | null;
  itemLevel?: number | null;
}) {
  const realm = input.realm ?? "Twisting Nether";
  const region = input.region ?? "EU";
  const id = crypto.randomUUID();
  const record = await characterRepository.create({
    id,
    userId: input.userId,
    name: input.name,
    realm,
    region,
    normalizedName: normalizeCharacterIdentity(input.name),
    normalizedRealm: normalizeCharacterIdentity(realm),
    wowClass: "MAGE",
    specialization: "Arcane",
    primaryRole: "DPS",
    itemLevel: input.itemLevel ?? 600,
    isActive: input.isActive ?? true,
    blizzardCharacterId: input.blizzardCharacterId === undefined ? `bz-${id}` : input.blizzardCharacterId,
    blizzardRealmId: input.blizzardRealmId === undefined ? "1301" : input.blizzardRealmId,
    lastSyncedAt: input.lastSyncedAt === undefined ? null : input.lastSyncedAt,
  });
  createdCharacterIds.push(record.id);
  return record;
}

function mockProfileSuccess(byName: Record<string, { itemLevel?: number; realmId?: string }>) {
  apiMocks.getCharacterProfileStatus.mockImplementation(async (_region: WowRegion, _realmSlug: string, name: string) => ({
    id: `bz-status-${name}`,
    isValid: name in byName,
  }));
  apiMocks.getCharacterProfileSummary.mockImplementation(async (_region: WowRegion, _realmSlug: string, name: string) => {
    const entry = byName[name];
    return {
      id: undefined,
      name,
      realmId: entry?.realmId,
      realmSlug: "twisting-nether",
      realmName: "Twisting Nether",
      wowClass: "MAGE",
      equippedItemLevel: entry?.itemLevel ?? null,
      activeSpecialization: "Arcane",
    };
  });
}

async function cleanupAll() {
  for (const id of createdCharacterIds) {
    await orm.CharacterRaidLockout.where({ characterId: id }).delete().catch(() => {});
    await orm.Character.where({ id }).delete().catch(() => {});
  }
  for (const id of createdUserIds) {
    await orm.BattleNetConnection.where({ userId: id }).delete().catch(() => {});
    await orm.ActivityEvent.where({ userId: id }).delete().catch(() => {});
    await orm.User.where({ id }).delete().catch(() => {});
  }
  createdCharacterIds.length = 0;
  createdUserIds.length = 0;
}

beforeAll(() => {
  vi.stubEnv("BLIZZARD_CLIENT_ID", "test-client-id");
  vi.stubEnv("BLIZZARD_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("BLIZZARD_REDIRECT_URI", "http://localhost:3000/api/integrations/battlenet/callback");
  vi.stubEnv("BLIZZARD_SYNC_STALE_MINUTES", "");
});

afterAll(async () => {
  await cleanupAll();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getClientCredentialsToken.mockResolvedValue("client-token");
  apiMocks.getCharacterRaidEncounters.mockRejectedValue(new Error("encounters unavailable"));
});

afterEach(async () => {
  await cleanupAll();
});

describe("resolveScheduledSyncStaleMs", () => {
  it("defaults to 15 minutes when unset", () => {
    vi.stubEnv("BLIZZARD_SYNC_STALE_MINUTES", "");
    expect(resolveScheduledSyncStaleMs()).toBe(15 * 60_000);
  });

  it("honors a positive integer override", () => {
    vi.stubEnv("BLIZZARD_SYNC_STALE_MINUTES", "30");
    expect(resolveScheduledSyncStaleMs()).toBe(30 * 60_000);
    vi.stubEnv("BLIZZARD_SYNC_STALE_MINUTES", "");
  });

  it("fails loudly on a zero threshold rather than permitting a busy loop", () => {
    vi.stubEnv("BLIZZARD_SYNC_STALE_MINUTES", "0");
    expect(() => resolveScheduledSyncStaleMs()).toThrow(/positive integer/);
    vi.stubEnv("BLIZZARD_SYNC_STALE_MINUTES", "");
  });

  it("fails loudly on a non-numeric threshold", () => {
    vi.stubEnv("BLIZZARD_SYNC_STALE_MINUTES", "soon");
    expect(() => resolveScheduledSyncStaleMs()).toThrow(/positive integer/);
    vi.stubEnv("BLIZZARD_SYNC_STALE_MINUTES", "");
  });

  it("fails loudly on a fractional threshold", () => {
    vi.stubEnv("BLIZZARD_SYNC_STALE_MINUTES", "1.5");
    expect(() => resolveScheduledSyncStaleMs()).toThrow(/positive integer/);
    vi.stubEnv("BLIZZARD_SYNC_STALE_MINUTES", "");
  });
});

describe("characterRepository.listScheduledSyncCandidates", () => {
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const fresh = new Date().toISOString();
  const old = new Date(Date.now() - 60 * 60_000).toISOString();

  it("A: selects a stale, active, linked character with a matching regional connection", async () => {
    const userId = await createUser("Owner A");
    await createConnection(userId, "EU");
    const character = await createCharacter({ userId, name: "Scstale", lastSyncedAt: old });

    const candidates = await characterRepository.listScheduledSyncCandidates({ staleBefore });
    expect(candidates.some((c) => c.character.id === character.id)).toBe(true);
  });

  it("B: a null lastSyncedAt is stale and eligible", async () => {
    const userId = await createUser("Owner B");
    await createConnection(userId, "EU");
    const character = await createCharacter({ userId, name: "Scnull", lastSyncedAt: null });

    const candidates = await characterRepository.listScheduledSyncCandidates({ staleBefore });
    expect(candidates.some((c) => c.character.id === character.id)).toBe(true);
  });

  it("C: a recently-synced character is skipped", async () => {
    const userId = await createUser("Owner C");
    await createConnection(userId, "EU");
    const character = await createCharacter({ userId, name: "Screcent", lastSyncedAt: fresh });

    const candidates = await characterRepository.listScheduledSyncCandidates({ staleBefore });
    expect(candidates.some((c) => c.character.id === character.id)).toBe(false);
  });

  it("D: an inactive character is skipped", async () => {
    const userId = await createUser("Owner D");
    await createConnection(userId, "EU");
    const character = await createCharacter({ userId, name: "Scinactive", lastSyncedAt: old, isActive: false });

    const candidates = await characterRepository.listScheduledSyncCandidates({ staleBefore });
    expect(candidates.some((c) => c.character.id === character.id)).toBe(false);
  });

  it("E: a character missing blizzardCharacterId is skipped", async () => {
    const userId = await createUser("Owner E");
    await createConnection(userId, "EU");
    const character = await createCharacter({ userId, name: "Scnobzid", lastSyncedAt: old, blizzardCharacterId: null });

    const candidates = await characterRepository.listScheduledSyncCandidates({ staleBefore });
    expect(candidates.some((c) => c.character.id === character.id)).toBe(false);
  });

  it("F: a character missing blizzardRealmId is skipped", async () => {
    const userId = await createUser("Owner F");
    await createConnection(userId, "EU");
    const character = await createCharacter({ userId, name: "Scnorealmid", lastSyncedAt: old, blizzardRealmId: null });

    const candidates = await characterRepository.listScheduledSyncCandidates({ staleBefore });
    expect(candidates.some((c) => c.character.id === character.id)).toBe(false);
  });

  it("G: a character whose owner has no BattleNetConnection at all is skipped", async () => {
    const userId = await createUser("Owner G");
    const character = await createCharacter({ userId, name: "Scnoconn", lastSyncedAt: old });

    const candidates = await characterRepository.listScheduledSyncCandidates({ staleBefore });
    expect(candidates.some((c) => c.character.id === character.id)).toBe(false);
  });

  it("H: an EU character whose owner only has a US connection is skipped", async () => {
    const userId = await createUser("Owner H");
    await createConnection(userId, "US");
    const character = await createCharacter({ userId, name: "Sceuonly", region: "EU", lastSyncedAt: old });

    const candidates = await characterRepository.listScheduledSyncCandidates({ staleBefore });
    expect(candidates.some((c) => c.character.id === character.id)).toBe(false);
  });
});

describe("scheduledCharacterSyncService.runOnce — data ownership and partial failure", () => {
  it("updates name/itemLevel/lastSyncedAt and current-raid lockouts, never specialization/primaryRole", async () => {
    const userId = await createUser("Owner Refresh");
    const connection = await createConnection(userId, "EU");
    const character = await createCharacter({
      userId,
      name: "Screfresh",
      lastSyncedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      itemLevel: 600,
    });

    mockProfileSuccess({ Screfresh: { itemLevel: 690, realmId: character.blizzardRealmId ?? undefined } });

    const result = await scheduledCharacterSyncService.runOnce();
    expect(result.status).toBe("COMPLETED");
    expect(result.refreshed).toBeGreaterThanOrEqual(1);

    const updated = await characterRepository.findById(character.id);
    expect(updated?.itemLevel).toBe(690);
    expect(updated?.specialization).toBe("Arcane");
    expect(updated?.primaryRole).toBe("DPS");
    expect(updated?.lastSyncedAt).toBeTruthy();

    const refreshedConnection = await battleNetConnectionRepository.findByUserAndRegion(userId, "EU");
    expect(refreshedConnection?.lastSuccessfulSyncAt).toBeTruthy();
    void connection;
  });

  it("preserves the existing itemLevel when Blizzard omits equippedItemLevel", async () => {
    const userId = await createUser("Owner Retain");
    await createConnection(userId, "EU");
    const character = await createCharacter({
      userId,
      name: "Scretain",
      lastSyncedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      itemLevel: 650,
    });

    mockProfileSuccess({ Scretain: { realmId: character.blizzardRealmId ?? undefined } });

    const result = await scheduledCharacterSyncService.runOnce();
    expect(result.status).toBe("COMPLETED");

    const updated = await characterRepository.findById(character.id);
    expect(updated?.itemLevel).toBe(650);
  });

  it("preserves prior lockouts when the encounters call fails, but still updates the profile", async () => {
    const userId = await createUser("Owner LockoutFail");
    await createConnection(userId, "EU");
    const character = await createCharacter({
      userId,
      name: "Sclockoutfail",
      lastSyncedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      itemLevel: 600,
    });

    await raidRepository.ensureReferenceRaids();
    const nowIso = new Date().toISOString();
    await orm.CharacterRaidLockout.create({
      id: crypto.randomUUID(),
      characterId: character.id,
      raidId: getCurrentLockoutRaid()!.id,
      difficulty: "NORMAL",
      resetIdentifier: "2026-W37",
      bossesDefeated: 3,
      isComplete: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    mockProfileSuccess({ Sclockoutfail: { itemLevel: 710, realmId: character.blizzardRealmId ?? undefined } });
    apiMocks.getCharacterRaidEncounters.mockRejectedValue(new Error("timeout"));

    const result = await scheduledCharacterSyncService.runOnce();
    expect(result.status).toBe("COMPLETED");
    expect(result.lockoutsUnavailable).toBeGreaterThanOrEqual(1);

    const updated = await characterRepository.findById(character.id);
    expect(updated?.itemLevel).toBe(710);

    const lockouts = await orm.CharacterRaidLockout.where({ characterId: character.id }).all();
    expect(lockouts).toHaveLength(1);
    expect(Number(lockouts[0]?.bossesDefeated)).toBe(3);
  });

  it("counts a profile failure without failing the job or the other candidate", async () => {
    const userId = await createUser("Owner Mixed");
    await createConnection(userId, "EU");
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const broken = await createCharacter({ userId, name: "Scbroken", lastSyncedAt: old });
    const healthy = await createCharacter({ userId, name: "Scfine", lastSyncedAt: old });

    mockProfileSuccess({ Scfine: { itemLevel: 700, realmId: healthy.blizzardRealmId ?? undefined } });
    // Scbroken is absent from the success map, so getCharacterProfileStatus
    // reports isValid:false for it — a profile-unavailable failure.

    const result = await scheduledCharacterSyncService.runOnce();
    expect(result.status).toBe("COMPLETED");
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.refreshed).toBeGreaterThanOrEqual(1);

    const brokenRow = await characterRepository.findById(broken.id);
    expect(brokenRow?.itemLevel).toBe(600); // untouched
  });

  it("marks a BattleNetConnection successful only once, and only when at least one refresh succeeded", async () => {
    const userId = await createUser("Owner Grouping");
    await createConnection(userId, "EU");
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const a = await createCharacter({ userId, name: "Scgroupa", lastSyncedAt: old });
    const b = await createCharacter({ userId, name: "Scgroupb", lastSyncedAt: old });
    void a;
    void b;

    mockProfileSuccess({ Scgroupa: { itemLevel: 620 } });
    // Scgroupb has no realmId in the mock and no entry — it will report a
    // realm mismatch / invalid profile, i.e. a failure.

    const result = await scheduledCharacterSyncService.runOnce();
    expect(result.status).toBe("COMPLETED");
    expect(result.connectionsUpdated).toBe(1);
  });

  it("does not mark the connection when every candidate for it fails", async () => {
    const userId = await createUser("Owner AllFail");
    await createConnection(userId, "EU");
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    await createCharacter({ userId, name: "Scallfaila", lastSyncedAt: old });
    await createCharacter({ userId, name: "Scallfailb", lastSyncedAt: old });

    // Neither name is in the success map — both report isValid:false.
    mockProfileSuccess({});

    const before = await battleNetConnectionRepository.findByUserAndRegion(userId, "EU");
    const result = await scheduledCharacterSyncService.runOnce();
    expect(result.status).toBe("COMPLETED");
    expect(result.refreshed).toBe(0);
    expect(result.connectionsUpdated).toBe(0);

    const after = await battleNetConnectionRepository.findByUserAndRegion(userId, "EU");
    expect(after?.lastSuccessfulSyncAt).toBe(before?.lastSuccessfulSyncAt ?? null);
  });
});

describe("scheduledCharacterSyncService.runOnce — global concurrency", () => {
  it("never runs more than 4 refreshes concurrently across multiple users/regions/connections", async () => {
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const suffixes = ["a", "b", "c", "d", "e", "f"];
    const names: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const userId = await createUser(`Owner Conc ${i}`);
      const region: WowRegion = i % 2 === 0 ? "EU" : "US";
      await createConnection(userId, region);
      const name = `Scconc${suffixes[i]}`;
      await createCharacter({ userId, name, region, lastSyncedAt: old });
      names.push(name);
    }

    let inFlight = 0;
    let maxInFlight = 0;
    apiMocks.getCharacterProfileStatus.mockImplementation(async (_region: WowRegion, _realmSlug: string, name: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return { id: `bz-${name}`, isValid: true };
    });
    apiMocks.getCharacterProfileSummary.mockImplementation(async (_region: WowRegion, _realmSlug: string, name: string) => ({
      id: undefined,
      name,
      realmId: undefined,
      realmSlug: "twisting-nether",
      realmName: "Twisting Nether",
      wowClass: "MAGE",
      equippedItemLevel: 650,
      activeSpecialization: "Arcane",
    }));

    const result = await scheduledCharacterSyncService.runOnce();
    expect(result.status).toBe("COMPLETED");
    expect(result.totalCandidates).toBe(6);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});

describe("scheduledCharacterSyncService.runOnce — rate limiting", () => {
  it("stops dispatching new refreshes once Blizzard rate-limits, without a retry storm", async () => {
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const suffixes = ["a", "b", "c", "d", "e", "f"];
    for (let i = 0; i < 6; i += 1) {
      const userId = await createUser(`Owner RL ${i}`);
      await createConnection(userId, "EU");
      await createCharacter({ userId, name: `Screlim${suffixes[i]}`, lastSyncedAt: old });
    }

    apiMocks.getCharacterProfileStatus.mockRejectedValue(
      new DomainError("BATTLENET_RATE_LIMITED", "Battle.net rate limit reached.", 429),
    );

    const result = await scheduledCharacterSyncService.runOnce();
    expect(result.status).toBe("COMPLETED");
    expect(result.totalCandidates).toBe(6);
    expect(result.refreshed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.rateLimited).toBe(6);
    // Only the first wave (global concurrency 4) ever calls Blizzard — the
    // remaining 2 are pre-empted by the shared rate-limit flag before they
    // ever dispatch a request.
    expect(apiMocks.getCharacterProfileStatus).toHaveBeenCalledTimes(4);
  });
});

describe("scheduledCharacterSyncService.runOnce — overlap protection (advisory lock)", () => {
  it("returns SKIPPED_ALREADY_RUNNING with zero Blizzard calls when another cycle holds the lock", async () => {
    const userId = await createUser("Owner Overlap");
    await createConnection(userId, "EU");
    await createCharacter({ userId, name: "Scoverlap", lastSyncedAt: new Date(Date.now() - 60 * 60_000).toISOString() });

    const handle = await scheduledJobLockRepository.tryAcquireLock(
      SCHEDULED_CHARACTER_SYNC_LOCK_KEY.classId,
      SCHEDULED_CHARACTER_SYNC_LOCK_KEY.objectId,
    );
    expect(handle).not.toBeNull();

    try {
      const result = await scheduledCharacterSyncService.runOnce();
      expect(result.status).toBe("SKIPPED_ALREADY_RUNNING");
      expect(result.totalCandidates).toBe(0);
      expect(apiMocks.getCharacterProfileStatus).not.toHaveBeenCalled();
    } finally {
      await scheduledJobLockRepository.releaseLock(handle!);
    }
  });

  it("releases the lock on a normal completion, so the next cycle can acquire it", async () => {
    const result = await scheduledCharacterSyncService.runOnce();
    expect(result.status).toBe("COMPLETED");

    const handle = await scheduledJobLockRepository.tryAcquireLock(
      SCHEDULED_CHARACTER_SYNC_LOCK_KEY.classId,
      SCHEDULED_CHARACTER_SYNC_LOCK_KEY.objectId,
    );
    expect(handle).not.toBeNull();
    await scheduledJobLockRepository.releaseLock(handle!);
  });

  it("releases the lock even when the job throws (e.g. Battle.net not configured)", async () => {
    const userId = await createUser("Owner Unconfigured");
    await createConnection(userId, "EU");
    await createCharacter({ userId, name: "Scunconf", lastSyncedAt: new Date(Date.now() - 60 * 60_000).toISOString() });

    vi.stubEnv("BLIZZARD_CLIENT_ID", "");
    try {
      await expect(scheduledCharacterSyncService.runOnce()).rejects.toSatisfy(
        (error: unknown) => isDomainError(error) && error.code === "BATTLENET_NOT_CONFIGURED",
      );
    } finally {
      vi.stubEnv("BLIZZARD_CLIENT_ID", "test-client-id");
    }

    const handle = await scheduledJobLockRepository.tryAcquireLock(
      SCHEDULED_CHARACTER_SYNC_LOCK_KEY.classId,
      SCHEDULED_CHARACTER_SYNC_LOCK_KEY.objectId,
    );
    expect(handle).not.toBeNull();
    await scheduledJobLockRepository.releaseLock(handle!);
  });
});

describe("scheduledJobLockRepository", () => {
  it("a second tryAcquireLock for the same key fails while the first is held", async () => {
    const key1 = 424242;
    const key2 = 7;
    const first = await scheduledJobLockRepository.tryAcquireLock(key1, key2);
    expect(first).not.toBeNull();

    const second = await scheduledJobLockRepository.tryAcquireLock(key1, key2);
    expect(second).toBeNull();

    await scheduledJobLockRepository.releaseLock(first!);

    const third = await scheduledJobLockRepository.tryAcquireLock(key1, key2);
    expect(third).not.toBeNull();
    await scheduledJobLockRepository.releaseLock(third!);
  });
});
