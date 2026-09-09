import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import type { OwnedBlizzardCharacter } from "@/lib/blizzard/types";

const apiMocks = vi.hoisted(() => ({
  buildAuthorizationUrl: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  getUserInfo: vi.fn(),
  getAccountProfile: vi.fn(),
  getClientCredentialsToken: vi.fn(),
  getCharacterProfileStatus: vi.fn(),
  getCharacterProfileSummary: vi.fn(),
}));

vi.mock("@/integrations/blizzard/blizzard-api-client", () => ({
  blizzardApiClient: apiMocks,
}));

import { blizzardApiClient } from "@/integrations/blizzard/blizzard-api-client";
import { battleNetService } from "@/services/battle-net.service";
import { characterService } from "@/services/character.service";

const ids = {
  owner: "aaaaaaaa-aaaa-4aaa-8aaa-bn0000000001",
  other: "aaaaaaaa-aaaa-4aaa-8aaa-bn0000000002",
};

const createdCharacterIds: string[] = [];

function asUser(id: string, name = "BattleNet Owner"): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@bntest.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole: "USER",
    accountStatus: "ACTIVE",
  };
}

async function expectDomainCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected domain error ${code}`);
  } catch (error) {
    if (error instanceof Error && error.message === `Expected domain error ${code}`) {
      throw error;
    }
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

function expectDomainCodeSync(fn: () => unknown, code: string) {
  try {
    fn();
    throw new Error(`Expected domain error ${code}`);
  } catch (error) {
    if (error instanceof Error && error.message === `Expected domain error ${code}`) {
      throw error;
    }
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

async function createTestUser(id: string, name: string) {
  await orm.User.create({
    id,
    name,
    email: `${id}@bntest.boostting.local`,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function deleteIfPresent(
  table: "User" | "Character" | "BattleNetConnection" | "BattleNetImportSession" | "ActivityEvent",
  id: string,
) {
  try {
    if (table === "User") {
      await orm.User.where({ id }).delete();
      return;
    }
    if (table === "Character") {
      await orm.Character.where({ id }).delete();
      return;
    }
    if (table === "BattleNetConnection") {
      await orm.BattleNetConnection.where({ id }).delete();
      return;
    }
    if (table === "BattleNetImportSession") {
      await orm.BattleNetImportSession.where({ id }).delete();
      return;
    }
    await orm.ActivityEvent.where({ id }).delete();
  } catch {
    // Already gone from a previous isolated run.
  }
}

async function cleanupGeneratedRows() {
  for (const userId of [ids.owner, ids.other]) {
    const sessions = await orm.BattleNetImportSession.where({ userId }).all();
    for (const row of sessions) {
      await deleteIfPresent("BattleNetImportSession", String(row.id));
    }
    const connections = await orm.BattleNetConnection.where({ userId }).all();
    for (const row of connections) {
      await deleteIfPresent("BattleNetConnection", String(row.id));
    }
    const characters = await orm.Character.where({ userId }).all();
    for (const row of characters) {
      await deleteIfPresent("Character", String(row.id));
    }
    const activities = await orm.ActivityEvent.where({ userId }).all();
    for (const row of activities) {
      await deleteIfPresent("ActivityEvent", String(row.id));
    }
  }
  for (const id of createdCharacterIds) {
    await deleteIfPresent("Character", id);
  }
  createdCharacterIds.length = 0;
  await deleteIfPresent("User", ids.owner);
  await deleteIfPresent("User", ids.other);
}

function ownedCharacter(overrides: Partial<OwnedBlizzardCharacter> = {}): OwnedBlizzardCharacter {
  return {
    id: "100001",
    name: "Bnimport",
    realmId: "1301",
    realmName: "Twisting Nether",
    realmSlug: "twisting-nether",
    wowClass: "SHAMAN",
    level: 80,
    region: "EU",
    ...overrides,
  };
}

function stubBlizzardEnv() {
  vi.stubEnv("BLIZZARD_CLIENT_ID", "test-client-id");
  vi.stubEnv("BLIZZARD_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("BLIZZARD_REDIRECT_URI", "http://localhost:3000/api/integrations/battlenet/callback");
}

beforeAll(async () => {
  stubBlizzardEnv();
  await cleanupGeneratedRows();
  await createTestUser(ids.owner, "BattleNet Owner");
  await createTestUser(ids.other, "BattleNet Other");
});

afterAll(async () => {
  await cleanupGeneratedRows();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  stubBlizzardEnv();
  vi.clearAllMocks();
  apiMocks.buildAuthorizationUrl.mockImplementation(
    (region: string, state: string) => `https://oauth.battle.net/authorize?region=${region}&state=${state}`,
  );
  apiMocks.exchangeAuthorizationCode.mockResolvedValue({
    accessToken: "ephemeral-access-token",
    scope: "wow.profile openid",
  });
  apiMocks.getUserInfo.mockResolvedValue({
    sub: "bn-account-eu",
    battletag: "Owner#1234",
  });
  apiMocks.getAccountProfile.mockResolvedValue([ownedCharacter()]);
});

