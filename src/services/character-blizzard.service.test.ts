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
    level: 90,
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

describe("characterBlizzardService.resolveImportCandidates", () => {
  const owner = asUser(ids.owner);

  it("lists candidates from the session without calling live profile APIs", async () => {
    const owned = ownedCharacter();
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    apiMocks.getCharacterProfileStatus.mockClear();
    apiMocks.getCharacterProfileSummary.mockClear();

    const result = await characterBlizzardService.resolveImportCandidates(owner, session.id);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.status).toBe("import");
    expect(result.candidates[0]?.suggestedSpecialization).toBeNull();
    expect(result.candidates[0]?.suggestedItemLevel).toBeNull();
    expect(apiMocks.getCharacterProfileStatus).not.toHaveBeenCalled();
    expect(apiMocks.getCharacterProfileSummary).not.toHaveBeenCalled();
  });

  it("classifies low-level characters as level_too_low while keeping them visible", async () => {
    const owned = ownedCharacter({ id: "300060", name: "Bnvisible", level: 10 });
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    const result = await characterBlizzardService.resolveImportCandidates(owner, session.id);
    expect(result.candidates[0]?.status).toBe("level_too_low");
    expect(result.candidates[0]?.level).toBe(10);
    expect(result.candidates[0]?.name).toBe("Bnvisible");
  });
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
      { specialization: "Elemental" },
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
      characterBlizzardService.linkCharacter(owner, session.id, owned.id, manual.id, {
        specialization: "Arcane",
      }),
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
      { blizzardCharacterId: owned.id, specialization: "Restoration", itemLevel: 610 },
    ]);
    createdCharacterIds.push(...result.importedCharacterIds);

    const created = await orm.Character.where({ id: result.importedCharacterIds[0] }).first();
    expect(Number(created?.itemLevel)).toBe(610);
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

