import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { blizzardApiClient } from "@/integrations/blizzard/blizzard-api-client";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { serializeEncounterIds } from "@/lib/raid-catalog";
import { venomousCreateInput } from "@/lib/test-run-input";
import type { AccountRole } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { productPlanningService } from "@/services/product-planning.service";
import { raidCatalogService } from "@/services/raid-catalog.service";
import { runService } from "@/services/run.service";

/**
 * Raid lifecycle in the Raid Catalog: Delete (unused), Archive / Restore
 * (referenced or core), Remove duplicate (same Blizzard instance, no planning
 * references) — and the insert-only bootstrap never re-creating a duplicate.
 */

// A bootstrap fixture raid (like Kith'ix in #271) whose Blizzard instance an admin raid already owns.
const FAKE_INSTANCE = 990_077;
const FAKE_ENCOUNTER = 990_078;
const FAKE_SEED_RAID_ID = "f00dface-0000-4000-8000-000000000001";
const FAKE_SEED_BOSS_ID = "f00dface-0000-4000-8000-000000000002";

vi.mock("@/lib/wow-raid-catalog", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/wow-raid-catalog")>();
  return {
    ...original,
    WOW_RAID_CATALOG: [
      ...original.WOW_RAID_CATALOG,
      {
        id: "f00dface-0000-4000-8000-000000000001",
        name: "QA Lair of Duplicates",
        season: "QA",
        blizzardInstanceId: 990_077,
        sortOrder: 99,
        trackLockouts: true,
        availableForRuns: false,
        bosses: [
          {
            id: "f00dface-0000-4000-8000-000000000002",
            name: "QA Lair Boss",
            sortOrder: 1,
            blizzardEncounterIds: [990_078],
          },
        ],
      },
    ],
  };
});

// No live Warcraft Logs / Battle.net: discovery on raid / encounter writes sees nothing.
vi.mock("@/integrations/warcraft-logs/warcraft-logs-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/warcraft-logs/warcraft-logs-api-client")>()),
  warcraftLogsApiClient: {
    isConfigured: () => true,
    fetchZones: async () => ({ status: "SUCCESS" as const, zones: [] }),
  },
}));

const ids = {
  admin: "c0a7e100-0000-4000-8000-000000000001",
  lead: "c0a7e100-0000-4000-8000-000000000002",
  user: "c0a7e100-0000-4000-8000-000000000003",
  booster: "c0a7e100-0000-4000-8000-000000000004",
};

