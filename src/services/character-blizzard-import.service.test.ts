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
  getCharacterRaidEncounters: vi.fn(),
}));

vi.mock("@/integrations/blizzard/blizzard-api-client", () => ({
  blizzardApiClient: apiMocks,
}));

import { characterBlizzardImportService } from "@/services/character-blizzard-import.service";
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
  apiMocks.getCharacterRaidEncounters.mockRejectedValue(new Error("encounters unavailable"));
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

describe("characterBlizzardImportService.resolveImportCandidates", () => {
  const owner = asUser(ids.owner);

  it("lists candidates from the session without calling live profile APIs", async () => {
    const owned = ownedCharacter();
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    apiMocks.getCharacterProfileStatus.mockClear();
    apiMocks.getCharacterProfileSummary.mockClear();

    const result = await characterBlizzardImportService.resolveImportCandidates(owner, session.id);

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
    const result = await characterBlizzardImportService.resolveImportCandidates(owner, session.id);
    expect(result.candidates[0]?.status).toBe("level_too_low");
    expect(result.candidates[0]?.level).toBe(10);
    expect(result.candidates[0]?.name).toBe("Bnvisible");
  });
});

describe("characterBlizzardImportService.linkCharacter", () => {
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

    const linked = await characterBlizzardImportService.linkCharacter(
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
      characterBlizzardImportService.linkCharacter(owner, session.id, owned.id, manual.id, {
        specialization: "Arcane",
      }),
      "BLIZZARD_IDENTITY_CONFLICT",
    );
  });
});

