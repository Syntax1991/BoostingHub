import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { resetWarcraftLogsClientTokenCacheForTests } from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { characterService } from "@/services/character.service";
import { characterWarcraftLogsService } from "@/services/character-warcraft-logs.service";

const ids = {
  owner: "cccccccc-cccc-4ccc-8ccc-wcl000000001",
  other: "cccccccc-cccc-4ccc-8ccc-wcl000000002",
};

const createdCharacterIds: string[] = [];
const fetchMock = vi.fn();

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@wcl.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function ensureUser(id: string, name: string) {
  await orm.User.create({
    id,
    name,
    email: `${id}@wcl.boostting.local`,
    emailVerified: false,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).catch(() => {});
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockWclSuccess(canonicalID: number, id = canonicalID) {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ access_token: "t", expires_in: 3600, token_type: "Bearer" }))
    .mockResolvedValueOnce(
      jsonResponse({
        data: {
          characterData: {
            character: {
              id,
              canonicalID,
              name: "Wclsyn",
              server: { slug: "kazzak", region: { slug: "eu" } },
            },
          },
        },
      }),
    );
}

function mockWclNotFound() {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ access_token: "t", expires_in: 3600, token_type: "Bearer" }))
    .mockResolvedValueOnce(jsonResponse({ data: { characterData: { character: null } } }));
}

beforeAll(async () => {
  await ensureUser(ids.owner, "WCL Owner");
  await ensureUser(ids.other, "WCL Other");
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  resetWarcraftLogsClientTokenCacheForTests();
  vi.stubEnv("WARCRAFT_LOGS_CLIENT_ID", "wcl-client");
  vi.stubEnv("WARCRAFT_LOGS_CLIENT_SECRET", "wcl-secret");
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetWarcraftLogsClientTokenCacheForTests();
});

afterAll(async () => {
  for (const id of createdCharacterIds) {
    await orm.Character.where({ id }).delete().catch(() => {});
  }
});

describe("characterWarcraftLogsService", () => {
  const owner = asUser(ids.owner, "WCL Owner");
  const other = asUser(ids.other, "WCL Other");

  it("persists a discovered ID when missing and isolates create from WCL failure", async () => {
    mockWclSuccess(424242);
    // Bypass Blizzard for createCharacter unit path used by tests that call createCharacter directly
    // — createCharacter itself now auto-links.
    const created = await characterService.createCharacter(owner, {
      name: "Wclsyn",
      realm: "Kazzak",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 640,
    });
    createdCharacterIds.push(created.id);
    expect(created.warcraftLogsId).toBe("424242");

    // Failure isolation: NOT_FOUND leaves Character intact with null ID
    vi.stubEnv("WARCRAFT_LOGS_CLIENT_ID", "wcl-client");
    resetWarcraftLogsClientTokenCacheForTests();
    fetchMock.mockReset();
    mockWclNotFound();
    const missing = await characterService.createCharacter(owner, {
      name: "Wclnone",
      realm: "Draenor",
      region: "EU",
      wowClass: "MAGE",
      specialization: "Frost",
      itemLevel: 600,
    });
    createdCharacterIds.push(missing.id);
    expect(missing.warcraftLogsId).toBeNull();
  });

  it("does not overwrite an existing different ID and rejects wrong owner", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Wclkeep",
      realm: "Silvermoon",
      region: "EU",
      wowClass: "PRIEST",
      specialization: "Holy",
      itemLevel: 610,
    });
    createdCharacterIds.push(character.id);
    // Clear auto-link from create (may have failed or not configured mid-test); force a stored ID.
    await orm.Character.where({ id: character.id }).update({ warcraftLogsId: "111" });

    resetWarcraftLogsClientTokenCacheForTests();
    fetchMock.mockReset();
    mockWclSuccess(222);
    const mismatch = await characterWarcraftLogsService.linkForOwner(owner, character.id);
    expect(mismatch).toEqual({ status: "MISMATCH", storedId: "111", discoveredId: "222" });
    const reloaded = await orm.Character.where({ id: character.id }).first();
    expect((reloaded as { warcraftLogsId: string | null }).warcraftLogsId).toBe("111");

    resetWarcraftLogsClientTokenCacheForTests();
    fetchMock.mockReset();
    mockWclSuccess(111);
    const same = await characterWarcraftLogsService.linkForOwner(owner, character.id);
    expect(same).toEqual({ status: "ALREADY_LINKED", warcraftLogsId: "111" });

    await expect(characterWarcraftLogsService.linkForOwner(other, character.id)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CHARACTER_NOT_OWNED",
    );
  });

  it("returns NOT_CONFIGURED and TEMPORARY_FAILURE without mutating identity", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Wclcfg",
      realm: "Outland",
      region: "EU",
      wowClass: "WARLOCK",
      specialization: "Affliction",
      itemLevel: 605,
    });
    createdCharacterIds.push(character.id);
    await orm.Character.where({ id: character.id }).update({ warcraftLogsId: null });

    vi.stubEnv("WARCRAFT_LOGS_CLIENT_ID", "");
    vi.stubEnv("WARCRAFT_LOGS_CLIENT_SECRET", "");
    const missingConfig = await characterWarcraftLogsService.linkForOwner(owner, character.id);
    expect(missingConfig).toEqual({ status: "NOT_CONFIGURED" });

    vi.stubEnv("WARCRAFT_LOGS_CLIENT_ID", "wcl-client");
    vi.stubEnv("WARCRAFT_LOGS_CLIENT_SECRET", "wcl-secret");
    resetWarcraftLogsClientTokenCacheForTests();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "down" }, 503));
    const temporary = await characterWarcraftLogsService.linkForOwner(owner, character.id);
    expect(temporary.status).toBe("TEMPORARY_FAILURE");
    const reloaded = await orm.Character.where({ id: character.id }).first();
    expect((reloaded as { warcraftLogsId: string | null }).warcraftLogsId).toBeNull();
  });

  it("skips network when tryAutoLinkIfMissing already has an ID", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Wclskip",
      realm: "Auchindoun",
      region: "EU",
      wowClass: "DRUID",
      specialization: "Restoration",
      itemLevel: 615,
    });
    createdCharacterIds.push(character.id);
    await orm.Character.where({ id: character.id }).update({ warcraftLogsId: "555" });
    fetchMock.mockReset();
    const result = await characterWarcraftLogsService.tryAutoLinkIfMissing(character.id);
    expect(result).toEqual({ status: "ALREADY_LINKED", warcraftLogsId: "555" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
