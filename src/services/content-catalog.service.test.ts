import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canManageContentCatalog, getManagementNavItems, type AuthenticatedUser } from "@/auth/authorization";
import { deriveCurrentResetLockouts } from "@/lib/blizzard/raid-lockout-derivation";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import {
  MIDNIGHT_S2_BUNDLE_PRODUCT_ID,
  PRODUCT_CATALOG_FIXTURE,
  VENOMOUS_ABYSS_PRODUCT_ID,
} from "@/lib/product-catalog";
import {
  MANAFORGE_OMEGA_RAID_ID,
  NYMRISSA_WAVECALLER_BOSS_ID,
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
} from "@/lib/wow-raid-catalog";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import type { AccountRole } from "@/models/enums";
import { contentCatalogRepository } from "@/repositories/content-catalog.repository";
import { productRepository } from "@/repositories/product.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { contentCatalogService } from "@/services/content-catalog.service";
import type { ProductContentInput } from "@/validators/content-catalog";

/**
 * Content Catalog admin (/manage/content): ADMIN / OWNER only; DB authority;
 * referenced raids keep their encounter structure; products never rewrite
 * Runs or Run Setups; the insert-only bootstrap never overwrites admin edits.
 */

const ids = {
  admin: "c0a7e000-0000-4000-8000-000000000001",
  owner: "c0a7e000-0000-4000-8000-000000000002",
  lead: "c0a7e000-0000-4000-8000-000000000003",
  user: "c0a7e000-0000-4000-8000-000000000004",
};