describe("characterBlizzardImportService.importCharacters", () => {
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

    const result = await characterBlizzardImportService.importCharacters(owner, session.id, [
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

  it("still imports when profile enrichment fails, with unknown item level and no lastSyncedAt", async () => {
    const owned = ownedCharacter({ id: "300021", name: "Bnprivate" });
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    mockEnrichmentPrivacyFailure();

    const result = await characterBlizzardImportService.importCharacters(owner, session.id, [
      { blizzardCharacterId: owned.id, specialization: "Restoration" },
    ]);
    createdCharacterIds.push(...result.importedCharacterIds);

    const created = await orm.Character.where({ id: result.importedCharacterIds[0] }).first();
    expect(created?.itemLevel).toBeNull();
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
    const imported = await characterBlizzardImportService.importCharacters(other, otherSession.id, [
      { blizzardCharacterId: owned.id, specialization: "Restoration" },
    ]);
    createdCharacterIds.push(...imported.importedCharacterIds);

    const ownerSession = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    await expectDomainCode(
      characterBlizzardImportService.importCharacters(owner, ownerSession.id, [
        { blizzardCharacterId: owned.id, specialization: "Restoration" },
      ]),
      "BLIZZARD_IDENTITY_CONFLICT",
    );
  });
});

describe("characterBlizzardImportService.applySelections", () => {
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

    const result = await characterBlizzardImportService.applySelections(owner, session.id, [
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
      characterBlizzardImportService.applySelections(owner, session.id, [
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
      characterBlizzardImportService.applySelections(owner, session.id, [
        { blizzardCharacterId: first.id, specialization: "Enhancement" },
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
    const candidates = await characterBlizzardImportService.resolveImportCandidates(
      owner,
      importSession.id,
    );
    expect(candidates.candidates[0]?.status).toBe("level_too_low");

    await expectDomainCode(
      characterBlizzardImportService.applySelections(owner, importSession.id, [
        { blizzardCharacterId: lowImport.id, specialization: "Enhancement" },
      ]),
      "BLIZZARD_LEVEL_TOO_LOW",
    );

    const linkSession = await seedConnectionAndSession(ids.owner, "EU", [lowLink]);
    await expectDomainCode(
      characterBlizzardImportService.applySelections(owner, linkSession.id, [
        { blizzardCharacterId: lowLink.id, specialization: "Elemental" },
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

    const result = await characterBlizzardImportService.applySelections(owner, session.id, [
      { blizzardCharacterId: owned.id, specialization: "Elemental" },
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
      characterBlizzardImportService.applySelections(owner, session.id, [
        { blizzardCharacterId: owned.id, specialization: "Restoration" },
      ]),
      "INVALID_CLASS_SPECIALIZATION",
    );
  });

  it("imports with unknown item level when Blizzard profile is unavailable — no manual prompt, not rejected", async () => {
    const owned = ownedCharacter({ id: "300054", name: "Bnmanualilvl" });
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    mockEnrichmentPrivacyFailure();

    const result = await characterBlizzardImportService.applySelections(owner, session.id, [
      { blizzardCharacterId: owned.id, specialization: "Enhancement" },
    ]);
    createdCharacterIds.push(...result.importedCharacterIds);
    const created = await orm.Character.where({ id: result.importedCharacterIds[0] }).first();
    expect(created?.itemLevel).toBeNull();
    expect(created?.lastSyncedAt).toBeNull();
  });
});

describe("characterService.addCharacterFromBlizzard (public lookup, no ownership proof)", () => {
  const owner = asUser(ids.owner);

  it("ignores a forged wowClass/itemLevel and persists Blizzard's authoritative values", async () => {
    apiMocks.getCharacterProfileStatus.mockResolvedValue({ id: "400001", isValid: true });
    apiMocks.getCharacterProfileSummary.mockResolvedValue({
      id: "400001",
      name: "Synblast",
      realmId: "1301",
      realmSlug: "antonidas",
      realmName: "Antonidas",
      wowClass: "SHAMAN",
      equippedItemLevel: 326,
      activeSpecialization: "Restoration",
    });

    // A malicious/stale browser cannot influence wowClass or itemLevel: the
    // public payload type has no such fields, and the server re-resolves
    // both from Blizzard regardless of anything the request body claims.
    const created = await characterService.addCharacterFromBlizzard(owner, {
      name: "Synblast",
      realm: "Antonidas",
      region: "EU",
      specialization: "Elemental",
    });
    createdCharacterIds.push(created.id);

    expect(created.wowClass).toBe("SHAMAN");
    expect(created.itemLevel).toBe(326);
    expect(created.specialization).toBe("Elemental");
    expect(created.primaryRole).toBe("DPS");
    expect(created.blizzardCharacterId).toBeNull();
  });

  it("resolves with unknown item level when Blizzard does not supply one", async () => {
    apiMocks.getCharacterProfileStatus.mockResolvedValue({ id: "400002", isValid: true });
    apiMocks.getCharacterProfileSummary.mockResolvedValue({
      id: "400002",
      name: "Nogeario",
      realmId: "1301",
      realmSlug: "antonidas",
      realmName: "Antonidas",
      wowClass: "PRIEST",
      equippedItemLevel: null,
      activeSpecialization: null,
    });

    const created = await characterService.addCharacterFromBlizzard(owner, {
      name: "Nogeario",
      realm: "Antonidas",
      region: "EU",
      specialization: "Holy",
    });
    createdCharacterIds.push(created.id);

    expect(created.itemLevel).toBeNull();
    expect(created.wowClass).toBe("PRIEST");
  });

  it("rejects a specialization that does not belong to the Blizzard class", async () => {
    apiMocks.getCharacterProfileStatus.mockResolvedValue({ id: "400003", isValid: true });
    apiMocks.getCharacterProfileSummary.mockResolvedValue({
      id: "400003",
      name: "Wrongspec",
      realmId: "1301",
      realmSlug: "antonidas",
      realmName: "Antonidas",
      wowClass: "SHAMAN",
      equippedItemLevel: 300,
      activeSpecialization: null,
    });

    await expectDomainCode(
      characterService.addCharacterFromBlizzard(owner, {
        name: "Wrongspec",
        realm: "Antonidas",
        region: "EU",
        specialization: "Holy",
      }),
      "INVALID_CLASS_SPECIALIZATION",
    );
  });

  it("rejects lookup when Blizzard reports the character does not exist", async () => {
    apiMocks.getCharacterProfileStatus.mockResolvedValue({ id: "", isValid: false });

    await expectDomainCode(
      characterService.addCharacterFromBlizzard(owner, {
        name: "Ghostname",
        realm: "Antonidas",
        region: "EU",
        specialization: "Holy",
      }),
      "BLIZZARD_CHARACTER_NOT_FOUND",
    );
  });

  it("previewCharacterFromBlizzard returns Blizzard data without persisting anything", async () => {
    apiMocks.getCharacterProfileStatus.mockResolvedValue({ id: "400004", isValid: true });
    apiMocks.getCharacterProfileSummary.mockResolvedValue({
      id: "400004",
      name: "Previewonly",
      realmId: "1301",
      realmSlug: "antonidas",
      realmName: "Antonidas",
      wowClass: "WARRIOR",
      equippedItemLevel: 450,
      activeSpecialization: "Fury",
    });

    const preview = await characterService.previewCharacterFromBlizzard({
      name: "Previewonly",
      realm: "Antonidas",
      region: "EU",
    });
    expect(preview.wowClass).toBe("WARRIOR");
    expect(preview.itemLevel).toBe(450);

    const stored = await orm.Character.where({ userId: ids.owner, name: "Previewonly" }).all();
    expect(stored).toHaveLength(0);
  });
});
