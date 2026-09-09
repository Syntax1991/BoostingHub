import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import type { OwnedBlizzardCharacter } from "@/lib/blizzard/types";
import { battleNetConnectionRepository } from "@/repositories/battle-net-connection.repository";
import { battleNetImportSessionRepository } from "@/repositories/battle-net-import-session.repository";

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

import { characterBlizzardService } from "@/services/character-blizzard.service";
import { characterService } from "@/services/character.service";

const ids = {
  owner: "aaaaaaaa-aaaa-4aaa-8aaa-bn0000000011",
  other: "aaaaaaaa-aaaa-4aaa-8aaa-bn0000000012",
};

const createdCharacterIds: string[] = [];

function asUser(id: string, name = "Blizzard Owner"): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@bnchar.boostting.local`,
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

async function createTestUser(id: string, name: string) {
  await orm.User.create({
    id,
    name,
    email: `${id}@bnchar.boostting.local`,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function deleteIfPresent(
  table: "User" | "Character" | "BattleNetConnection" | "BattleNetImportSession" | "BoosterAccess" | "ActivityEvent",
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
    if (table === "BoosterAccess") {
      await orm.BoosterAccess.where({ id }).delete();
      return;
    }
    await orm.ActivityEvent.where({ id }).delete();
  } catch {
    // Already gone from a previous isolated run.
  }
}

async function cleanupGeneratedRows() {
  for (const userId of [ids.owner, ids.other]) {
    const access = await orm.BoosterAccess.where({ userId }).all();
    for (const row of access) {
      await deleteIfPresent("BoosterAccess", String(row.id));
    }
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
    id: "300001",
    name: "Bnlinkme",
    realmId: "1301",
    realmName: "Twisting Nether",
    realmSlug: "twisting-nether",
    wowClass: "SHAMAN",
    level: 80,
    region: "EU",
    ...overrides,
  };
}

async function seedConnectionAndSession(
  userId: string,
  region: "EU" | "US",
  characters: OwnedBlizzardCharacter[],
) {
  await battleNetConnectionRepository.upsert({
    userId,
    region,
    battleNetAccountId: `acct-${userId}-${region}`,
    battleTag: `Tag#${region}`,
    scope: "wow.profile openid",
  });

  const session = await battleNetImportSessionRepository.create({
    userId,
    region,
    characters,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  });

  return session;
}

function mockEnrichmentSuccess(input: {
  id: string;
  name: string;
  realmId: string;
  wowClass: OwnedBlizzardCharacter["wowClass"];
  itemLevel: number;
  specialization?: string | null;
}) {
  apiMocks.getCharacterProfileStatus.mockResolvedValue({ id: input.id, isValid: true });
  apiMocks.getCharacterProfileSummary.mockResolvedValue({
    id: input.id,
    name: input.name,
    realmId: input.realmId,
    realmSlug: "twisting-nether",
    realmName: "Twisting Nether",
    wowClass: input.wowClass,
    equippedItemLevel: input.itemLevel,
    activeSpecialization: input.specialization ?? "Restoration",
  });
}

function mockEnrichmentPrivacyFailure() {
  apiMocks.getCharacterProfileStatus.mockRejectedValue(new Error("profile private"));
  apiMocks.getCharacterProfileSummary.mockRejectedValue(new Error("profile private"));
}