function actor(id: string, accountRole: AccountRole): AuthenticatedUser {
  return {
    id,
    name: `Content ${accountRole}`,
    email: `${id}@content.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

const admin = actor(ids.admin, "ADMIN");
// OWNER is a single-row role; the stored row stays ADMIN and the actor carries OWNER.
const owner = actor(ids.owner, "OWNER");
const lead = actor(ids.lead, "RAID_LEAD");
const user = actor(ids.user, "USER");

const createdRaidIds: string[] = [];
const createdProductIds: string[] = [];
const createdLockoutIds: string[] = [];

async function expectCode(promise: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(isDomainError(caught) ? caught.code : caught).toBe(code);
}

async function newRaid(name: string, overrides: Partial<Parameters<typeof contentCatalogService.createRaid>[1]> = {}) {
  const { raidId } = await contentCatalogService.createRaid(admin, {
    name,
    season: "QA",
    sortOrder: 90,
    trackLockouts: false,
    blizzardInstanceId: null,
    ...overrides,
  });
  createdRaidIds.push(raidId);
  return raidId;
}

async function bossesOf(raidId: string) {
  return (await raidRepository.loadCatalog()).findById(raidId)!.bosses;
}

async function addEncounter(raidId: string, name: string, blizzard: number[] = [], wcl: number[] = []) {
  return contentCatalogService.createEncounter(admin, {
    raidId,
    name,
    blizzardEncounterIds: blizzard,
    wclEncounterIds: wcl,
  });
}

function variable(raidId: string, min: number, preset: number): ProductContentInput {
  return { raidId, bossCountMode: "VARIABLE", fixedBossCount: null, minBossCount: min, defaultBossCount: preset };
}

function fixed(raidId: string, count: number): ProductContentInput {
  return { raidId, bossCountMode: "FIXED", fixedBossCount: count, minBossCount: null, defaultBossCount: null };
}

async function newProduct(name: string, contents: ProductContentInput[]) {
  const { productId } = await contentCatalogService.createProduct(admin, {
    name,
    active: true,
    selectable: true,
    sortOrder: 50,
    contents,
  });
  createdProductIds.push(productId);
  return productId;
}

async function snapshot(table: "RunRaidContent" | "RunTemplateRaidContent" | "RunTemplate") {
  const rows = (await orm[table].all()) as Array<Record<string, unknown>>;
  return JSON.stringify(rows.map((row) => ({ ...row })).sort((a, b) => String(a.id).localeCompare(String(b.id))));
}

async function restoreSeededCatalog() {
  const tide = (await raidRepository.loadCatalog()).findById(TIDEBOUND_GROTTO_RAID_ID)!;
  await contentCatalogService.updateRaid(admin, {
    raidId: TIDEBOUND_GROTTO_RAID_ID,
    name: "The Tidebound Grotto",
    season: "Midnight Season 2",
    sortOrder: 3,
    trackLockouts: true,
    availableForRuns: false,
    blizzardInstanceId: 1317,
  });
  await contentCatalogRepository.updateRaidWclMapping(TIDEBOUND_GROTTO_RAID_ID, {
    wclZoneId: 53,
    wclRankingEncounterId: 3379,
    now: new Date().toISOString(),
  });
  const nymrissa = tide.bosses[0]!;
  await contentCatalogRepository.updateEncounter(nymrissa.id, {
    name: "Nymrissa Wavecaller",
    blizzardEncounterIds: [2849],
    wclEncounterIds: [3379],
  });
  for (const product of PRODUCT_CATALOG_FIXTURE) {
    await contentCatalogService.updateProduct(admin, {
      productId: product.id,
      name: product.name,
      active: product.active,
      selectable: product.selectable,
      sortOrder: product.sortOrder,
      contents: product.contents.map((content) => ({
        raidId: content.raidId,
        bossCountMode: content.bossCountMode,
        fixedBossCount: content.fixedBossCount,
        minBossCount: content.minBossCount,
        defaultBossCount: content.defaultBossCount,
      })),
    });
  }
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  const now = new Date().toISOString();
  for (const [id, role] of [
    [ids.admin, "ADMIN"],
    [ids.owner, "ADMIN"],
    [ids.lead, "RAID_LEAD"],
    [ids.user, "USER"],
  ] as const) {
    await orm.User.where({ id }).delete().catch(() => {});
    await orm.User.create({
      id,
      name: `Content ${role}`,
      email: `${id}@content.boostting.local`,
      emailVerified: true,
      accountRole: role,
      accountStatus: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });
  }
});

afterAll(async () => {
  for (const id of createdLockoutIds) await orm.CharacterRaidLockout.where({ id }).delete().catch(() => {});
  for (const id of createdProductIds) await orm.Product.where({ id }).delete().catch(() => {});
  for (const id of createdRaidIds) await orm.Raid.where({ id }).delete().catch(() => {});
  await restoreSeededCatalog();
  for (const id of Object.values(ids)) await orm.User.where({ id }).delete().catch(() => {});
  // Canonical catalog for later test files.
  expect(await productRepository.listAll()).toEqual(PRODUCT_CATALOG_FIXTURE);
});

/* ------------------------------------------------------------------ auth */

describe("authorization", () => {
  it("lists Content only in the ADMIN / OWNER management navigation", () => {
    expect(canManageContentCatalog("ADMIN")).toBe(true);
    expect(canManageContentCatalog("OWNER")).toBe(true);
    expect(canManageContentCatalog("RAID_LEAD")).toBe(false);
    expect(canManageContentCatalog("USER")).toBe(false);
    expect(getManagementNavItems("ADMIN").some((item) => item.href === "/manage/content")).toBe(true);
    expect(getManagementNavItems("OWNER").some((item) => item.href === "/manage/content")).toBe(true);
    expect(getManagementNavItems("RAID_LEAD").some((item) => item.href === "/manage/content")).toBe(false);
    expect(getManagementNavItems("USER")).toEqual([]);
  });

  it("refuses USER and RAID_LEAD for reads and every mutation", async () => {
    for (const denied of [user, lead]) {
      await expectCode(contentCatalogService.getPage(denied), "NOT_AUTHORIZED");
      await expectCode(contentCatalogService.getRaidDetail(denied, VENOMOUS_ABYSS_RAID_ID), "NOT_AUTHORIZED");
      await expectCode(
        contentCatalogService.createRaid(denied, {
          name: "Denied",
          season: "QA",
          sortOrder: 1,
          trackLockouts: false,
          blizzardInstanceId: null,
        }),
        "NOT_AUTHORIZED",
      );
      await expectCode(contentCatalogService.deleteRaid(denied, MANAFORGE_OMEGA_RAID_ID), "NOT_AUTHORIZED");
      await expectCode(
        contentCatalogService.updateEncounter(denied, {
          bossId: NYMRISSA_WAVECALLER_BOSS_ID,
          name: "x",
          blizzardEncounterIds: [],
        }),
        "NOT_AUTHORIZED",
      );
      await expectCode(contentCatalogService.setProductActive(denied, VENOMOUS_ABYSS_PRODUCT_ID, false), "NOT_AUTHORIZED");
      await expectCode(contentCatalogService.deleteProduct(denied, VENOMOUS_ABYSS_PRODUCT_ID), "NOT_AUTHORIZED");
    }
  });

  it("lets ADMIN and OWNER read and mutate", async () => {
    expect((await contentCatalogService.getPage(admin)).raids.length).toBeGreaterThanOrEqual(3);
    expect((await contentCatalogService.getPage(owner)).products.length).toBeGreaterThanOrEqual(2);
    const raidId = (
      await contentCatalogService.createRaid(owner, {
        name: "QA Owner Raid",
        season: "QA",
        sortOrder: 91,
        trackLockouts: false,
        blizzardInstanceId: null,
      })
    ).raidId;
    createdRaidIds.push(raidId);
    await contentCatalogService.deleteRaid(owner, raidId);
  });
});

/* ------------------------------------------------------------------ raids */

describe("raids", () => {
  it("lists the persisted catalog: 3 core raids, 17 encounters, tracked set and usage", async () => {
    const page = await contentCatalogService.getPage(admin);
    const core = page.raids.filter((raid) =>
      [MANAFORGE_OMEGA_RAID_ID, VENOMOUS_ABYSS_RAID_ID, TIDEBOUND_GROTTO_RAID_ID].includes(raid.id),
    );
    expect(core.map((raid) => raid.id)).toEqual([MANAFORGE_OMEGA_RAID_ID, VENOMOUS_ABYSS_RAID_ID, TIDEBOUND_GROTTO_RAID_ID]);
    expect(core.reduce((sum, raid) => sum + raid.bosses.length, 0)).toBe(17);
    expect(core.map((raid) => raid.trackLockouts)).toEqual([false, true, true]);
    expect(core.every((raid) => raid.seeded && raid.structureLocked)).toBe(true);
    const venomous = core.find((raid) => raid.id === VENOMOUS_ABYSS_RAID_ID)!;
    expect(venomous.references.productContents).toBe(2);
    expect(venomous.referenced).toBe(true);
  });

  it("creates a raid with no encounters, not offered for new Runs, and no product", async () => {
    const productsBefore = (await productRepository.listAll()).length;
    const raidId = await newRaid("QA Created Raid", { blizzardInstanceId: 990001, trackLockouts: true });
    const detail = await contentCatalogService.getRaidDetail(admin, raidId);
    expect(detail).toMatchObject({
      name: "QA Created Raid",
      season: "QA",
      bosses: [],
      availableForRuns: false,
      trackLockouts: true,
      blizzardInstanceId: 990001,
      wclZoneId: null,
      wclRankingEncounterId: null,
      referenced: false,
      seeded: false,
      structureLocked: false,
    });
    expect((await productRepository.listAll()).length).toBe(productsBefore);
  });

  it("edits safe metadata without touching WCL mapping", async () => {
    const raidId = await newRaid("QA Edit Raid");
    await contentCatalogRepository.updateRaidWclMapping(raidId, {
      wclZoneId: 991,
      wclRankingEncounterId: 990777,
      now: new Date().toISOString(),
    });
    await contentCatalogService.updateRaid(admin, {
      raidId,
      name: "QA Edited Raid",
      season: "QA 2",
      sortOrder: 95,
      trackLockouts: true,
      availableForRuns: true,
      blizzardInstanceId: 990002,
    });
    expect(await contentCatalogService.getRaidDetail(admin, raidId)).toMatchObject({
      name: "QA Edited Raid",
      season: "QA 2",
      sortOrder: 95,
      trackLockouts: true,
      availableForRuns: true,
      blizzardInstanceId: 990002,
      wclZoneId: 991,
      wclRankingEncounterId: 990777,
    });
  });

  it("lists distinct seasons from persisted raids without a hardcoded list", async () => {
    await newRaid("QA Season Source Raid", { });
    const seasons = await contentCatalogService.listSeasons(admin);
    expect(seasons).toEqual([...seasons].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    expect(seasons).toContain("Midnight Season 2");
    expect(seasons).toContain("The War Within Season 3");
    expect(seasons).toContain("QA");
    expect(seasons.every((season) => season.trim() === season && season.length > 0)).toBe(true);
  });

  it("manages encounters of an unused raid: create, edit, reorder, delete — ids never regenerated", async () => {
    const raidId = await newRaid("QA Encounter Raid");
    const { bossId: first } = await addEncounter(raidId, "First", [990101], [990201]);
    const { bossId: second } = await addEncounter(raidId, "Second");
    const { bossId: third } = await addEncounter(raidId, "Third");
    expect((await bossesOf(raidId)).map((boss) => [boss.id, boss.sortOrder])).toEqual([
      [first, 1],
      [second, 2],
      [third, 3],
    ]);

    await contentCatalogService.updateEncounter(admin, {
      bossId: second,
      name: "Second (renamed)",
      blizzardEncounterIds: [990103, 990102],
      wclEncounterIds: [990202],
    });
    expect((await bossesOf(raidId))[1]).toMatchObject({
      id: second,
      name: "Second (renamed)",
      sortOrder: 2,
      blizzardEncounterIds: [990102, 990103],
      wclEncounterIds: [990202],
    });

    await contentCatalogService.moveEncounter(admin, { bossId: third, direction: "UP" });
    expect((await bossesOf(raidId)).map((boss) => boss.id)).toEqual([first, third, second]);
    await contentCatalogService.moveEncounter(admin, { bossId: first, direction: "UP" }); // already first: no-op
    expect((await bossesOf(raidId)).map((boss) => boss.id)).toEqual([first, third, second]);

    await contentCatalogService.deleteEncounter(admin, third);
    expect((await bossesOf(raidId)).map((boss) => [boss.id, boss.sortOrder])).toEqual([
      [first, 1],
      [second, 2],
    ]);
  });

  it("deletes an unused raid together with its encounters", async () => {
    const raidId = await newRaid("QA Delete Raid");
    await addEncounter(raidId, "Doomed");
    await contentCatalogService.deleteRaid(admin, raidId);
    expect((await raidRepository.loadCatalog()).findById(raidId)).toBeNull();
    expect(await orm.RaidBoss.where({ raidId }).all()).toHaveLength(0);
  });

  it("freezes encounter structure of a referenced raid but keeps metadata editable", async () => {
    const raidId = await newRaid("QA Referenced Raid");
    const { bossId } = await addEncounter(raidId, "Kept", [990301], [990401]);
    await addEncounter(raidId, "Also kept");
    // Referenced through a Character lockout (killedBossIds hold this raid's RaidBoss ids).
    const character = (await orm.Character.select("id").first()) as { id: string };
    const lockoutId = crypto.randomUUID();
    const now = new Date().toISOString();
    await orm.CharacterRaidLockout.create({
      id: lockoutId,
      characterId: character.id,
      raidId,
      difficulty: "HEROIC",
      resetIdentifier: "1999-W01",
      bossesDefeated: 1,
      isComplete: false,
      killedBossIds: JSON.stringify([bossId]),
      createdAt: now,
      updatedAt: now,
    });
    createdLockoutIds.push(lockoutId);

    const detail = await contentCatalogService.getRaidDetail(admin, raidId);
    expect(detail).toMatchObject({ referenced: true, structureLocked: true });
    expect(detail.references.lockouts).toBe(1);

    await expectCode(contentCatalogService.deleteRaid(admin, raidId), "CONTENT_RAID_IN_USE");
    await expectCode(addEncounter(raidId, "New"), "CONTENT_ENCOUNTER_IN_USE");
    await expectCode(contentCatalogService.deleteEncounter(admin, bossId), "CONTENT_ENCOUNTER_IN_USE");
    await expectCode(contentCatalogService.moveEncounter(admin, { bossId, direction: "DOWN" }), "CONTENT_ENCOUNTER_IN_USE");

    // Identity-preserving edits stay allowed.
    await contentCatalogService.updateEncounter(admin, {
      bossId,
      name: "Kept (renamed)",
      blizzardEncounterIds: [990302],
      wclEncounterIds: [990402],
    });
    await contentCatalogService.updateRaid(admin, {
      raidId,
      name: "QA Referenced Raid (renamed)",
      season: "QA",
      sortOrder: 96,
      trackLockouts: false,
      availableForRuns: false,
      blizzardInstanceId: null,
    });
    const bosses = await bossesOf(raidId);
    expect(bosses.map((boss) => boss.sortOrder)).toEqual([1, 2]);
    expect(bosses[0]).toMatchObject({ id: bossId, name: "Kept (renamed)", blizzardEncounterIds: [990302] });
    // The lockout still resolves to the same boss id.
    const lockout = (await orm.CharacterRaidLockout.where({ id: lockoutId }).first()) as { killedBossIds: string };
    expect(JSON.parse(lockout.killedBossIds)).toEqual([bossId]);
  });

  it("treats a raid used only by a Product as referenced", async () => {
    const raidId = await newRaid("QA Product-Only Raid");
    const { bossId } = await addEncounter(raidId, "Solo");
    await newProduct("QA_PRODUCT_ONLY", [fixed(raidId, 1)]);
    await expectCode(contentCatalogService.deleteRaid(admin, raidId), "CONTENT_RAID_IN_USE");
    await expectCode(contentCatalogService.deleteEncounter(admin, bossId), "CONTENT_ENCOUNTER_IN_USE");
  });

  it("never deletes or restructures core (seeded) raids", async () => {
    for (const raidId of [MANAFORGE_OMEGA_RAID_ID, VENOMOUS_ABYSS_RAID_ID, TIDEBOUND_GROTTO_RAID_ID]) {
      await expectCode(contentCatalogService.deleteRaid(admin, raidId), "CONTENT_RAID_IN_USE");
      await expectCode(addEncounter(raidId, "Intruder"), "CONTENT_ENCOUNTER_IN_USE");
    }
    await expectCode(
      contentCatalogService.moveEncounter(admin, { bossId: NYMRISSA_WAVECALLER_BOSS_ID, direction: "DOWN" }),
      "CONTENT_ENCOUNTER_IN_USE",
    );
    await expectCode(contentCatalogService.deleteEncounter(admin, NYMRISSA_WAVECALLER_BOSS_ID), "CONTENT_ENCOUNTER_IN_USE");
    expect(await bossesOf(TIDEBOUND_GROTTO_RAID_ID)).toHaveLength(1);
  });

  it("keeps admin raid edits across ensureReferenceRaids", async () => {
    await contentCatalogService.updateRaid(admin, {
      raidId: TIDEBOUND_GROTTO_RAID_ID,
      name: "Tide (QA edit)",
      season: "QA season",
      sortOrder: 7,
      trackLockouts: true,
      availableForRuns: false,
      blizzardInstanceId: 1317,
    });
    await contentCatalogService.updateEncounter(admin, {
      bossId: NYMRISSA_WAVECALLER_BOSS_ID,
      name: "Nymrissa (QA edit)",
      blizzardEncounterIds: [2849],
      wclEncounterIds: [3379],
    });
    await raidRepository.ensureReferenceRaids();
    const tide = (await raidRepository.loadCatalog()).findById(TIDEBOUND_GROTTO_RAID_ID)!;
    expect(tide).toMatchObject({ name: "Tide (QA edit)", season: "QA season", sortOrder: 7 });
    expect(tide.bosses.map((boss) => [boss.id, boss.name])).toEqual([[NYMRISSA_WAVECALLER_BOSS_ID, "Nymrissa (QA edit)"]]);
    await restoreSeededCatalog();
  });

  it("turning lockout tracking off deletes no lockout rows", async () => {
    const lockoutCount = async () => (await orm.CharacterRaidLockout.where({ raidId: TIDEBOUND_GROTTO_RAID_ID }).all()).length;
    const before = await lockoutCount();
    const tide = await contentCatalogService.getRaidDetail(admin, TIDEBOUND_GROTTO_RAID_ID);
    await contentCatalogService.updateRaid(admin, {
      raidId: tide.id,
      name: tide.name,
      season: tide.season,
      sortOrder: tide.sortOrder,
      trackLockouts: false,
      availableForRuns: tide.availableForRuns,
      blizzardInstanceId: tide.blizzardInstanceId,
    });
    expect(await lockoutCount()).toBe(before);
    expect((await raidRepository.loadCatalog()).lockoutRaids.map((raid) => raid.id)).not.toContain(TIDEBOUND_GROTTO_RAID_ID);
    await restoreSeededCatalog();
    expect((await raidRepository.loadCatalog()).lockoutRaids.map((raid) => raid.id)).toContain(TIDEBOUND_GROTTO_RAID_ID);
  });
});

/* ------------------------------------------------------------ query shape */

describe("query shape", () => {
  it("loads the page with a fixed number of queries, independent of raid/product counts", async () => {
    const { Client } = await import("pg");
    const { vi } = await import("vitest");
    const spy = vi.spyOn(Client.prototype, "query");
    try {
      await contentCatalogService.getPage(admin);
      const baseline = spy.mock.calls.length;
      // 1 raid catalog + 5 grouped reference counts + 1 product catalog + 1 distinct seasons.
      expect(baseline).toBe(8);
      const raidId = await newRaid("QA Query Shape Raid");
      await addEncounter(raidId, "Q1");
      await addEncounter(raidId, "Q2");
      await newProduct("QA_QUERY_SHAPE", [fixed(raidId, 1)]);
      spy.mockClear();
      await contentCatalogService.getPage(admin);
      expect(spy.mock.calls.length).toBe(baseline);
    } finally {
      spy.mockRestore();
    }
  });
});

/* ----------------------------------------------------- integration metadata */

describe("integration metadata", () => {
  it("Blizzard lockout derivation reads the admin-updated DB ids", async () => {
    const raidId = await newRaid("QA Blizzard Raid", { trackLockouts: true, blizzardInstanceId: 990010 });
    const { bossId } = await addEncounter(raidId, "Blizz Boss", [990110]);
    const reset = getRegionalWeeklyReset("EU");
    const payload = {
      raids: [
        {
          instanceId: "990010",
          instanceName: "QA Blizzard Raid",
          difficulties: [
            {
              difficulty: "HEROIC" as const,
              progressCompleted: 1,
              progressTotal: 1,
              encounters: [
                {
                  encounterId: "990110",
                  encounterName: "Blizz Boss",
                  completedCount: 1,
                  lastKillTimestampMs: reset.start.getTime() + 3_600_000,
                },
              ],
            },
          ],
        },
      ],
    };
    const derive = async () => {
      const result = deriveCurrentResetLockouts({
        region: "EU",
        encounters: payload,
        lockoutRaids: (await raidRepository.loadCatalog()).lockoutRaids,
        resetWindow: reset,
      });
      if (result.status !== "derived") throw new Error("expected derived");
      return result.raids.find((raid) => raid.raidId === raidId)!.difficulties.find((row) => row.difficulty === "HEROIC")!;
    };
    expect((await derive()).bossesDefeated).toBe(1);

    await contentCatalogService.updateEncounter(admin, {
      bossId,
      name: "Blizz Boss",
      blizzardEncounterIds: [990111],
      wclEncounterIds: [],
    });
    expect((await derive()).bossesDefeated).toBe(0);
  });

  it("WCL fight mapping reads the admin-updated DB ids", async () => {
    const raidId = await newRaid("QA WCL Raid");
    await contentCatalogRepository.updateRaidWclMapping(raidId, {
      wclZoneId: 992,
      wclRankingEncounterId: null,
      now: new Date().toISOString(),
    });
    const { bossId } = await addEncounter(raidId, "WCL Boss", [], [990210]);
    expect((await raidRepository.loadCatalog()).raidIdByWclEncounterId.get(990210)).toBe(raidId);
    await contentCatalogService.updateEncounter(admin, {
      bossId,
      name: "WCL Boss",
      blizzardEncounterIds: [],
      wclEncounterIds: [990211],
    });
    const catalog = await raidRepository.loadCatalog();
    expect(catalog.raidIdByWclEncounterId.get(990211)).toBe(raidId);
    expect(catalog.raidIdByWclEncounterId.has(990210)).toBe(false);
  });

  it("rejects ambiguous integration ids", async () => {
    const raidId = await newRaid("QA Ambiguity Raid");
    const { bossId } = await addEncounter(raidId, "Ambiguous", [990120]);
    // WCL 3379 already belongs to Nymrissa (fight assignment maps an encounter to one raid).
    await expectCode(addEncounter(raidId, "Clash", [], [3379]), "CONTENT_WCL_ENCOUNTER_CONFLICT");
    await expectCode(
      contentCatalogService.updateEncounter(admin, { bossId, name: "Ambiguous", blizzardEncounterIds: [990120], wclEncounterIds: [3470] }),
      "CONTENT_WCL_ENCOUNTER_CONFLICT",
    );
    // Blizzard encounter ids are matched within a raid: no two bosses of one raid may share one.
    await expectCode(addEncounter(raidId, "Twin", [990120]), "CONTENT_BLIZZARD_ENCOUNTER_CONFLICT");
    // The same Blizzard encounter id in ANOTHER raid is fine (separate instance payloads).
    await addEncounter(await newRaid("QA Other Raid"), "Elsewhere", [990120]);
    // Blizzard instance ids select the raid payload: one raid per instance.
    await expectCode(newRaid("QA Instance Clash", { blizzardInstanceId: 1320 }), "CONTENT_BLIZZARD_INSTANCE_CONFLICT");
    await expectCode(
      contentCatalogService.updateRaid(admin, {
        raidId,
        name: "QA Ambiguity Raid",
        season: "QA",
        sortOrder: 90,
        trackLockouts: false,
        availableForRuns: false,
        blizzardInstanceId: 1317,
      }),
      "CONTENT_BLIZZARD_INSTANCE_CONFLICT",
    );
    // Keeping its own ids is not a conflict.
    await contentCatalogService.updateEncounter(admin, { bossId, name: "Ambiguous", blizzardEncounterIds: [990120], wclEncounterIds: [] });
  });
});

/* --------------------------------------------------------------- products */

describe("products", () => {
  it("lists the two core products with their ordered contents (no standalone Tide)", async () => {
    const page = await contentCatalogService.getPage(admin);
    const venomous = page.products.find((product) => product.id === VENOMOUS_ABYSS_PRODUCT_ID)!;
    const bundle = page.products.find((product) => product.id === MIDNIGHT_S2_BUNDLE_PRODUCT_ID)!;
    expect(venomous).toMatchObject({ key: "VENOMOUS_ABYSS", active: true, selectable: true, seeded: true });
    expect(venomous.contents.map((content) => [content.raidName, content.summary])).toEqual([
      ["The Venomous Abyss", "Variable 1–8 (default 8)"],
    ]);
    expect(bundle.contents.map((content) => [content.raidName, content.summary])).toEqual([
      ["The Tidebound Grotto", "Fixed 1/1"],
      ["The Venomous Abyss", "Variable 1–8 (default 8)"],
    ]);
    const tideOnly = page.products.filter(
      (product) => product.contents.length === 1 && product.contents[0]!.raidId === TIDEBOUND_GROTTO_RAID_ID,
    );
    expect(tideOnly).toHaveLength(0);
  });

  it("creates, edits, reorders, toggles and deletes a product", async () => {
    const raidA = await newRaid("QA Product Raid A");
    await addEncounter(raidA, "A1");
    await addEncounter(raidA, "A2");
    await addEncounter(raidA, "A3");
    const raidB = await newRaid("QA Product Raid B");
    await addEncounter(raidB, "B1");
    const productId = await newProduct("QA Lifecycle", [variable(raidA, 1, 3), fixed(raidB, 1)]);
    const created = (await productRepository.listAll()).find((product) => product.id === productId)!;
    expect(created.key).toBe("QA_LIFECYCLE");
    expect(created.contents.map((content) => [content.raidId, content.sortOrder, content.bossCountMode])).toEqual([
      [raidA, 1, "VARIABLE"],
      [raidB, 2, "FIXED"],
    ]);
    const contentIdByRaid = new Map(created.contents.map((content) => [content.raidId, content.id]));

    // Edit: rename + reorder + change counts — content row ids are kept per raid; key stays immutable.
    await contentCatalogService.updateProduct(admin, {
      productId,
      name: "QA Lifecycle (renamed)",
      active: true,
      selectable: true,
      sortOrder: 51,
      contents: [fixed(raidB, 1), variable(raidA, 2, 2)],
    });
    const edited = (await productRepository.findByKey("QA_LIFECYCLE"))!;
    expect(edited.name).toBe("QA Lifecycle (renamed)");
    expect(edited.key).toBe("QA_LIFECYCLE");
    expect(edited.contents.map((content) => [content.id, content.raidId, content.sortOrder])).toEqual([
      [contentIdByRaid.get(raidB), raidB, 1],
      [contentIdByRaid.get(raidA), raidA, 2],
    ]);
    expect(edited.contents[1]).toMatchObject({ minBossCount: 2, defaultBossCount: 2, fixedBossCount: null });

    // Removing a content and adding it back.
    await contentCatalogService.updateProduct(admin, {
      productId,
      name: edited.name,
      active: true,
      selectable: true,
      sortOrder: 51,
      contents: [variable(raidA, 1, 1)],
    });
    expect((await productRepository.findByKey("QA_LIFECYCLE"))!.contents.map((content) => content.raidId)).toEqual([raidA]);

    await contentCatalogService.setProductActive(admin, productId, false);
    expect((await productRepository.findByKey("QA_LIFECYCLE"))!.active).toBe(false);
    await contentCatalogService.setProductActive(admin, productId, true);
    await contentCatalogService.setProductSelectable(admin, productId, false);
    const hidden = (await productRepository.findByKey("QA_LIFECYCLE"))!;
    expect(hidden).toMatchObject({ active: true, selectable: false });
    expect((await productRepository.listSelectable()).some((product) => product.id === productId)).toBe(false);

    await contentCatalogService.deleteProduct(admin, productId);
    expect(await productRepository.findByKey("QA_LIFECYCLE")).toBeNull();
    expect(await orm.ProductRaidContent.where({ productId }).all()).toHaveLength(0);
  });

  it("validates boss counts against the raid's encounter count", async () => {
    const raidId = await newRaid("QA Count Raid");
    await addEncounter(raidId, "C1");
    await addEncounter(raidId, "C2");
    const emptyRaid = await newRaid("QA Empty Raid");
    const invalid: ProductContentInput[][] = [
      [fixed(raidId, 0)],
      [fixed(raidId, 3)],
      [{ ...fixed(raidId, 1), fixedBossCount: null }],
      [variable(raidId, 0, 1)],
      [variable(raidId, 2, 1)],
      [variable(raidId, 1, 3)],
      [{ ...variable(raidId, 1, 2), defaultBossCount: null }],
      [fixed(emptyRaid, 1)],
    ];
    for (const contents of invalid) {
      await expectCode(newProduct("QA_INVALID_COUNTS", contents), "CONTENT_INVALID_BOSS_COUNT");
    }
    await expectCode(newProduct("QA_DUPLICATE", [fixed(raidId, 1), variable(raidId, 1, 2)]), "CONTENT_DUPLICATE_PRODUCT_RAID");
    await expectCode(newProduct("QA_EMPTY", []), "CONTENT_PRODUCT_EMPTY");
    await expectCode(newProduct("QA_MISSING_RAID", [fixed("00000000-0000-4000-8000-000000000000", 1)]), "CONTENT_RAID_NOT_FOUND");
    // Bounds are inclusive: fixed = total and min = default = total are valid.
    await newProduct("QA_VALID_BOUNDS", [fixed(raidId, 2)]);
    await newProduct("QA_VALID_VARIABLE", [variable(raidId, 2, 2)]);
  });

  it("generates unique keys, keeps them immutable, and never deletes core products", async () => {
    // Collision against the seeded VENOMOUS_ABYSS key → deterministic suffix (no user prompt).
    const collidedId = await newProduct("Venomous Abyss", [variable(VENOMOUS_ABYSS_RAID_ID, 1, 8)]);
    expect((await productRepository.listAll()).find((product) => product.id === collidedId)?.key).toBe("VENOMOUS_ABYSS_2");
    await expectCode(contentCatalogService.deleteProduct(admin, VENOMOUS_ABYSS_PRODUCT_ID), "CONTENT_PRODUCT_IN_USE");
    await expectCode(contentCatalogService.deleteProduct(admin, MIDNIGHT_S2_BUNDLE_PRODUCT_ID), "CONTENT_PRODUCT_IN_USE");
    // An update carries no key: the stored key never changes when the name does.
    await contentCatalogService.updateProduct(admin, {
      productId: VENOMOUS_ABYSS_PRODUCT_ID,
      name: "Venomous (QA)",
      active: true,
      selectable: true,
      sortOrder: 1,
      contents: [variable(VENOMOUS_ABYSS_RAID_ID, 1, 8)],
    });
    expect((await productRepository.findByKey("VENOMOUS_ABYSS"))!).toMatchObject({
      id: VENOMOUS_ABYSS_PRODUCT_ID,
      name: "Venomous (QA)",
    });
    await restoreSeededCatalog();
  });

  it("product edits never rewrite existing Runs or Run Setups", async () => {
    const before = await Promise.all([snapshot("RunRaidContent"), snapshot("RunTemplateRaidContent"), snapshot("RunTemplate")]);
    expect(JSON.parse(before[0]).length).toBeGreaterThan(0);
    await contentCatalogService.updateProduct(admin, {
      productId: MIDNIGHT_S2_BUNDLE_PRODUCT_ID,
      name: "Bundle (QA)",
      active: true,
      selectable: true,
      sortOrder: 2,
      contents: [variable(VENOMOUS_ABYSS_RAID_ID, 2, 6), fixed(TIDEBOUND_GROTTO_RAID_ID, 1)],
    });
    await contentCatalogService.setProductActive(admin, MIDNIGHT_S2_BUNDLE_PRODUCT_ID, false);
    const after = await Promise.all([snapshot("RunRaidContent"), snapshot("RunTemplateRaidContent"), snapshot("RunTemplate")]);
    expect(after).toEqual(before);
    await restoreSeededCatalog();
    const seeded = (await productRepository.listAll()).filter((product) =>
      PRODUCT_CATALOG_FIXTURE.some((fixture) => fixture.id === product.id),
    );
    expect(seeded).toEqual(PRODUCT_CATALOG_FIXTURE);
  });

  it("keeps admin product edits across ensureReferenceRaids", async () => {
    await contentCatalogService.updateProduct(admin, {
      productId: VENOMOUS_ABYSS_PRODUCT_ID,
      name: "Venomous (admin)",
      active: true,
      selectable: false,
      sortOrder: 4,
      contents: [variable(VENOMOUS_ABYSS_RAID_ID, 2, 6)],
    });
    await raidRepository.ensureReferenceRaids();
    const product = (await productRepository.findByKey("VENOMOUS_ABYSS"))!;
    expect(product).toMatchObject({ name: "Venomous (admin)", selectable: false, sortOrder: 4 });
    expect(product.contents).toHaveLength(1);
    expect(product.contents[0]).toMatchObject({ minBossCount: 2, defaultBossCount: 6 });
    await restoreSeededCatalog();
  });
});