afterEach(async () => {
  for (const userId of [ids.owner, ids.other]) {
    const sessions = await orm.BattleNetImportSession.where({ userId }).all();
    for (const row of sessions) {
      await deleteIfPresent("BattleNetImportSession", String(row.id));
    }
    const connections = await orm.BattleNetConnection.where({ userId }).all();
    for (const row of connections) {
      await deleteIfPresent("BattleNetConnection", String(row.id));
    }
  }
});

describe("battleNetService.beginConnect", () => {
  const owner = asUser(ids.owner);

  it("requires a configured Battle.net integration and an authenticated user id", () => {
    const result = battleNetService.beginConnect(owner, "EU");
    expect(result.region).toBe("EU");
    expect(result.authorizationUrl).toContain("state=");
    expect(result.cookie.name).toBe("bh_battlenet_oauth_state");
    expect(result.cookie.value.length).toBeGreaterThan(10);
    expect(blizzardApiClient.buildAuthorizationUrl).toHaveBeenCalledWith("EU", expect.any(String));
  });

  it("throws BATTLENET_NOT_CONFIGURED when Blizzard env is cleared", () => {
    vi.stubEnv("BLIZZARD_CLIENT_ID", "");
    vi.stubEnv("BLIZZARD_CLIENT_SECRET", "");
    vi.stubEnv("BLIZZARD_REDIRECT_URI", "");

    expectDomainCodeSync(() => battleNetService.beginConnect(owner, "EU"), "BATTLENET_NOT_CONFIGURED");
  });
});