function actor(id: string, accountRole: AccountRole): AuthenticatedUser {
  return {
    id,
    name: `Lifecycle ${accountRole}`,
    email: `${id}@lifecycle.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

const admin = actor(ids.admin, "ADMIN");
const lead = actor(ids.lead, "RAID_LEAD");
const user = actor(ids.user, "USER");

const createdRaidIds: string[] = [];
const createdProductIds: string[] = [];
const createdRunIds: string[] = [];
let characterId = "";
// The admin-owned raid of FAKE_INSTANCE — created before any write path runs the bootstrap.
let keptRaidId = "";
let keptBossId = "";

async function expectCode(promise: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(isDomainError(caught) ? caught.code : caught).toBe(code);
}

async function newRaid(name: string, bossNames: string[] = ["Boss"]) {
  const { raidId } = await raidCatalogService.createRaid(admin, {
    name,
    season: "QA",
    sortOrder: 95,
    trackLockouts: false,
    blizzardInstanceId: null,
  });
  createdRaidIds.push(raidId);
  for (const bossName of bossNames) {
    await raidCatalogService.createEncounter(admin, { raidId, name: bossName, blizzardEncounterIds: [] });
  }
  return raidId;
}

/** A Raid row written directly — the way the old bootstrap / a manual raid produced same-instance copies. */
async function insertRaid(input: { id?: string; name: string; bossId?: string }) {
  const id = input.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.Raid.create({
    id,
    name: input.name,
    season: "QA",
    isActive: false,
    sortOrder: 96,
    trackLockouts: true,
    blizzardInstanceId: FAKE_INSTANCE,
    wclZoneId: null,
    wclRankingEncounterId: null,
    createdAt: now,
    updatedAt: now,
  });
  const bossId = input.bossId ?? crypto.randomUUID();
  await orm.RaidBoss.create({
    id: bossId,
    raidId: id,
    name: `${input.name} Boss`,
    sortOrder: 1,
    blizzardEncounterIds: serializeEncounterIds([FAKE_ENCOUNTER]),
    wclEncounterIds: serializeEncounterIds([]),
  });
  createdRaidIds.push(id);
  raidRepository.invalidateCatalogMemo();
  return { id, bossId };
}

async function newProduct(name: string, raidId: string) {
  const { productId } = await raidCatalogService.createProduct(admin, {
    name,
    active: true,
    selectable: true,
    sortOrder: 60,
    contents: [{ raidId, bossCountMode: "FIXED", fixedBossCount: 1, minBossCount: null, defaultBossCount: null }],
  });
  createdProductIds.push(productId);
  return productId;
}

async function addLockout(raidId: string, difficulty: "HEROIC" | "MYTHIC", killedBossIds: string[]) {
  const now = new Date().toISOString();
  await orm.CharacterRaidLockout.create({
    id: crypto.randomUUID(),
    characterId,
    raidId,
    difficulty,
    resetIdentifier: "2026-W43",
    bossesDefeated: killedBossIds.length,
    isComplete: true,
    killedBossIds: JSON.stringify(killedBossIds),
    createdAt: now,
    updatedAt: now,
  });
}

async function lockoutsOf(raidId: string) {
  return (await orm.CharacterRaidLockout.where({ raidId }).all()) as Array<Record<string, unknown>>;
}

async function row(raidId: string) {
  return (await raidCatalogService.getPage(admin)).raids.find((raid) => raid.id === raidId);
}

async function cleanup() {
  for (const id of createdRunIds) await orm.Run.where({ id }).delete().catch(() => {});
  for (const id of createdProductIds) await orm.Product.where({ id }).delete().catch(() => {});
  for (const id of [...createdRaidIds, FAKE_SEED_RAID_ID]) {
    await orm.CharacterRaidLockout.where({ raidId: id }).delete().catch(() => {});
    await orm.Raid.where({ id }).delete().catch(() => {});
  }
  await orm.Character.where({ userId: ids.booster }).delete().catch(() => {});
  for (const id of Object.values(ids)) {
    await orm.ActivityEvent.where({ userId: id }).delete().catch(() => {});
    await orm.User.where({ id }).delete().catch(() => {});
  }
  raidRepository.invalidateCatalogMemo();
}

beforeAll(async () => {
  vi.spyOn(blizzardApiClient, "getJournalInstanceIndex").mockResolvedValue([]);
  vi.spyOn(blizzardApiClient, "getJournalInstance").mockResolvedValue(null);
  await cleanup();
  const now = new Date().toISOString();
  for (const [id, role] of [
    [ids.admin, "ADMIN"],
    [ids.lead, "RAID_LEAD"],
    [ids.user, "USER"],
    [ids.booster, "USER"],
  ] as const) {
    await orm.User.create({
      id,
      name: id,
      email: `${id}@lifecycle.local`,
      emailVerified: true,
      accountRole: role,
      accountStatus: "ACTIVE",
      isBooster: false,
      createdAt: now,
      updatedAt: now,
    });
  }
  characterId = crypto.randomUUID();
  await orm.Character.create({
    id: characterId,
    userId: ids.booster,
    name: "Lifecyclo",
    realm: "Lifecycle",
    normalizedName: normalizeCharacterIdentity("Lifecyclo"),
    normalizedRealm: normalizeCharacterIdentity("Lifecycle"),
    region: "EU",
    wowClass: "MAGE",
    specialization: "Frost",
    primaryRole: "RANGED_DPS",
    itemLevel: 700,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const kept = await insertRaid({ name: "QA Lair (admin import)" });
  keptRaidId = kept.id;
  keptBossId = kept.bossId;
});

afterAll(cleanup);

describe("Delete Raid", () => {
  it("an unused raid offers only Delete and is removed with its bosses", async () => {
    const raidId = await newRaid("QA Unused Raid", ["U1", "U2"]);
    expect((await row(raidId))!.actions).toEqual({ delete: true, removeDuplicate: false, archive: false, restore: false });
    await raidCatalogService.deleteRaid(admin, raidId);
    expect((await raidRepository.loadCatalog()).findById(raidId)).toBeNull();
    expect(await orm.RaidBoss.where({ raidId }).all()).toHaveLength(0);
  });

  it("a referenced raid cannot be hard-deleted and offers Archive instead", async () => {
    const raidId = await newRaid("QA Referenced Raid");
    await newProduct("QA_LIFECYCLE_REFERENCED", raidId);
    const referenced = (await row(raidId))!;
    expect(referenced.actions).toEqual({ delete: false, removeDuplicate: false, archive: true, restore: false });
    await expectCode(raidCatalogService.deleteRaid(admin, raidId), "CONTENT_RAID_IN_USE");
    expect((await raidRepository.loadCatalog()).findById(raidId)).not.toBeNull();
  });
});

describe("Archive / Restore Raid", () => {
  it("archives a referenced raid: history stays valid, new selection excludes it, restore brings it back", async () => {
    const raidId = await newRaid("QA Archive Raid", ["A1"]);
    await raidCatalogService.updateRaid(admin, {
      raidId,
      name: "QA Archive Raid",
      season: "QA",
      sortOrder: 95,
      trackLockouts: false,
      availableForRuns: true,
      blizzardInstanceId: null,
    });
    const productId = await newProduct("QA_LIFECYCLE_ARCHIVE", raidId);
    const run = await runService.createRun(lead, venomousCreateInput());
    createdRunIds.push(run.id);
    await orm.RunRaidContent.create({
      id: crypto.randomUUID(),
      runId: run.id,
      raidId,
      sortOrder: 2,
      plannedBossCount: 1,
      createdAt: new Date().toISOString(),
    });
    await addLockout(raidId, "HEROIC", []);

    expect((await raidRepository.listAvailableForRuns()).map((raid) => raid.id)).toContain(raidId);
    expect((await productPlanningService.listSelectable()).map((product) => product.id)).toContain(productId);

    await raidCatalogService.archiveRaid(admin, raidId);
    const archived = (await row(raidId))!;
    expect(archived.archived).toBe(true);
    expect(archived.actions).toEqual({ delete: false, removeDuplicate: false, archive: false, restore: true });
    await expectCode(raidCatalogService.archiveRaid(admin, raidId), "CONTENT_RAID_ARCHIVED");

    // Excluded from every new selection path.
    expect((await raidRepository.listAvailableForRuns()).map((raid) => raid.id)).not.toContain(raidId);
    expect((await productPlanningService.listSelectable()).map((product) => product.id)).not.toContain(productId);
    expect((await productPlanningService.listActive()).map((product) => product.id)).not.toContain(productId);
    await expectCode(productPlanningService.expandNewSelection({ productId }), "RUN_PRODUCT_UNAVAILABLE");
    await expectCode(
      raidCatalogService.createProduct(admin, {
        name: "QA_LIFECYCLE_NEW_WITH_ARCHIVED",
        active: true,
        selectable: true,
        sortOrder: 61,
        contents: [{ raidId, bossCountMode: "FIXED", fixedBossCount: 1, minBossCount: null, defaultBossCount: null }],
      }),
      "CONTENT_RAID_ARCHIVED",
    );
    // A product that already holds the archived raid can still be edited.
    await raidCatalogService.updateProduct(admin, {
      productId,
      name: "QA_LIFECYCLE_ARCHIVE (edited)",
      active: true,
      selectable: true,
      sortOrder: 60,
      contents: [{ raidId, bossCountMode: "FIXED", fixedBossCount: 1, minBossCount: null, defaultBossCount: null }],
    });

    // Historical references remain valid.
    expect((await raidRepository.loadCatalog()).findById(raidId)?.bosses).toHaveLength(1);
    expect((await raidRepository.findById(raidId))?.availableForRuns).toBe(false);
    expect(await orm.RunRaidContent.where({ runId: run.id, raidId }).all()).toHaveLength(1);
    expect(await lockoutsOf(raidId)).toHaveLength(1);

    const raidRowsBefore = (await orm.Raid.select("id").all()).length;
    await raidCatalogService.restoreRaid(admin, raidId);
    expect((await row(raidId))!.archived).toBe(false);
    // Restore clears the lifecycle column on the same row — never a second Raid.
    expect((await orm.Raid.select("id").all()).length).toBe(raidRowsBefore);
    expect(await orm.Raid.where({ name: "QA Archive Raid" }).all()).toHaveLength(1);
    expect(await orm.RunRaidContent.where({ runId: run.id, raidId }).all()).toHaveLength(1);
    expect((await raidRepository.listAvailableForRuns()).map((raid) => raid.id)).toContain(raidId);
    expect((await productPlanningService.listSelectable()).map((product) => product.id)).toContain(productId);
    await expectCode(raidCatalogService.restoreRaid(admin, raidId), "CONTENT_RAID_NOT_ARCHIVED");

    await orm.Run.where({ id: run.id }).delete();
  });

  it("refuses USER and RAID_LEAD for archive, restore, remove duplicate and delete", async () => {
    const raidId = await newRaid("QA Denied Raid");
    for (const denied of [user, lead]) {
      await expectCode(raidCatalogService.archiveRaid(denied, raidId), "NOT_AUTHORIZED");
      await expectCode(raidCatalogService.restoreRaid(denied, raidId), "NOT_AUTHORIZED");
      await expectCode(raidCatalogService.removeDuplicateRaid(denied, raidId), "NOT_AUTHORIZED");
      await expectCode(raidCatalogService.deleteRaid(denied, raidId), "NOT_AUTHORIZED");
    }
    expect((await row(raidId))!.archived).toBe(false);
  });
});

describe("duplicate raids (same Blizzard instance)", () => {
  it("the bootstrap never inserts a fixture raid whose Blizzard instance another Raid owns", async () => {
    await raidRepository.ensureReferenceRaids();
    expect(await orm.Raid.where({ id: FAKE_SEED_RAID_ID }).first()).toBeNull();
    expect(await orm.Raid.where({ blizzardInstanceId: FAKE_INSTANCE }).all()).toHaveLength(1);
  });

  it("the Kith'ix case: a fixture copy with only mirrored lockouts is removed into the authoritative raid", async () => {
    // State before this fix: the bootstrap inserted the fixture copy next to the admin raid.
    await insertRaid({ id: FAKE_SEED_RAID_ID, name: "QA Lair of Duplicates", bossId: FAKE_SEED_BOSS_ID });
    await newProduct("QA_LIFECYCLE_LAIR", keptRaidId);
    await addLockout(keptRaidId, "HEROIC", [keptBossId]);
    await addLockout(FAKE_SEED_RAID_ID, "HEROIC", [FAKE_SEED_BOSS_ID]); // mirror of the kept row
    await addLockout(FAKE_SEED_RAID_ID, "MYTHIC", [FAKE_SEED_BOSS_ID]); // only on the copy

    const copy = (await row(FAKE_SEED_RAID_ID))!;
    expect(copy.seeded).toBe(true);
    expect(copy.duplicateOf).toEqual({ id: keptRaidId, name: "QA Lair (admin import)" });
    expect(copy.actions).toEqual({ delete: false, removeDuplicate: true, archive: false, restore: false });
    const kept = (await row(keptRaidId))!;
    expect(kept.duplicateOf).toBeNull();
    expect(kept.actions.removeDuplicate).toBe(false);
    expect(kept.actions.delete).toBe(false);
    await expectCode(raidCatalogService.removeDuplicateRaid(admin, keptRaidId), "CONTENT_RAID_NOT_DUPLICATE");

    const result = await raidCatalogService.removeDuplicateRaid(admin, FAKE_SEED_RAID_ID);
    expect(result).toMatchObject({ keptRaidName: "QA Lair (admin import)", droppedLockouts: 1, movedLockouts: 1 });
    expect(await orm.Raid.where({ id: FAKE_SEED_RAID_ID }).first()).toBeNull();
    const lockouts = await lockoutsOf(keptRaidId);
    expect(lockouts.map((lockout) => lockout.difficulty).sort()).toEqual(["HEROIC", "MYTHIC"]);
    for (const lockout of lockouts) expect(JSON.parse(String(lockout.killedBossIds))).toEqual([keptBossId]);

    // The fixed bootstrap does not bring the copy back.
    await raidRepository.ensureReferenceRaids();
    expect(await orm.Raid.where({ id: FAKE_SEED_RAID_ID }).first()).toBeNull();
    expect(await orm.Raid.where({ blizzardInstanceId: FAKE_INSTANCE }).all()).toHaveLength(1);
  });

  it("a copy used by a Run, Run Setup or Product is never removed as a duplicate", async () => {
    const copy = await insertRaid({ name: "QA Lair (used copy)" });
    await newProduct("QA_LIFECYCLE_LAIR_COPY", copy.id);
    const usedCopy = (await row(copy.id))!;
    expect(usedCopy.duplicateOf).toBeNull();
    expect(usedCopy.actions).toEqual({ delete: false, removeDuplicate: false, archive: true, restore: false });
    await expectCode(raidCatalogService.removeDuplicateRaid(admin, copy.id), "CONTENT_RAID_NOT_DUPLICATE");
    expect(await orm.Raid.where({ id: copy.id }).first()).not.toBeNull();
  });
});
