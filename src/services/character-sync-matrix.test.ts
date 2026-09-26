import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { DomainError, isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { releaseCharacterSyncLock, tryAcquireCharacterSyncLock } from "@/lib/character-sync-lock";

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
} from "@/services/character-operations.service";
import { characterService } from "@/services/character.service";
import { scheduledCharacterSyncService } from "@/services/scheduled-character-sync.service";

/**
 * SYNC DOMAIN RULE across every entry point: being ACTIVE decides WHETHER a
 * Character syncs; Battle.net linkage only decides HOW.
 *   A linked + owner connection → VERIFIED
 *   B manual (no Blizzard ids)  → PUBLIC, never receives ids
 *   C ids, owner has NO connection → PUBLIC, ids kept exactly
 *   D retired                   → excluded / refused
 */

const token = Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 4).padEnd(4, "x");
const userIds: string[] = [];
let owner: AuthenticatedUser; // has an EU connection; owns A, B, D
let noConnOwner: AuthenticatedUser; // no connection at all; owns C
let admin: AuthenticatedUser;
const fx = {} as Record<"A" | "B" | "C" | "D", { id: string; name: string }>;

/** Blizzard's public-profile ids per fixture (B's is what a public sync must NEVER stamp). */
const PROFILE_IDS = { A: "790001", B: "790002", C: "790003", D: "790004" } as const;

