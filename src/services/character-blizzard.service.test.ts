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

import { characterBlizzardService } from "@/services/character-blizzard.service";
import { characterService } from "@/services/character.service";
import { characterRepository } from "@/repositories/character.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { getCurrentLockoutRaid } from "@/lib/wow-raid-catalog";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import type { BlizzardCharacterRaidEncounters } from "@/lib/blizzard/types";

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

  it("still imports when profile enrichment fails, with unknown item level and no lastSyncedAt", async () => {
    const owned = ownedCharacter({ id: "300021", name: "Bnprivate" });
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    mockEnrichmentPrivacyFailure();

    const result = await characterBlizzardService.importCharacters(owner, session.id, [
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
    const candidates = await characterBlizzardService.resolveImportCandidates(
      owner,
      importSession.id,
    );
    expect(candidates.candidates[0]?.status).toBe("level_too_low");

    await expectDomainCode(
      characterBlizzardService.applySelections(owner, importSession.id, [
        { blizzardCharacterId: lowImport.id, specialization: "Enhancement" },
      ]),
      "BLIZZARD_LEVEL_TOO_LOW",
    );

    const linkSession = await seedConnectionAndSession(ids.owner, "EU", [lowLink]);
    await expectDomainCode(
      characterBlizzardService.applySelections(owner, linkSession.id, [
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

    const result = await characterBlizzardService.applySelections(owner, session.id, [
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
      characterBlizzardService.applySelections(owner, session.id, [
        { blizzardCharacterId: owned.id, specialization: "Restoration" },
      ]),
      "INVALID_CLASS_SPECIALIZATION",
    );
  });

  it("imports with unknown item level when Blizzard profile is unavailable — no manual prompt, not rejected", async () => {
    const owned = ownedCharacter({ id: "300054", name: "Bnmanualilvl" });
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    mockEnrichmentPrivacyFailure();

    const result = await characterBlizzardService.applySelections(owner, session.id, [
      { blizzardCharacterId: owned.id, specialization: "Enhancement" },
    ]);
    createdCharacterIds.push(...result.importedCharacterIds);
    const created = await orm.Character.where({ id: result.importedCharacterIds[0] }).first();
    expect(created?.itemLevel).toBeNull();
    expect(created?.lastSyncedAt).toBeNull();
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

  it("retains the last known itemLevel when Blizzard omits it on an otherwise valid refresh", async () => {
    const { owned, characterId } = await importLinkedShaman("300033", "Bnretain");

    await orm.Character.where({ id: characterId }).update({
      lastSyncedAt: new Date(Date.now() - 120_000).toISOString(),
    });

    apiMocks.getCharacterProfileStatus.mockResolvedValue({ id: owned.id, isValid: true });
    apiMocks.getCharacterProfileSummary.mockResolvedValue({
      id: owned.id,
      name: owned.name,
      realmId: owned.realmId,
      realmSlug: "twisting-nether",
      realmName: "Twisting Nether",
      wowClass: owned.wowClass,
      equippedItemLevel: null,
      activeSpecialization: "Restoration",
    });

    const refreshed = await characterBlizzardService.refreshCharacter(owner, characterId);
    // Item level was 650 from the initial import; a missing value on refresh
    // never becomes 0 or null — the last known value is preserved, and the
    // rest of the sync (name/lastSyncedAt) still proceeds.
    expect(refreshed.itemLevel).toBe(650);
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

  it("persists current-reset lockouts from Blizzard encounters without touching BoosterAccess", async () => {
    await raidRepository.ensureReferenceRaids();
    const { owned, characterId } = await importLinkedShaman("300033", "Bnlockout");
    await orm.Character.where({ id: characterId }).update({
      lastSyncedAt: new Date(Date.now() - 120_000).toISOString(),
    });

    const reset = getRegionalWeeklyReset("EU");
    const killMs = reset.start.getTime() + 3_600_000;
    const catalog = getCurrentLockoutRaid()!;
    const encounters: BlizzardCharacterRaidEncounters = {
      raids: [
        {
          instanceId: String(catalog.blizzardInstanceId),
          instanceName: catalog.name,
          difficulties: [
            {
              difficulty: "NORMAL",
              progressCompleted: 8,
              progressTotal: 8,
              encounters: catalog.bosses.map((boss) => ({
                encounterId: String(boss.blizzardEncounterIds[0]),
                encounterName: boss.name,
                completedCount: 1,
                lastKillTimestampMs: killMs,
              })),
            },
            {
              difficulty: "HEROIC",
              progressCompleted: 0,
              progressTotal: 8,
              encounters: catalog.bosses.map((boss) => ({
                encounterId: String(boss.blizzardEncounterIds[0]),
                encounterName: boss.name,
                completedCount: 0,
                lastKillTimestampMs: null,
              })),
            },
          ],
        },
      ],
    };

    mockEnrichmentSuccess({
      id: owned.id,
      name: owned.name,
      realmId: owned.realmId,
      wowClass: owned.wowClass,
      itemLevel: 700,
      specialization: "Elemental",
    });
    apiMocks.getCharacterRaidEncounters.mockResolvedValue(encounters);

    const beforeAccess = await orm.BoosterAccess.where({ characterId }).all();
    const refreshed = await characterBlizzardService.refreshCharacter(owner, characterId);
    expect(refreshed.itemLevel).toBe(700);
    expect(refreshed.specialization).toBe("Restoration");
    expect(refreshed.primaryRole).toBe("HEALER");

    const lockouts = await orm.CharacterRaidLockout.where({ characterId }).all();
    const current = lockouts.filter(
      (row) => String(row.resetIdentifier) === reset.resetIdentifier,
    );
    const normal = current.find((row) => String(row.difficulty) === "NORMAL");
    const heroic = current.find((row) => String(row.difficulty) === "HEROIC");
    expect(Number(normal?.bossesDefeated)).toBe(8);
    expect(Boolean(normal?.isComplete)).toBe(true);
    expect(Number(heroic?.bossesDefeated)).toBe(0);
    expect(Boolean(heroic?.isComplete)).toBe(false);

    const afterAccess = await orm.BoosterAccess.where({ characterId }).all();
    expect(afterAccess).toHaveLength(beforeAccess.length);
  });

  it("keeps prior lockouts when encounters fail but still updates item level", async () => {
    await raidRepository.ensureReferenceRaids();
    const { owned, characterId } = await importLinkedShaman("300034", "Bnlockfail");
    const reset = getRegionalWeeklyReset("EU");
    const nowIso = new Date().toISOString();
    await orm.CharacterRaidLockout.create({
      id: crypto.randomUUID(),
      characterId,
      raidId: getCurrentLockoutRaid()!.id,
      difficulty: "NORMAL",
      resetIdentifier: reset.resetIdentifier,
      bossesDefeated: 5,
      isComplete: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await orm.Character.where({ id: characterId }).update({
      lastSyncedAt: new Date(Date.now() - 120_000).toISOString(),
    });
    mockEnrichmentSuccess({
      id: owned.id,
      name: owned.name,
      realmId: owned.realmId,
      wowClass: owned.wowClass,
      itemLevel: 710,
      specialization: "Elemental",
    });
    apiMocks.getCharacterRaidEncounters.mockRejectedValue(new Error("timeout"));

    const refreshed = await characterBlizzardService.refreshCharacter(owner, characterId);
    expect(refreshed.itemLevel).toBe(710);

    const lockouts = await orm.CharacterRaidLockout.where({ characterId }).all();
    expect(lockouts).toHaveLength(1);
    expect(Number(lockouts[0]?.bossesDefeated)).toBe(5);
  });
});

describe("characterBlizzardService.refreshLinkedCharactersForRegion", () => {
  const owner = asUser(ids.owner);
  const other = asUser(ids.other, "Blizzard Other");

  it("refreshes only active linked characters in the requested region", async () => {
    const euOwned = ownedCharacter({ id: "300070", name: "Bnrefeu" });
    const euSession = await seedConnectionAndSession(ids.owner, "EU", [euOwned]);
    mockEnrichmentSuccess({
      id: euOwned.id,
      name: euOwned.name,
      realmId: euOwned.realmId,
      wowClass: euOwned.wowClass,
      itemLevel: 640,
      specialization: "Restoration",
    });
    const euImport = await characterBlizzardService.importCharacters(owner, euSession.id, [
      { blizzardCharacterId: euOwned.id, specialization: "Restoration" },
    ]);
    const euId = euImport.importedCharacterIds[0]!;
    createdCharacterIds.push(euId);

    const usOwned = ownedCharacter({ id: "300071", name: "Bnrefus", region: "US", realmId: "57" });
    const usSession = await seedConnectionAndSession(ids.owner, "US", [usOwned]);
    mockEnrichmentSuccess({
      id: usOwned.id,
      name: usOwned.name,
      realmId: usOwned.realmId,
      wowClass: usOwned.wowClass,
      itemLevel: 641,
      specialization: "Restoration",
    });
    const usImport = await characterBlizzardService.importCharacters(owner, usSession.id, [
      { blizzardCharacterId: usOwned.id, specialization: "Restoration" },
    ]);
    const usId = usImport.importedCharacterIds[0]!;
    createdCharacterIds.push(usId);

    const manual = await characterService.createCharacter(owner, {
      name: "Bnmanual",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "MAGE",
      specialization: "Arcane",
      itemLevel: 500,
    });
    createdCharacterIds.push(manual.id);

    const inactiveOwned = ownedCharacter({ id: "300072", name: "Bninactive" });
    const inactiveSession = await seedConnectionAndSession(ids.owner, "EU", [inactiveOwned]);
    mockEnrichmentSuccess({
      id: inactiveOwned.id,
      name: inactiveOwned.name,
      realmId: inactiveOwned.realmId,
      wowClass: inactiveOwned.wowClass,
      itemLevel: 642,
      specialization: "Enhancement",
    });
    const inactiveImport = await characterBlizzardService.importCharacters(owner, inactiveSession.id, [
      { blizzardCharacterId: inactiveOwned.id, specialization: "Enhancement" },
    ]);
    const inactiveId = inactiveImport.importedCharacterIds[0]!;
    createdCharacterIds.push(inactiveId);
    await characterRepository.setActive(inactiveId, false);

    await orm.Character.where({ id: euId }).update({
      lastSyncedAt: new Date(Date.now() - 120_000).toISOString(),
      specialization: "Restoration",
      primaryRole: "HEALER",
      itemLevel: 640,
    });
    await orm.Character.where({ id: usId }).update({
      lastSyncedAt: new Date(Date.now() - 120_000).toISOString(),
      itemLevel: 641,
    });

    mockEnrichmentSuccess({
      id: euOwned.id,
      name: euOwned.name,
      realmId: euOwned.realmId,
      wowClass: euOwned.wowClass,
      itemLevel: 700,
      specialization: "Elemental",
    });

    const result = await characterBlizzardService.refreshLinkedCharactersForRegion(owner, "EU");
    expect(result.total).toBe(1);
    expect(result.refreshed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.lockoutsVerified).toBeGreaterThanOrEqual(0);

    const euRow = await orm.Character.where({ id: euId }).first();
    expect(Number(euRow?.itemLevel)).toBe(700);
    expect(String(euRow?.specialization)).toBe("Restoration");
    expect(String(euRow?.primaryRole)).toBe("HEALER");
    expect(euRow?.lastSyncedAt).toBeTruthy();

    const usRow = await orm.Character.where({ id: usId }).first();
    expect(Number(usRow?.itemLevel)).toBe(641);

    const manualRow = await orm.Character.where({ id: manual.id }).first();
    expect(manualRow?.blizzardCharacterId).toBeNull();
    expect(Number(manualRow?.itemLevel)).toBe(500);

    const inactiveRow = await orm.Character.where({ id: inactiveId }).first();
    expect(Number(inactiveRow?.itemLevel)).toBe(642);
  });

  it("skips cooldown characters and keeps partial successes", async () => {
    const cool = ownedCharacter({ id: "300080", name: "Bncool" });
    const hot = ownedCharacter({ id: "300081", name: "Bnhot" });
    const session = await seedConnectionAndSession(ids.owner, "EU", [cool, hot]);
    mockEnrichmentSuccess({
      id: cool.id,
      name: cool.name,
      realmId: cool.realmId,
      wowClass: cool.wowClass,
      itemLevel: 650,
      specialization: "Restoration",
    });
    const coolImport = await characterBlizzardService.importCharacters(owner, session.id, [
      { blizzardCharacterId: cool.id, specialization: "Restoration" },
    ]);
    createdCharacterIds.push(...coolImport.importedCharacterIds);

    mockEnrichmentSuccess({
      id: hot.id,
      name: hot.name,
      realmId: hot.realmId,
      wowClass: hot.wowClass,
      itemLevel: 651,
      specialization: "Enhancement",
    });
    const hotImport = await characterBlizzardService.importCharacters(owner, session.id, [
      { blizzardCharacterId: hot.id, specialization: "Enhancement" },
    ]);
    createdCharacterIds.push(...hotImport.importedCharacterIds);

    const coolId = coolImport.importedCharacterIds[0]!;
    const hotId = hotImport.importedCharacterIds[0]!;

    await orm.Character.where({ id: coolId }).update({
      lastSyncedAt: new Date().toISOString(),
      itemLevel: 650,
    });
    await orm.Character.where({ id: hotId }).update({
      lastSyncedAt: new Date(Date.now() - 120_000).toISOString(),
      itemLevel: 651,
    });

    mockEnrichmentSuccess({
      id: hot.id,
      name: hot.name,
      realmId: hot.realmId,
      wowClass: hot.wowClass,
      itemLevel: 710,
      specialization: "Elemental",
    });

    const result = await characterBlizzardService.refreshLinkedCharactersForRegion(owner, "EU");
    expect(result.total).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.refreshed).toBe(1);

    expect(Number((await orm.Character.where({ id: coolId }).first())?.itemLevel)).toBe(650);
    expect(Number((await orm.Character.where({ id: hotId }).first())?.itemLevel)).toBe(710);
    expect(String((await orm.Character.where({ id: hotId }).first())?.specialization)).toBe(
      "Enhancement",
    );
  });

  it("does not refresh another user's characters", async () => {
    const owned = ownedCharacter({ id: "300090", name: "Bnother" });
    const session = await seedConnectionAndSession(ids.other, "EU", [owned]);
    mockEnrichmentSuccess({
      id: owned.id,
      name: owned.name,
      realmId: owned.realmId,
      wowClass: owned.wowClass,
      itemLevel: 660,
      specialization: "Restoration",
    });
    const imported = await characterBlizzardService.importCharacters(other, session.id, [
      { blizzardCharacterId: owned.id, specialization: "Restoration" },
    ]);
    createdCharacterIds.push(...imported.importedCharacterIds);

    await seedConnectionAndSession(ids.owner, "EU", []);
    const result = await characterBlizzardService.refreshLinkedCharactersForRegion(owner, "EU");
    expect(result.total).toBe(0);
    expect(Number((await orm.Character.where({ id: imported.importedCharacterIds[0] }).first())?.itemLevel)).toBe(
      660,
    );
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