describe("characterBlizzardService.applySelections", () => {
  const owner = asUser(ids.owner);

  it("imports and links mixed selections in one call", async () => {
    const toImport = ownedCharacter({ id: "300040", name: "Bnbatchimport" });
    const toLink = ownedCharacter({ id: "300041", name: "Bnbatchlink" });
    const manual = await characterService.createCharacter(owner, {
      name: toLink.name,
      realm: toLink.realmName,
      region: toLink.region,
      wowClass: toLink.wowClass,
      specialization: "Elemental",
      itemLevel: 600,
    });
    createdCharacterIds.push(manual.id);

    const session = await seedConnectionAndSession(ids.owner, "EU", [toImport, toLink]);
    mockEnrichmentSuccess({
      id: toImport.id,
      name: toImport.name,
      realmId: toImport.realmId,
      wowClass: toImport.wowClass,
      itemLevel: 680,
      specialization: "Enhancement",
    });

    const result = await characterBlizzardService.applySelections(owner, session.id, [
      { blizzardCharacterId: toImport.id, specialization: "Enhancement" },
      { blizzardCharacterId: toLink.id, specialization: "Restoration" },
    ]);

    expect(result.importedCharacterIds).toHaveLength(1);
    expect(result.linkedCharacterIds).toEqual([manual.id]);
    createdCharacterIds.push(...result.importedCharacterIds);

    const created = await orm.Character.where({ id: result.importedCharacterIds[0] }).first();
    expect(String(created?.specialization)).toBe("Enhancement");
    expect(Number(created?.itemLevel)).toBe(680);

    const linked = await orm.Character.where({ id: manual.id }).first();
    expect(String(linked?.blizzardCharacterId)).toBe(toLink.id);
    expect(String(linked?.specialization)).toBe("Restoration");
    expect(String(linked?.primaryRole)).toBe("HEALER");
    expect(Number(linked?.itemLevel)).toBe(680);
  });

  it("rejects forged blizzardCharacterId not present in the session", async () => {
    const owned = ownedCharacter({ id: "300042", name: "Bnreal" });
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    await expectDomainCode(
      characterBlizzardService.applySelections(owner, session.id, [
        { blizzardCharacterId: "999999", specialization: "Restoration" },
      ]),
      "BLIZZARD_CHARACTER_NOT_OWNED",
    );
  });

  it("validates missing specialization before creating any Character", async () => {
    const first = ownedCharacter({ id: "300043", name: "Bnfirst" });
    const second = ownedCharacter({ id: "300044", name: "Bnsecond" });
    const session = await seedConnectionAndSession(ids.owner, "EU", [first, second]);
    mockEnrichmentPrivacyFailure();

    await expectDomainCode(
      characterBlizzardService.applySelections(owner, session.id, [
        { blizzardCharacterId: first.id, specialization: "Enhancement", itemLevel: 600 },
        { blizzardCharacterId: second.id, specialization: "" },
      ]),
      "INVALID_SPECIALIZATION",
    );

    const created = await orm.Character.where({ userId: ids.owner, name: "Bnfirst" }).all();
    expect(created).toHaveLength(0);
  });

  it("rejects characters below level 90 on import and link", async () => {
    const lowImport = ownedCharacter({ id: "300050", name: "Bnlow", level: 89 });
    const lowLink = ownedCharacter({ id: "300051", name: "Bnlowlink", level: 70 });
    const manual = await characterService.createCharacter(owner, {
      name: lowLink.name,
      realm: lowLink.realmName,
      region: lowLink.region,
      wowClass: lowLink.wowClass,
      specialization: "Elemental",
      itemLevel: 400,
    });
    createdCharacterIds.push(manual.id);

    const importSession = await seedConnectionAndSession(ids.owner, "EU", [lowImport]);
    const candidates = await characterBlizzardService.resolveImportCandidates(
      owner,
      importSession.id,
    );
    expect(candidates.candidates[0]?.status).toBe("level_too_low");

    await expectDomainCode(
      characterBlizzardService.applySelections(owner, importSession.id, [
        { blizzardCharacterId: lowImport.id, specialization: "Enhancement", itemLevel: 500 },
      ]),
      "BLIZZARD_LEVEL_TOO_LOW",
    );

    const linkSession = await seedConnectionAndSession(ids.owner, "EU", [lowLink]);
    await expectDomainCode(
      characterBlizzardService.applySelections(owner, linkSession.id, [
        { blizzardCharacterId: lowLink.id, specialization: "Elemental", itemLevel: 500 },
      ]),
      "BLIZZARD_LEVEL_TOO_LOW",
    );
  });

  it("allows level 90 and keeps user-chosen specialization over Blizzard prefill", async () => {
    const owned = ownedCharacter({ id: "300052", name: "Bnchoice", level: 90 });
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    mockEnrichmentSuccess({
      id: owned.id,
      name: owned.name,
      realmId: owned.realmId,
      wowClass: owned.wowClass,
      itemLevel: 318,
      specialization: "Restoration",
    });

    const result = await characterBlizzardService.applySelections(owner, session.id, [
      { blizzardCharacterId: owned.id, specialization: "Elemental", itemLevel: 999 },
    ]);
    createdCharacterIds.push(...result.importedCharacterIds);

    const created = await orm.Character.where({ id: result.importedCharacterIds[0] }).first();
    expect(String(created?.specialization)).toBe("Elemental");
    expect(String(created?.primaryRole)).toBe("DPS");
    expect(Number(created?.itemLevel)).toBe(318);
    expect(created?.lastSyncedAt).toBeTruthy();
  });

  it("rejects invalid class specialization", async () => {
    const owned = ownedCharacter({ id: "300053", name: "Bnbads", wowClass: "MAGE" });
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    mockEnrichmentSuccess({
      id: owned.id,
      name: owned.name,
      realmId: owned.realmId,
      wowClass: owned.wowClass,
      itemLevel: 400,
    });
    await expectDomainCode(
      characterBlizzardService.applySelections(owner, session.id, [
        { blizzardCharacterId: owned.id, specialization: "Restoration" },
      ]),
      "INVALID_CLASS_SPECIALIZATION",
    );
  });

  it("requires manual itemLevel when Blizzard profile is unavailable", async () => {
    const owned = ownedCharacter({ id: "300054", name: "Bnmanualilvl" });
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    mockEnrichmentPrivacyFailure();

    await expectDomainCode(
      characterBlizzardService.applySelections(owner, session.id, [
        { blizzardCharacterId: owned.id, specialization: "Enhancement" },
      ]),
      "INVALID_ITEM_LEVEL",
    );

    const result = await characterBlizzardService.applySelections(owner, session.id, [
      { blizzardCharacterId: owned.id, specialization: "Enhancement", itemLevel: 317 },
    ]);
    createdCharacterIds.push(...result.importedCharacterIds);
    const created = await orm.Character.where({ id: result.importedCharacterIds[0] }).first();
    expect(Number(created?.itemLevel)).toBe(317);
    expect(created?.lastSyncedAt).toBeNull();
  });

  it("rejects negative manual itemLevel", async () => {
    const owned = ownedCharacter({ id: "300055", name: "Bnnegilvl" });
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    mockEnrichmentPrivacyFailure();
    await expectDomainCode(
      characterBlizzardService.applySelections(owner, session.id, [
        { blizzardCharacterId: owned.id, specialization: "Enhancement", itemLevel: -1 },
      ]),
      "INVALID_ITEM_LEVEL",
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