beforeAll(async () => {
  vi.stubEnv("BLIZZARD_CLIENT_ID", "test-client-id");
  vi.stubEnv("BLIZZARD_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("BLIZZARD_REDIRECT_URI", "http://localhost:3000/api/integrations/battlenet/callback");
  await cleanupGeneratedRows();
  await createTestUser(ids.owner, "Blizzard Owner");
  await createTestUser(ids.other, "Blizzard Other");
});

afterAll(async () => {
  await cleanupGeneratedRows();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getClientCredentialsToken.mockResolvedValue("client-token");
});

afterEach(async () => {
  for (const userId of [ids.owner, ids.other]) {
    const access = await orm.BoosterAccess.where({ userId }).all();
    for (const row of access) {
      await deleteIfPresent("BoosterAccess", String(row.id));
    }
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
  }
  createdCharacterIds.length = 0;
});

describe("characterBlizzardService.linkCharacter", () => {
  const owner = asUser(ids.owner);

  it("links an exact manual name/realm/class match", async () => {
    const owned = ownedCharacter();
    const manual = await characterService.createCharacter(owner, {
      name: owned.name,
      realm: owned.realmName,
      region: owned.region,
      wowClass: owned.wowClass,
      specialization: "Elemental",
      itemLevel: 600,
    });
    createdCharacterIds.push(manual.id);

    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    mockEnrichmentSuccess({
      id: owned.id,
      name: owned.name,
      realmId: owned.realmId,
      wowClass: owned.wowClass,
      itemLevel: 655,
    });

    const linked = await characterBlizzardService.linkCharacter(
      owner,
      session.id,
      owned.id,
      manual.id,
    );
    expect(linked.characterId).toBe(manual.id);

    const row = await orm.Character.where({ id: manual.id }).first();
    expect(String(row?.blizzardCharacterId)).toBe(owned.id);
    expect(String(row?.blizzardRealmId)).toBe(owned.realmId);
    expect(Number(row?.itemLevel)).toBe(655);
    expect(row?.lastSyncedAt).toBeTruthy();
  });

  it("rejects class mismatch with BLIZZARD_IDENTITY_CONFLICT", async () => {
    const owned = ownedCharacter({ wowClass: "MAGE", id: "300010" });
    const manual = await characterService.createCharacter(owner, {
      name: owned.name,
      realm: owned.realmName,
      region: owned.region,
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 600,
    });
    createdCharacterIds.push(manual.id);

    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);

    await expectDomainCode(
      characterBlizzardService.linkCharacter(owner, session.id, owned.id, manual.id),
      "BLIZZARD_IDENTITY_CONFLICT",
    );
  });
});

describe("characterBlizzardService.importCharacters", () => {
  const owner = asUser(ids.owner);
  const other = asUser(ids.other, "Blizzard Other");

  it("imports a Character with Blizzard ids and does not grant BoosterAccess", async () => {
    const owned = ownedCharacter({ id: "300020", name: "Bnfresh" });
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    mockEnrichmentSuccess({
      id: owned.id,
      name: owned.name,
      realmId: owned.realmId,
      wowClass: owned.wowClass,
      itemLevel: 670,
      specialization: "Enhancement",
    });

    const result = await characterBlizzardService.importCharacters(owner, session.id, [
      { blizzardCharacterId: owned.id, specialization: "Enhancement" },
    ]);
    expect(result.importedCharacterIds).toHaveLength(1);
    createdCharacterIds.push(...result.importedCharacterIds);

    const created = await orm.Character.where({ id: result.importedCharacterIds[0] }).first();
    expect(created).toBeTruthy();
    expect(String(created?.blizzardCharacterId)).toBe(owned.id);
    expect(String(created?.blizzardRealmId)).toBe(owned.realmId);
    expect(Number(created?.itemLevel)).toBe(670);
    expect(created?.lastSyncedAt).toBeTruthy();
    expect(String(created?.specialization)).toBe("Enhancement");
    expect(String(created?.primaryRole)).toBe("DPS");

    const access = await orm.BoosterAccess.where({ userId: ids.owner }).all();
    expect(access).toHaveLength(0);
    const byCharacter = await orm.BoosterAccess.where({
      characterId: result.importedCharacterIds[0],
    }).all();
    expect(byCharacter).toHaveLength(0);
  });

  it("still imports when profile enrichment fails, without lastSyncedAt", async () => {
    const owned = ownedCharacter({ id: "300021", name: "Bnprivate" });
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    mockEnrichmentPrivacyFailure();

    const result = await characterBlizzardService.importCharacters(owner, session.id, [
      { blizzardCharacterId: owned.id, specialization: "Restoration" },
    ]);
    createdCharacterIds.push(...result.importedCharacterIds);

    const created = await orm.Character.where({ id: result.importedCharacterIds[0] }).first();
    expect(Number(created?.itemLevel)).toBe(0);
    expect(created?.lastSyncedAt).toBeNull();
    expect(String(created?.blizzardCharacterId)).toBe(owned.id);
  });

  it("conflicts when the Blizzard identity is already linked to another user", async () => {
    const owned = ownedCharacter({ id: "300022", name: "Bntaken" });
    const otherSession = await seedConnectionAndSession(ids.other, "EU", [owned]);
    mockEnrichmentSuccess({
      id: owned.id,
      name: owned.name,
      realmId: owned.realmId,
      wowClass: owned.wowClass,
      itemLevel: 640,
    });
    const imported = await characterBlizzardService.importCharacters(other, otherSession.id, [
      { blizzardCharacterId: owned.id, specialization: "Restoration" },
    ]);
    createdCharacterIds.push(...imported.importedCharacterIds);

    const ownerSession = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    await expectDomainCode(
      characterBlizzardService.importCharacters(owner, ownerSession.id, [
        { blizzardCharacterId: owned.id, specialization: "Restoration" },
      ]),
      "BLIZZARD_IDENTITY_CONFLICT",
    );
  });
});

