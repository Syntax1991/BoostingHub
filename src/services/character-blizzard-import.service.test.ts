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
import { characterWarcraftLogsService } from "@/services/character-warcraft-logs.service";
import { characterRepository } from "@/repositories/character.repository";
import { characterBlizzardSyncService } from "@/services/character-blizzard-sync.service";
import { characterOperationsService } from "@/services/character-operations.service";

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

describe("characterBlizzardImportService.autoLinkExistingCharacters", () => {
  const owner = asUser(ids.owner);

  it("links exact manual matches on connect, imports nothing, and skips class mismatches", async () => {
    const match = ownedCharacter({ id: "300101", name: "Bnautoone" });
    const mismatch = ownedCharacter({ id: "300102", name: "Bnautotwo", wowClass: "MAGE" });
    const notOnSite = ownedCharacter({ id: "300103", name: "Bnautothree" });
    const lowLevel = ownedCharacter({ id: "300104", name: "Bnautofour", level: 20 });
    const manualMatch = await characterService.createCharacter(owner, {
      name: match.name,
      realm: match.realmName,
      region: match.region,
      wowClass: match.wowClass,
      specialization: "Elemental",
      itemLevel: 600,
    });
    const manualMismatch = await characterService.createCharacter(owner, {
      name: mismatch.name,
      realm: mismatch.realmName,
      region: mismatch.region,
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 600,
    });
    const manualLow = await characterService.createCharacter(owner, {
      name: lowLevel.name,
      realm: lowLevel.realmName,
      region: lowLevel.region,
      wowClass: lowLevel.wowClass,
      specialization: "Elemental",
      itemLevel: 600,
    });
    createdCharacterIds.push(manualMatch.id, manualMismatch.id, manualLow.id);
    const session = await seedConnectionAndSession(ids.owner, "EU", [match, mismatch, notOnSite, lowLevel]);
    mockEnrichmentSuccess({ id: match.id, name: match.name, realmId: match.realmId, wowClass: match.wowClass, itemLevel: 661, specialization: "Enhancement" });

    const result = await characterBlizzardImportService.autoLinkExistingCharacters(owner, session.id);

    expect(result.linkedCharacterIds).toEqual([manualMatch.id]);
    const linked = await orm.Character.where({ id: manualMatch.id }).first();
    expect(String(linked?.blizzardCharacterId)).toBe(match.id);
    expect(String(linked?.blizzardRealmId)).toBe(match.realmId);
    // The owner's chosen specialization is kept; Blizzard supplies item level.
    expect(String(linked?.specialization)).toBe("Elemental");
    expect(Number(linked?.itemLevel)).toBe(661);
    for (const id of [manualMismatch.id, manualLow.id]) {
      const untouched = await orm.Character.where({ id }).first();
      expect(untouched?.blizzardCharacterId ?? null).toBeNull();
    }
    const owned = await orm.Character.where({ userId: ids.owner }).all();
    expect(owned).toHaveLength(3);
  });

  it("links a manual Character that was already synced from the public API (no ids stamped by public sync)", async () => {
    const owned = ownedCharacter({ id: "300121", name: "Bnautopublic" });
    const manual = await characterService.createCharacter(owner, {
      name: owned.name,
      realm: owned.realmName,
      region: owned.region,
      wowClass: owned.wowClass,
      specialization: "Elemental",
      itemLevel: 600,
    });
    createdCharacterIds.push(manual.id);
    // State after PUBLIC syncs: fresh data, still no Blizzard identity.
    await orm.Character.where({ id: manual.id }).update({
      lastSyncedAt: new Date().toISOString(),
      lastSyncAttemptAt: new Date().toISOString(),
      itemLevel: 640,
    });
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);
    mockEnrichmentSuccess({ id: owned.id, name: owned.name, realmId: owned.realmId, wowClass: owned.wowClass, itemLevel: 645 });

    const result = await characterBlizzardImportService.autoLinkExistingCharacters(owner, session.id);

    expect(result.linkedCharacterIds).toEqual([manual.id]);
    const row = await orm.Character.where({ id: manual.id }).first();
    expect(String(row?.blizzardCharacterId)).toBe(owned.id);
    expect(Number(row?.itemLevel)).toBe(645);
  });

  it("never links another user's Character with the same name", async () => {
    const owned = ownedCharacter({ id: "300111", name: "Bnautoother" });
    const others = await characterService.createCharacter(asUser(ids.other, "Blizzard Other"), {
      name: owned.name,
      realm: owned.realmName,
      region: owned.region,
      wowClass: owned.wowClass,
      specialization: "Elemental",
      itemLevel: 600,
    });
    createdCharacterIds.push(others.id);
    const session = await seedConnectionAndSession(ids.owner, "EU", [owned]);

    const result = await characterBlizzardImportService.autoLinkExistingCharacters(owner, session.id);

    expect(result.linkedCharacterIds).toEqual([]);
    const row = await orm.Character.where({ id: others.id }).first();
    expect(row?.blizzardCharacterId ?? null).toBeNull();
  });
});