describe("battleNetService.handleCallback", () => {
  const owner = asUser(ids.owner);

  it("creates EU and US connections independently for the same user", async () => {
    apiMocks.getUserInfo.mockResolvedValueOnce({ sub: "bn-eu", battletag: "Owner#EU" });
    apiMocks.getAccountProfile.mockResolvedValueOnce([ownedCharacter({ region: "EU" })]);
    const eu = await battleNetService.handleCallback({ user: owner, code: "code-eu", region: "EU" });
    expect(eu.region).toBe("EU");
    expect(eu.characterCount).toBe(1);

    apiMocks.getUserInfo.mockResolvedValueOnce({ sub: "bn-us", battletag: "Owner#US" });
    apiMocks.getAccountProfile.mockResolvedValueOnce([
      ownedCharacter({ id: "200001", region: "US", realmName: "Area 52", realmSlug: "area-52", realmId: "3676" }),
    ]);
    const us = await battleNetService.handleCallback({ user: owner, code: "code-us", region: "US" });
    expect(us.region).toBe("US");

    const connections = await battleNetService.listConnections(owner);
    expect(connections).toHaveLength(2);
    expect(connections.map((row) => row.region).sort()).toEqual(["EU", "US"]);
  });

  it("upserts on reconnect for the same userId+region without duplicating rows", async () => {
    await battleNetService.handleCallback({ user: owner, code: "code-1", region: "EU" });
    apiMocks.getUserInfo.mockResolvedValueOnce({ sub: "bn-eu-2", battletag: "Owner#9999" });
    await battleNetService.handleCallback({ user: owner, code: "code-2", region: "EU" });

    const rows = await orm.BattleNetConnection.where({ userId: ids.owner, region: "EU" }).all();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.battleTag)).toBe("Owner#9999");
    expect(String(rows[0]?.battleNetAccountId)).toBe("bn-eu-2");
  });

  it("creates an import session and never persists OAuth token fields on the connection", async () => {
    const result = await battleNetService.handleCallback({
      user: owner,
      code: "code-tokenless",
      region: "EU",
    });

    const session = await battleNetService.getImportSession(owner, result.importSessionId);
    expect(session.region).toBe("EU");
    expect(session.characters).toHaveLength(1);

    const connection = await orm.BattleNetConnection.where({ userId: ids.owner, region: "EU" }).first();
    expect(connection).toBeTruthy();
    const keys = Object.keys(connection as Record<string, unknown>);
    expect(keys).not.toContain("accessToken");
    expect(keys).not.toContain("refreshToken");
    expect(keys).not.toContain("token");
    expect(keys).toEqual(
      expect.arrayContaining([
        "id",
        "userId",
        "region",
        "battleNetAccountId",
        "battleTag",
        "scope",
        "connectedAt",
        "lastSuccessfulSyncAt",
        "createdAt",
        "updatedAt",
      ]),
    );
    expect(apiMocks.exchangeAuthorizationCode).toHaveBeenCalledWith("code-tokenless");
  });

  it("throws BATTLENET_NOT_CONFIGURED when env is missing during callback", async () => {
    vi.stubEnv("BLIZZARD_CLIENT_ID", "");
    vi.stubEnv("BLIZZARD_CLIENT_SECRET", "");
    vi.stubEnv("BLIZZARD_REDIRECT_URI", "");

    await expectDomainCode(
      battleNetService.handleCallback({ user: owner, code: "x", region: "EU" }),
      "BATTLENET_NOT_CONFIGURED",
    );
  });
});

describe("battleNetService import sessions", () => {
  const owner = asUser(ids.owner);
  const other = asUser(ids.other, "BattleNet Other");

  it("binds sessions to owner and region, and rejects expiry", async () => {
    const connected = await battleNetService.handleCallback({
      user: owner,
      code: "code-session",
      region: "EU",
    });

    const live = await battleNetService.getImportSession(owner, connected.importSessionId);
    expect(live.region).toBe("EU");
    expect(live.characters[0]?.region).toBe("EU");

    await expectDomainCode(
      battleNetService.getImportSession(other, connected.importSessionId),
      "BATTLENET_IMPORT_SESSION_NOT_FOUND",
    );

    const expiredId = crypto.randomUUID();
    await orm.BattleNetImportSession.create({
      id: expiredId,
      userId: ids.owner,
      region: "US",
      charactersJson: JSON.stringify([ownedCharacter({ region: "US" })]),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      consumedAt: null,
      createdAt: new Date().toISOString(),
    });

    await expectDomainCode(
      battleNetService.getImportSession(owner, expiredId),
      "BATTLENET_IMPORT_SESSION_EXPIRED",
    );
  });
});

describe("battleNetService.disconnect", () => {
  const owner = asUser(ids.owner);

  it("removes the connection and import sessions but preserves characters", async () => {
    await battleNetService.handleCallback({ user: owner, code: "code-disc", region: "EU" });

    const character = await characterService.createCharacter(owner, {
      name: "Keepme",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 640,
    });
    createdCharacterIds.push(character.id);

    await battleNetService.disconnect(owner, "EU");

    const connections = await battleNetService.listConnections(owner);
    expect(connections.find((row) => row.region === "EU")).toBeUndefined();
    const sessions = await orm.BattleNetImportSession.where({ userId: ids.owner, region: "EU" }).all();
    expect(sessions).toHaveLength(0);

    const kept = await orm.Character.where({ id: character.id }).first();
    expect(kept).toBeTruthy();
    expect(String(kept?.name)).toBe("Keepme");
  });
});
