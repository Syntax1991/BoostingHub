import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
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
// Warcraft Logs auto-link enrichment runs after Character writes/syncs; keep it
// offline (a real WARCRAFT_LOGS_* in .env would otherwise hit the live API).
vi.mock("@/integrations/warcraft-logs/warcraft-logs-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/warcraft-logs/warcraft-logs-api-client")>()),
  warcraftLogsApiClient: {
    isConfigured: () => true,
    findCharacter: async () => ({ status: "NOT_FOUND" as const }),
  },
}));

import { blizzardApiClient } from "@/integrations/blizzard/blizzard-api-client";
import { battleNetService } from "@/services/battle-net.service";
import { characterService } from "@/services/character.service";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows } from "@tests/fixtures/db-fixtures";
import { expectDomainError } from "@tests/helpers/domain-error";

/** Connections, import sessions, Characters and activity cascade with their User. */
const created = { userIds: [] as string[] };
/** Fresh per test, since tests count the owner's connections and sessions. */
let owner: AuthenticatedUser;
let other: AuthenticatedUser;

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

beforeAll(() => {
  assertIsolatedTestDatabase();
});

afterAll(async () => {
  try {
    await deleteCreatedRows(created);
  } finally {
    vi.unstubAllEnvs();
  }
});

beforeEach(async () => {
  const ownerId = await createTestUser({ name: "BattleNet Owner" });
  const otherId = await createTestUser({ name: "BattleNet Other" });
  created.userIds.push(ownerId, otherId);
  owner = testActor(ownerId, "USER", { name: "BattleNet Owner" });
  other = testActor(otherId, "USER", { name: "BattleNet Other" });
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

describe("battleNetService.beginConnect", () => {
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

    expect(() => battleNetService.beginConnect(owner, "EU")).toThrow(expect.objectContaining({ code: "BATTLENET_NOT_CONFIGURED" }));
  });
});

describe("battleNetService.handleCallback", () => {
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

    const rows = await orm.BattleNetConnection.where({ userId: owner.id, region: "EU" }).all();
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

    const connection = await orm.BattleNetConnection.where({ userId: owner.id, region: "EU" }).first();
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

    await expectDomainError(
      battleNetService.handleCallback({ user: owner, code: "x", region: "EU" }),
      "BATTLENET_NOT_CONFIGURED",
    );
  });
});

describe("battleNetService import sessions", () => {
  it("binds sessions to owner and region, and rejects expiry", async () => {
    const connected = await battleNetService.handleCallback({
      user: owner,
      code: "code-session",
      region: "EU",
    });

    const live = await battleNetService.getImportSession(owner, connected.importSessionId);
    expect(live.region).toBe("EU");
    expect(live.characters[0]?.region).toBe("EU");

    await expectDomainError(
      battleNetService.getImportSession(other, connected.importSessionId),
      "BATTLENET_IMPORT_SESSION_NOT_FOUND",
    );

    const expiredId = crypto.randomUUID();
    await orm.BattleNetImportSession.create({
      id: expiredId,
      userId: owner.id,
      region: "US",
      charactersJson: JSON.stringify([ownedCharacter({ region: "US" })]),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      consumedAt: null,
      createdAt: new Date().toISOString(),
    });

    await expectDomainError(
      battleNetService.getImportSession(owner, expiredId),
      "BATTLENET_IMPORT_SESSION_EXPIRED",
    );
  });
});

describe("battleNetService.disconnect", () => {
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

    await battleNetService.disconnect(owner, "EU");

    const connections = await battleNetService.listConnections(owner);
    expect(connections.find((row) => row.region === "EU")).toBeUndefined();
    const sessions = await orm.BattleNetImportSession.where({ userId: owner.id, region: "EU" }).all();
    expect(sessions).toHaveLength(0);

    const kept = await orm.Character.where({ id: character.id }).first();
    expect(kept).toBeTruthy();
    expect(String(kept?.name)).toBe("Keepme");
  });
});