describe("reconcileBattleNetCharactersForConnection (already-connected accounts, no reconnect)", () => {
  const owner = asUser(ids.owner);
  const other = asUser(ids.other, "Blizzard Other");
  const reconcile = () => characterBlizzardImportService.reconcileBattleNetCharactersForConnection(ids.owner, "EU");

  /** Connection + an EXPIRED, consumed OAuth roster snapshot (the state of accounts connected before deploy). */
  async function seedConnectedWithStoredRoster(characters: OwnedBlizzardCharacter[]) {
    const session = await seedConnectionAndSession(ids.owner, "EU", characters);
    await orm.BattleNetImportSession.where({ id: session.id }).update({
      expiresAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
    });
    await battleNetImportSessionRepository.markConsumed(session.id);
  }

  async function manual(user: AuthenticatedUser, input: { name: string; realm?: string; wowClass?: OwnedBlizzardCharacter["wowClass"]; specialization?: string }) {
    const created = await characterService.createCharacter(user, {
      name: input.name,
      realm: input.realm ?? "Twisting Nether",
      region: "EU",
      wowClass: input.wowClass ?? "SHAMAN",
      specialization: input.specialization ?? "Elemental",
      itemLevel: 600,
    });
    createdCharacterIds.push(created.id);
    return created;
  }

  async function ownerCharacterCount() {
    return (await orm.Character.where({ userId: ids.owner }).all()).length;
  }

  it("links the existing row from the stored roster: same id, ids populated, spec/role kept, no duplicate", async () => {
    const owned = ownedCharacter({ id: "300201", name: "Bnrecone" });
    const row = await manual(owner, { name: owned.name, specialization: "Elemental" });
    await seedConnectedWithStoredRoster([owned]);
    mockEnrichmentSuccess({ id: owned.id, name: owned.name, realmId: owned.realmId, wowClass: owned.wowClass, itemLevel: 662, specialization: "Enhancement" });

    const result = await reconcile();

    expect(result).toMatchObject({ status: "RECONCILED", linkedCharacterIds: [row.id], alreadyLinked: 0, skipped: 0, failed: 0 });
    const linked = (await characterRepository.findById(row.id))!;
    expect(linked.blizzardCharacterId).toBe(owned.id);
    expect(linked.blizzardRealmId).toBe(owned.realmId);
    expect(linked.itemLevel).toBe(662);
    expect(linked.specialization).toBe("Elemental");
    expect(linked.primaryRole).toBe("DPS");
    expect(linked.wowClass).toBe("SHAMAN");
    expect(await ownerCharacterCount()).toBe(1);
  });

  it("is idempotent: a second run changes nothing and reports the entry as already linked", async () => {
    const owned = ownedCharacter({ id: "300202", name: "Bnrectwo" });
    const row = await manual(owner, { name: owned.name });
    await seedConnectedWithStoredRoster([owned]);
    mockEnrichmentSuccess({ id: owned.id, name: owned.name, realmId: owned.realmId, wowClass: owned.wowClass, itemLevel: 650 });

    await reconcile();
    const afterFirst = (await characterRepository.findById(row.id))!;
    const second = await reconcile();

    expect(second).toMatchObject({ status: "RECONCILED", linkedCharacterIds: [], alreadyLinked: 1, skipped: 0, failed: 0 });
    const afterSecond = (await characterRepository.findById(row.id))!;
    expect(afterSecond.blizzardCharacterId).toBe(afterFirst.blizzardCharacterId);
    expect(afterSecond.blizzardRealmId).toBe(afterFirst.blizzardRealmId);
    expect(afterSecond.updatedAt).toBe(afterFirst.updatedAt);
    expect(await ownerCharacterCount()).toBe(1);
  });

  it("never imports unknown Blizzard characters and ignores roster entries below level 90", async () => {
    const unknown = ownedCharacter({ id: "300203", name: "Bnrecunknown" });
    const low = ownedCharacter({ id: "300204", name: "Bnreclow", level: 42 });
    const lowRow = await manual(owner, { name: low.name });
    await seedConnectedWithStoredRoster([unknown, low]);
    mockEnrichmentSuccess({ id: unknown.id, name: unknown.name, realmId: unknown.realmId, wowClass: unknown.wowClass, itemLevel: 650 });

    const result = await reconcile();

    expect(result.linkedCharacterIds).toEqual([]);
    expect(await ownerCharacterCount()).toBe(1);
    expect((await characterRepository.findById(lowRow.id))!.blizzardCharacterId).toBeNull();
  });

  it("wrong class: not linked, class not mutated", async () => {
    const owned = ownedCharacter({ id: "300205", name: "Bnrecclass", wowClass: "MAGE" });
    const row = await manual(owner, { name: owned.name, wowClass: "SHAMAN" });
    await seedConnectedWithStoredRoster([owned]);

    const result = await reconcile();

    expect(result).toMatchObject({ linkedCharacterIds: [], skipped: 1 });
    const after = (await characterRepository.findById(row.id))!;
    expect(after.blizzardCharacterId).toBeNull();
    expect(after.wowClass).toBe("SHAMAN");
  });

  it("an existing row already linked to different Blizzard ids is never overwritten", async () => {
    const owned = ownedCharacter({ id: "300206", name: "Bnreclinked" });
    const row = await manual(owner, { name: owned.name });
    await orm.Character.where({ id: row.id }).update({ blizzardCharacterId: "999206", blizzardRealmId: "1301" });
    await seedConnectedWithStoredRoster([owned]);

    const result = await reconcile();

    expect(result).toMatchObject({ linkedCharacterIds: [], skipped: 1 });
    expect((await characterRepository.findById(row.id))!.blizzardCharacterId).toBe("999206");
  });

  it("a Blizzard identity already linked to another user's Character is not linked again (no duplicate)", async () => {
    const owned = ownedCharacter({ id: "300207", name: "Bnrectaken" });
    const othersRow = await manual(other, { name: owned.name });
    await orm.Character.where({ id: othersRow.id }).update({ blizzardCharacterId: owned.id, blizzardRealmId: owned.realmId });
    const mine = await manual(owner, { name: owned.name });
    await seedConnectedWithStoredRoster([owned]);

    const result = await reconcile();

    expect(result.linkedCharacterIds).toEqual([]);
    expect((await characterRepository.findById(mine.id))!.blizzardCharacterId).toBeNull();
    expect((await characterRepository.findById(othersRow.id))!.userId).toBe(ids.other);
  });

  it("never links another user's Character, and realm mismatches are not fuzzy-matched", async () => {
    const owned = ownedCharacter({ id: "300208", name: "Bnrecother" });
    const othersRow = await manual(other, { name: owned.name });
    const wrongRealm = ownedCharacter({ id: "300209", name: "Bnrecrealm" });
    const mineOtherRealm = await manual(owner, { name: wrongRealm.name, realm: "Silvermoon" });
    await seedConnectedWithStoredRoster([owned, wrongRealm]);

    const result = await reconcile();

    expect(result.linkedCharacterIds).toEqual([]);
    expect((await characterRepository.findById(othersRow.id))!.blizzardCharacterId).toBeNull();
    expect((await characterRepository.findById(mineOtherRealm.id))!.blizzardCharacterId).toBeNull();
  });

  it("skips a stored-roster entry whose live Blizzard identity changed (rename / re-created character)", async () => {
    const owned = ownedCharacter({ id: "300210", name: "Bnreclive" });
    const row = await manual(owner, { name: owned.name });
    await seedConnectedWithStoredRoster([owned]);
    mockEnrichmentSuccess({ id: "399999", name: owned.name, realmId: owned.realmId, wowClass: owned.wowClass, itemLevel: 650 });

    const result = await reconcile();

    expect(result).toMatchObject({ linkedCharacterIds: [], skipped: 1 });
    expect((await characterRepository.findById(row.id))!.blizzardCharacterId).toBeNull();
  });

  it("exact names only: a renamed / similar roster name is not fuzzy-matched", async () => {
    const owned = ownedCharacter({ id: "300214", name: "Bnrecname" });
    const similar = await manual(owner, { name: "Bnrecnamex" });
    await seedConnectedWithStoredRoster([owned]);
    mockEnrichmentSuccess({ id: owned.id, name: owned.name, realmId: owned.realmId, wowClass: owned.wowClass, itemLevel: 650 });

    const result = await reconcile();

    expect(result).toMatchObject({ linkedCharacterIds: [], alreadyLinked: 0, skipped: 0 });
    expect((await characterRepository.findById(similar.id))!.blizzardCharacterId).toBeNull();
    expect(await ownerCharacterCount()).toBe(1);
  });

  it("keeps the owner's healer spec + role and the row's weekly availability even when Blizzard's active spec is DPS", async () => {
    const owned = ownedCharacter({ id: "300215", name: "Bnrecheal" });
    const row = await manual(owner, { name: owned.name, specialization: "Restoration" });
    const now = new Date().toISOString();
    await orm.CharacterWeeklyUnavailability.create({
      id: crypto.randomUUID(),
      characterId: row.id,
      resetIdentifier: "2026-EU-reset",
      difficulty: "HEROIC",
      createdAt: now,
      updatedAt: now,
    });
    await seedConnectedWithStoredRoster([owned]);
    mockEnrichmentSuccess({ id: owned.id, name: owned.name, realmId: owned.realmId, wowClass: owned.wowClass, itemLevel: 663, specialization: "Elemental" });

    const result = await reconcile();

    expect(result.linkedCharacterIds).toEqual([row.id]);
    const linked = (await characterRepository.findById(row.id))!;
    expect(linked).toMatchObject({ blizzardCharacterId: owned.id, specialization: "Restoration", primaryRole: "HEALER", userId: ids.owner });
    expect(await orm.CharacterWeeklyUnavailability.where({ characterId: row.id }).all()).toHaveLength(1);
    await orm.CharacterWeeklyUnavailability.where({ characterId: row.id }).delete();
  });

  it("reports NO_CONNECTION / NO_SNAPSHOT without touching anything", async () => {
    const owned = ownedCharacter({ id: "300211", name: "Bnrecnone" });
    const row = await manual(owner, { name: owned.name });
    expect((await reconcile()).status).toBe("NO_CONNECTION");
    await battleNetConnectionRepository.upsert({
      userId: ids.owner,
      region: "EU",
      battleNetAccountId: `acct-${ids.owner}-EU`,
      battleTag: "Tag#EU",
      scope: "wow.profile openid",
    });
    expect((await reconcile()).status).toBe("NO_SNAPSHOT");
    expect((await characterRepository.findById(row.id))!.blizzardCharacterId).toBeNull();
  });

  it("owner Refresh all on a connected region reconciles first (no reconnect)", async () => {
    const owned = ownedCharacter({ id: "300212", name: "Bnrecrefresh" });
    const row = await manual(owner, { name: owned.name });
    await seedConnectedWithStoredRoster([owned]);
    mockEnrichmentSuccess({ id: owned.id, name: owned.name, realmId: owned.realmId, wowClass: owned.wowClass, itemLevel: 655 });

    const outcome = await characterBlizzardSyncService.refreshLinkedCharactersForRegion(owner, "EU");

    expect(outcome.linked).toBe(1);
    // Linking already pulled the Blizzard profile (a real attempt), so the same
    // pass skips it under the normal 60s cooldown instead of fetching twice.
    expect(outcome.total).toBe(1);
    expect(outcome.skipped).toBe(1);
    expect((await characterRepository.findById(row.id))!.lastSyncedAt).toBeTruthy();
    expect((await characterRepository.findById(row.id))!.blizzardCharacterId).toBe(owned.id);
    expect(await ownerCharacterCount()).toBe(1);
  });

  it("admin backfill reconciles every connection, isolated and idempotent", async () => {
    const owned = ownedCharacter({ id: "300213", name: "Bnrecadmin" });
    const row = await manual(owner, { name: owned.name });
    await seedConnectedWithStoredRoster([owned]);
    mockEnrichmentSuccess({ id: owned.id, name: owned.name, realmId: owned.realmId, wowClass: owned.wowClass, itemLevel: 650 });
    const admin: AuthenticatedUser = { ...asUser(ids.other, "Blizzard Other"), accountRole: "ADMIN" };

    const first = await characterOperationsService.reconcileBattleNetLinks(admin);
    expect(first.linked).toBeGreaterThanOrEqual(1);
    expect((await characterRepository.findById(row.id))!.blizzardCharacterId).toBe(owned.id);
    const second = await characterOperationsService.reconcileBattleNetLinks(admin);
    expect(second.linked).toBe(0);
    expect(second.alreadyLinked).toBeGreaterThanOrEqual(1);
    expect(await ownerCharacterCount()).toBe(1);

    await expect(characterOperationsService.reconcileBattleNetLinks(owner)).rejects.toMatchObject({ code: expect.any(String) });
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

describe("Battle.net bulk import × Warcraft Logs batch enrichment", () => {
  const owner = asUser(ids.owner);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finishes core imports/links + activity before one WCL batch; WCL failure does not affect import", async () => {
    const existing = await characterService.createCharacter(owner, {
      name: "Wcllinkme",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 630,
    });
    createdCharacterIds.push(existing.id);

    const ownedA = ownedCharacter({ id: "300201", name: "Wclimpone" });
    const ownedB = ownedCharacter({ id: "300202", name: "Wclimptwo", wowClass: "MAGE" });
    const ownedLink = ownedCharacter({ id: "300203", name: "Wcllinkme" });
    const session = await seedConnectionAndSession(ids.owner, "EU", [ownedA, ownedB, ownedLink]);

    apiMocks.getCharacterProfileStatus.mockImplementation(async (_region, _realm, name) => {
      const map: Record<string, string> = {
        wclimpone: ownedA.id,
        wclimptwo: ownedB.id,
        wcllinkme: ownedLink.id,
      };
      return { id: map[name.toLowerCase()] ?? "unknown", isValid: true };
    });
    apiMocks.getCharacterProfileSummary.mockImplementation(async (_region, _realm, name) => {
      const lower = name.toLowerCase();
      if (lower === "wclimpone") {
        return {
          id: ownedA.id,
          name: ownedA.name,
          realmId: ownedA.realmId,
          realmSlug: "twisting-nether",
          realmName: "Twisting Nether",
          wowClass: ownedA.wowClass,
          equippedItemLevel: 650,
          activeSpecialization: "Enhancement",
        };
      }
      if (lower === "wclimptwo") {
        return {
          id: ownedB.id,
          name: ownedB.name,
          realmId: ownedB.realmId,
          realmSlug: "twisting-nether",
          realmName: "Twisting Nether",
          wowClass: ownedB.wowClass,
          equippedItemLevel: 651,
          activeSpecialization: "Frost",
        };
      }
      return {
        id: ownedLink.id,
        name: ownedLink.name,
        realmId: ownedLink.realmId,
        realmSlug: "twisting-nether",
        realmName: "Twisting Nether",
        wowClass: ownedLink.wowClass,
        equippedItemLevel: 652,
        activeSpecialization: "Restoration",
      };
    });

    const oneSpy = vi.spyOn(characterWarcraftLogsService, "tryAutoLinkIfMissing");
    const manySpy = vi
      .spyOn(characterWarcraftLogsService, "tryAutoLinkManyIfMissing")
      .mockImplementation(async (characterIds) => {
        // Core writes + activity must already be durable when enrichment starts.
        const chars = await characterRepository.listByUserId(ids.owner);
        expect(chars.some((c) => c.name === "Wclimpone" && c.blizzardCharacterId === ownedA.id)).toBe(
          true,
        );
        expect(chars.some((c) => c.name === "Wclimptwo" && c.blizzardCharacterId === ownedB.id)).toBe(
          true,
        );
        const linked = await characterRepository.findById(existing.id);
        expect(linked?.blizzardCharacterId).toBe(ownedLink.id);

        const activities = await orm.ActivityEvent.where({ userId: ids.owner }).all();
        expect(
          activities.some(
            (row) => String((row as { type?: string }).type) === "BATTLENET_CHARACTERS_IMPORTED",
          ),
        ).toBe(true);
        expect(
          activities.some(
            (row) => String((row as { type?: string }).type) === "BATTLENET_CHARACTER_LINKED",
          ),
        ).toBe(true);

        const connection = await battleNetConnectionRepository.findByUserAndRegion(ids.owner, "EU");
        expect(connection?.lastSuccessfulSyncAt).not.toBeNull();

        expect(characterIds).toHaveLength(3);
        return {
          total: 3,
          attempted: 0,
          linked: 0,
          alreadyLinked: 0,
          notFound: 0,
          mismatch: 0,
          unsupportedRegion: 0,
          temporaryFailure: 1,
          skippedAfterFailure: 2,
        };
      });

    const result = await characterBlizzardImportService.applySelections(owner, session.id, [
      { blizzardCharacterId: ownedA.id, specialization: "Enhancement" },
      { blizzardCharacterId: ownedB.id, specialization: "Frost" },
      { blizzardCharacterId: ownedLink.id, specialization: "Restoration" },
    ]);
    createdCharacterIds.push(...result.importedCharacterIds);

    expect(result.importedCharacterIds).toHaveLength(2);
    expect(result.linkedCharacterIds).toEqual([existing.id]);
    expect(oneSpy).not.toHaveBeenCalled();
    expect(manySpy).toHaveBeenCalledTimes(1);
    expect(manySpy.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([...result.importedCharacterIds, ...result.linkedCharacterIds]),
    );
  });
});