function asUser(id: string, accountRole: AuthenticatedUser["accountRole"]): AuthenticatedUser {
  return {
    id,
    name: `Sync ${accountRole} ${token}`,
    email: `${id}@sync-matrix.boostting.local`,
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
    name: `Sync ${accountRole} ${token}`,
    email: `${id}@sync-matrix.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
  userIds.push(id);
  return asUser(id, accountRole);
}

async function createFixture(user: AuthenticatedUser, suffix: string) {
  const created = await characterService.createCharacter(user, {
    name: `Mx${token}${suffix}`,
    realm: "Twisting Nether",
    region: "EU",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    itemLevel: 600,
  });
  return { id: created.id, name: created.name };
}

/** Each test starts stale (scheduler candidate) and out of the 60s cooldown. */
async function makeStale() {
  const old = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
  for (const { id } of Object.values(fx)) {
    await orm.Character.where({ id }).update({ lastSyncedAt: old, lastSyncAttemptAt: old, itemLevel: 600 });
  }
}

async function row(key: keyof typeof fx) {
  return (await characterRepository.findById(fx[key].id))!;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => null).catch((caught) => caught);
  expect(isDomainError(error) ? error.code : error).toBe(code);
}

/** B never receives ids; A and C keep exactly their stored ids; D is never touched. */
async function expectIdentityInvariants() {
  expect(await row("A")).toMatchObject({ blizzardCharacterId: PROFILE_IDS.A, blizzardRealmId: "1301" });
  expect(await row("B")).toMatchObject({ blizzardCharacterId: null, blizzardRealmId: null });
  expect(await row("C")).toMatchObject({ blizzardCharacterId: PROFILE_IDS.C, blizzardRealmId: "1301" });
}

function syncedSince(since: number) {
  return async (key: keyof typeof fx) => {
    const current = await row(key);
    return current.lastSyncedAt !== null && new Date(current.lastSyncedAt).getTime() >= since;
  };
}

beforeAll(async () => {
  vi.stubEnv("BLIZZARD_CLIENT_ID", "test-client-id");
  vi.stubEnv("BLIZZARD_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("BLIZZARD_REDIRECT_URI", "http://localhost:3000/api/integrations/battlenet/callback");
  owner = await createUser("USER");
  noConnOwner = await createUser("USER");
  admin = await createUser("ADMIN");
  await battleNetConnectionRepository.upsert({
    userId: owner.id,
    region: "EU",
    battleNetAccountId: `acct-${owner.id}`,
    battleTag: "Matrix#EU",
    scope: "wow.profile openid",
  });
  fx.A = await createFixture(owner, "a");
  fx.B = await createFixture(owner, "b");
  fx.C = await createFixture(noConnOwner, "c");
  fx.D = await createFixture(owner, "d");
  await orm.Character.where({ id: fx.A.id }).update({ blizzardCharacterId: PROFILE_IDS.A, blizzardRealmId: "1301" });
  await orm.Character.where({ id: fx.C.id }).update({ blizzardCharacterId: PROFILE_IDS.C, blizzardRealmId: "1301" });
  await characterRepository.setActive(fx.D.id, false);
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
  const byName = new Map(
    (Object.keys(fx) as Array<keyof typeof fx>).map((key) => [fx[key].name.toLowerCase(), PROFILE_IDS[key]]),
  );
  apiMocks.getClientCredentialsToken.mockResolvedValue("client-token");
  apiMocks.getCharacterProfileStatus.mockImplementation(async (_region: string, _realm: string, name: string) => {
    const id = byName.get(name.toLowerCase());
    if (!id) throw new DomainError("BLIZZARD_CHARACTER_NOT_FOUND", "not a matrix fixture", 404);
    return { id, isValid: true };
  });
  apiMocks.getCharacterProfileSummary.mockImplementation(async (_region: string, realmSlug: string, name: string) => {
    const id = byName.get(name.toLowerCase());
    if (!id) throw new DomainError("BLIZZARD_CHARACTER_NOT_FOUND", "not a matrix fixture", 404);
    return {
      id,
      name,
      realmId: "1301",
      realmSlug,
      realmName: "Twisting Nether",
      wowClass: "SHAMAN",
      equippedItemLevel: 655,
      activeSpecialization: "Elemental",
    };
  });
  apiMocks.getCharacterRaidEncounters.mockRejectedValue(new Error("encounters unavailable"));
  raiderIoMocks.getCharacterEquippedItemLevel.mockResolvedValue({ status: "NOT_FOUND" });
  await makeStale();
});

describe("sync matrix: ACTIVE decides whether, linkage decides how", () => {
  it("owner single Refresh: A/B/C sync (B public, no ids; C keeps ids); retired D refused; cooldown + lock kept", async () => {
    const since = Date.now();
    await characterBlizzardSyncService.refreshCharacter(owner, fx.A.id);
    await characterBlizzardSyncService.refreshCharacter(owner, fx.B.id);
    await characterBlizzardSyncService.refreshCharacter(noConnOwner, fx.C.id);
    await expectCode(characterBlizzardSyncService.refreshCharacter(owner, fx.D.id), "CHARACTER_INACTIVE");

    for (const key of ["A", "B", "C"] as const) expect(await syncedSince(since)(key)).toBe(true);
    expect((await row("B")).itemLevel).toBe(655);
    expect(apiMocks.getCharacterRaidEncounters).toHaveBeenCalledWith("EU", "twisting-nether", fx.B.name);
    await expectIdentityInvariants();

    // Normal 60s cooldown applies to the public path too.
    await expectCode(characterBlizzardSyncService.refreshCharacter(owner, fx.B.id), "BLIZZARD_REFRESH_COOLDOWN");
    // Per-Character lock applies to the public path too.
    await makeStale();
    const held = await tryAcquireCharacterSyncLock(fx.B.id);
    try {
      await expectCode(characterBlizzardSyncService.refreshCharacter(owner, fx.B.id), "CHARACTER_SYNC_IN_PROGRESS");
    } finally {
      await releaseCharacterSyncLock(held!);
    }
  });

  it("owner Refresh All: every active Character of the region, with OR without a Battle.net connection", async () => {
    const since = Date.now();
    const connected = await characterBlizzardSyncService.refreshLinkedCharactersForRegion(owner, "EU");
    expect(connected).toMatchObject({ total: 2, refreshed: 2, skipped: 0, failed: 0 });

    // The owner of C has no connection at all — Refresh All still syncs C publicly.
    const unconnected = await characterBlizzardSyncService.refreshLinkedCharactersForRegion(noConnOwner, "EU");
    expect(unconnected).toMatchObject({ linked: 0, total: 1, refreshed: 1, skipped: 0, failed: 0 });

    for (const key of ["A", "B", "C"] as const) expect(await syncedSince(since)(key)).toBe(true);
    expect(await syncedSince(since)("D")).toBe(false);
    await expectIdentityInvariants();
    expect(await battleNetConnectionRepository.findByUserAndRegion(noConnOwner.id, "EU")).toBeNull();
    const connection = await battleNetConnectionRepository.findByUserAndRegion(owner.id, "EU");
    expect(connection?.lastSuccessfulSyncAt).toBeTruthy();

    // Cooldown skips (not failures) on an immediate second run.
    const again = await characterBlizzardSyncService.refreshLinkedCharactersForRegion(noConnOwner, "EU");
    expect(again).toMatchObject({ total: 1, refreshed: 0, skipped: 1, failed: 0 });
  });

  it("admin Sync now + Force refresh: A/B/C sync; D refused; Force bypasses only the cooldown", async () => {
    const since = Date.now();
    for (const key of ["A", "B", "C"] as const) {
      const outcome = await characterOperationsService.syncCharacter(admin, { characterId: fx[key].id, force: false });
      expect(outcome.status).toBe("SUCCEEDED");
    }
    for (const force of [false, true]) {
      await expectCode(characterOperationsService.syncCharacter(admin, { characterId: fx.D.id, force }), "CHARACTER_SYNC_NOT_ELIGIBLE");
    }
    for (const key of ["A", "B", "C"] as const) expect(await syncedSince(since)(key)).toBe(true);
    await expectIdentityInvariants();

    await expectCode(characterOperationsService.syncCharacter(admin, { characterId: fx.B.id, force: false }), "BLIZZARD_REFRESH_COOLDOWN");
    for (const key of ["A", "B", "C"] as const) {
      const forced = await characterOperationsService.syncCharacter(admin, { characterId: fx[key].id, force: true });
      expect(forced.status).toBe("SUCCEEDED");
    }
    await expectIdentityInvariants();

    const held = await tryAcquireCharacterSyncLock(fx.C.id);
    try {
      await expectCode(characterOperationsService.syncCharacter(admin, { characterId: fx.C.id, force: true }), "CHARACTER_SYNC_IN_PROGRESS");
    } finally {
      await releaseCharacterSyncLock(held!);
    }
  });

  it("admin Force refresh all: eligible = every active Character (A/B/C), never retired D", async () => {
    await orm.ActivityEvent.where({ type: BULK_FORCE_REFRESH_STARTED_EVENT }).deleteAll();
    const since = Date.now();

    await characterOperationsService.forceRefreshAll(admin);

    for (const key of ["A", "B", "C"] as const) expect(await syncedSince(since)(key)).toBe(true);
    expect(await syncedSince(since)("D")).toBe(false);
    await expectIdentityInvariants();
    await orm.ActivityEvent.where({ type: BULK_FORCE_REFRESH_STARTED_EVENT }).deleteAll();
  });

  it("scheduler: stale A/B/C are candidates (only A through a connection); retired D is not", async () => {
    const candidates = await characterRepository.listScheduledSyncCandidates({ staleBefore: new Date().toISOString() });
    const byId = new Map(candidates.map((candidate) => [candidate.character.id, candidate]));
    expect(byId.get(fx.A.id)?.connection).toBeTruthy();
    expect(byId.has(fx.B.id) && byId.get(fx.B.id)!.connection).toBe(null);
    expect(byId.has(fx.C.id) && byId.get(fx.C.id)!.connection).toBe(null);
    expect(byId.has(fx.D.id)).toBe(false);

    const since = Date.now();
    await scheduledCharacterSyncService.runOnce();

    for (const key of ["A", "B", "C"] as const) expect(await syncedSince(since)(key)).toBe(true);
    expect(await syncedSince(since)("D")).toBe(false);
    await expectIdentityInvariants();
  });
});
