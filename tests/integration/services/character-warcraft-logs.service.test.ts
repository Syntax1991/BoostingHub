import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { resetWarcraftLogsClientTokenCacheForTests } from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { characterService } from "@/services/character.service";
import { characterWarcraftLogsService } from "@/services/character-warcraft-logs.service";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows } from "@tests/fixtures/db-fixtures";
import { expectDomainError } from "@tests/helpers/domain-error";

/** Characters cascade with their owner, so the users are all there is to delete. */
const created = { userIds: [] as string[] };
const fetchMock = vi.fn();
let owner: AuthenticatedUser;
let other: AuthenticatedUser;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const tokenResponse = () => jsonResponse({ access_token: "t", expires_in: 3600, token_type: "Bearer" });

/** The OAuth token, then a character lookup that finds `canonicalID`. */
function mockWclFound(canonicalID: number) {
  fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
    jsonResponse({
      data: {
        characterData: {
          character: { id: canonicalID, canonicalID, name: "Wclsyn", server: { slug: "kazzak", region: { slug: "eu" } } },
        },
      },
    }),
  );
}

function mockWclNotFound() {
  fetchMock
    .mockResolvedValueOnce(tokenResponse())
    .mockResolvedValueOnce(jsonResponse({ data: { characterData: { character: null } } }));
}

/** Fresh WCL client state: credentials configured, no cached token, no queued responses. */
function resetWcl() {
  vi.stubEnv("WARCRAFT_LOGS_CLIENT_ID", "wcl-client");
  vi.stubEnv("WARCRAFT_LOGS_CLIENT_SECRET", "wcl-secret");
  resetWarcraftLogsClientTokenCacheForTests();
  fetchMock.mockReset();
}

async function storedWarcraftLogsId(characterId: string) {
  return ((await orm.Character.where({ id: characterId }).first()) as { warcraftLogsId: string | null }).warcraftLogsId;
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  const ownerId = await createTestUser({ name: "WCL Owner" });
  const otherId = await createTestUser({ name: "WCL Other" });
  created.userIds.push(ownerId, otherId);
  owner = testActor(ownerId);
  other = testActor(otherId);
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  resetWcl();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetWarcraftLogsClientTokenCacheForTests();
});

afterAll(() => deleteCreatedRows(created));

describe("characterWarcraftLogsService", () => {
  it("persists a discovered ID when missing and isolates create from WCL failure", async () => {
    // createCharacter links Warcraft Logs itself.
    mockWclFound(424242);
    const linked = await characterService.createCharacter(owner, {
      name: "Wclsyn",
      realm: "Kazzak",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 640,
    });
    expect(linked.warcraftLogsId).toBe("424242");

    // NOT_FOUND still creates the Character, without an id.
    resetWcl();
    mockWclNotFound();
    const unlinked = await characterService.createCharacter(owner, {
      name: "Wclnone",
      realm: "Draenor",
      region: "EU",
      wowClass: "MAGE",
      specialization: "Frost",
      itemLevel: 600,
    });
    expect(unlinked.warcraftLogsId).toBeNull();
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
    await orm.Character.where({ id: character.id }).update({ warcraftLogsId: "111" });

    resetWcl();
    mockWclFound(222);
    const mismatch = await characterWarcraftLogsService.linkForOwner(owner, character.id);
    expect(mismatch).toEqual({ status: "MISMATCH", storedId: "111", discoveredId: "222" });
    expect(await storedWarcraftLogsId(character.id)).toBe("111");

    resetWcl();
    mockWclFound(111);
    const same = await characterWarcraftLogsService.linkForOwner(owner, character.id);
    expect(same).toEqual({ status: "ALREADY_LINKED", warcraftLogsId: "111" });

    await expectDomainError(characterWarcraftLogsService.linkForOwner(other, character.id), "CHARACTER_NOT_OWNED");
    expect(await storedWarcraftLogsId(character.id)).toBe("111");
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
    await orm.Character.where({ id: character.id }).update({ warcraftLogsId: null });

    vi.stubEnv("WARCRAFT_LOGS_CLIENT_ID", "");
    vi.stubEnv("WARCRAFT_LOGS_CLIENT_SECRET", "");
    expect(await characterWarcraftLogsService.linkForOwner(owner, character.id)).toEqual({ status: "NOT_CONFIGURED" });

    resetWcl();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "down" }, 503));
    const temporary = await characterWarcraftLogsService.linkForOwner(owner, character.id);
    expect(temporary.status).toBe("TEMPORARY_FAILURE");
    expect(await storedWarcraftLogsId(character.id)).toBeNull();
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
    await orm.Character.where({ id: character.id }).update({ warcraftLogsId: "555" });
    fetchMock.mockReset();
    const result = await characterWarcraftLogsService.tryAutoLinkIfMissing(character.id);
    expect(result).toEqual({ status: "ALREADY_LINKED", warcraftLogsId: "555" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