describe("characterBlizzardService.refreshCharacter", () => {
  const owner = asUser(ids.owner);

  async function importLinkedShaman(blizzardId: string, name: string) {
    const owned = ownedCharacter({ id: blizzardId, name });
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    mockEnrichmentSuccess({
      id: owned.id,
      name: owned.name,
      realmId: owned.realmId,
      wowClass: owned.wowClass,
      itemLevel: 650,
      specialization: "Restoration",
    });
    const result = await characterBlizzardService.importCharacters(owner, session.id, [
      { blizzardCharacterId: owned.id, specialization: "Restoration" },
    ]);
    createdCharacterIds.push(...result.importedCharacterIds);
    return { owned, characterId: result.importedCharacterIds[0]! };
  }

  it("updates itemLevel without changing specialization or primaryRole", async () => {
    const { owned, characterId } = await importLinkedShaman("300030", "Bnrefresh");

    // Clear cooldown from import sync.
    await orm.Character.where({ id: characterId }).update({
      lastSyncedAt: new Date(Date.now() - 120_000).toISOString(),
    });

    mockEnrichmentSuccess({
      id: owned.id,
      name: owned.name,
      realmId: owned.realmId,
      wowClass: owned.wowClass,
      itemLevel: 690,
      specialization: "Elemental",
    });

    const refreshed = await characterBlizzardService.refreshCharacter(owner, characterId);
    expect(refreshed.itemLevel).toBe(690);
    expect(refreshed.specialization).toBe("Restoration");
    expect(refreshed.primaryRole).toBe("HEALER");
    expect(refreshed.lastSyncedAt).toBeTruthy();
  });

  it("enforces BLIZZARD_REFRESH_COOLDOWN", async () => {
    const { characterId } = await importLinkedShaman("300031", "Bncool");

    await expectDomainCode(
      characterBlizzardService.refreshCharacter(owner, characterId),
      "BLIZZARD_REFRESH_COOLDOWN",
    );
  });

  it("rejects refresh for an unlinked character", async () => {
    const manual = await characterService.createCharacter(owner, {
      name: "Bnmanual",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 600,
    });
    createdCharacterIds.push(manual.id);

    await battleNetConnectionRepository.upsert({
      userId: ids.owner,
      region: "EU",
      battleNetAccountId: "acct-manual",
      battleTag: "Tag#EU",
      scope: "wow.profile openid",
    });

    await expectDomainCode(
      characterBlizzardService.refreshCharacter(owner, manual.id),
      "BLIZZARD_CHARACTER_NOT_FOUND",
    );
  });

  it("safely renames when scoped Blizzard identity still matches", async () => {
    const { owned, characterId } = await importLinkedShaman("300032", "Bnoldname");

    await orm.Character.where({ id: characterId }).update({
      lastSyncedAt: new Date(Date.now() - 120_000).toISOString(),
    });

    mockEnrichmentSuccess({
      id: owned.id,
      name: "Bnnewname",
      realmId: owned.realmId,
      wowClass: owned.wowClass,
      itemLevel: 680,
      specialization: "Restoration",
    });

    const refreshed = await characterBlizzardService.refreshCharacter(owner, characterId);
    expect(refreshed.name).toBe("Bnnewname");
    expect(refreshed.blizzardCharacterId).toBe(owned.id);
    expect(refreshed.blizzardRealmId).toBe(owned.realmId);
    expect(refreshed.itemLevel).toBe(680);
  });
});
