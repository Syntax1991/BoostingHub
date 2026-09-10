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
import { characterBlizzardSyncService } from "@/services/character-blizzard-sync.service";
import { characterService } from "@/services/character.service";
import { characterRepository } from "@/repositories/character.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { getCurrentLockoutRaid } from "@/lib/wow-raid-catalog";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import type { BlizzardCharacterRaidEncounters } from "@/lib/blizzard/types";

const ids = {
  owner: "aaaaaaaa-aaaa-4aaa-8aaa-bn0000000021",
  other: "aaaaaaaa-aaaa-4aaa-8aaa-bn0000000022",
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

describe("characterBlizzardSyncService.refreshCharacter", () => {
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
    const result = await characterBlizzardImportService.importCharacters(owner, session.id, [
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

    const refreshed = await characterBlizzardSyncService.refreshCharacter(owner, characterId);
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

    const refreshed = await characterBlizzardSyncService.refreshCharacter(owner, characterId);
    // Item level was 650 from the initial import; a missing value on refresh
    // never becomes 0 or null — the last known value is preserved, and the
    // rest of the sync (name/lastSyncedAt) still proceeds.
    expect(refreshed.itemLevel).toBe(650);
    expect(refreshed.lastSyncedAt).toBeTruthy();
  });

  it("enforces BLIZZARD_REFRESH_COOLDOWN", async () => {
    const { characterId } = await importLinkedShaman("300031", "Bncool");

    await expectDomainCode(
      characterBlizzardSyncService.refreshCharacter(owner, characterId),
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
      characterBlizzardSyncService.refreshCharacter(owner, manual.id),
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

    const refreshed = await characterBlizzardSyncService.refreshCharacter(owner, characterId);
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
    const refreshed = await characterBlizzardSyncService.refreshCharacter(owner, characterId);
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

    const refreshed = await characterBlizzardSyncService.refreshCharacter(owner, characterId);
    expect(refreshed.itemLevel).toBe(710);

    const lockouts = await orm.CharacterRaidLockout.where({ characterId }).all();
    expect(lockouts).toHaveLength(1);
    expect(Number(lockouts[0]?.bossesDefeated)).toBe(5);
  });
});

describe("characterBlizzardSyncService.refreshLinkedCharactersForRegion", () => {
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
    const euImport = await characterBlizzardImportService.importCharacters(owner, euSession.id, [
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
    const usImport = await characterBlizzardImportService.importCharacters(owner, usSession.id, [
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
    const inactiveImport = await characterBlizzardImportService.importCharacters(owner, inactiveSession.id, [
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

    const result = await characterBlizzardSyncService.refreshLinkedCharactersForRegion(owner, "EU");
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
    const coolImport = await characterBlizzardImportService.importCharacters(owner, session.id, [
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
    const hotImport = await characterBlizzardImportService.importCharacters(owner, session.id, [
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

    const result = await characterBlizzardSyncService.refreshLinkedCharactersForRegion(owner, "EU");
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
    const imported = await characterBlizzardImportService.importCharacters(other, session.id, [
      { blizzardCharacterId: owned.id, specialization: "Restoration" },
    ]);
    createdCharacterIds.push(...imported.importedCharacterIds);

    await seedConnectionAndSession(ids.owner, "EU", []);
    const result = await characterBlizzardSyncService.refreshLinkedCharactersForRegion(owner, "EU");
    expect(result.total).toBe(0);
    expect(Number((await orm.Character.where({ id: imported.importedCharacterIds[0] }).first())?.itemLevel)).toBe(
      660,
    );
  });
});
