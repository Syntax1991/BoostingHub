import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orm } from "@/lib/prisma";
import { PRODUCT_CATALOG_FIXTURE, VENOMOUS_ABYSS_PRODUCT_ID } from "@/lib/product-catalog";
import { fixtureRaidCatalog } from "@/lib/raid-catalog";
import {
  MANAFORGE_OMEGA_RAID_ID,
  NYMRISSA_WAVECALLER_BOSS_ID,
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
  WOW_RAID_CATALOG,
} from "@/lib/wow-raid-catalog";
import { productRepository } from "@/repositories/product.repository";
import { raidRepository } from "@/repositories/raid.repository";

/**
 * Database catalog authority: the DB rows (seeded by the content catalog
 * migration / insert-only bootstrap) must reproduce the former code catalog
 * exactly, and the bootstrap must never overwrite DB values again.
 */

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
});

describe("raid catalog parity (DB vs bootstrap fixture)", () => {
  it("keeps every Raid and RaidBoss UUID, name, order and external id", async () => {
    const db = await raidRepository.loadCatalog();
    const fixture = fixtureRaidCatalog();
    for (const expected of fixture.raids) {
      const actual = db.findById(expected.id);
      expect(actual, expected.name).not.toBeNull();
      expect(actual).toEqual(expected);
    }
  });

  it("tracks lockouts for exactly Venomous then Tide, in catalog order", async () => {
    const db = await raidRepository.loadCatalog();
    expect(db.lockoutRaids.map((raid) => raid.id)).toEqual([VENOMOUS_ABYSS_RAID_ID, TIDEBOUND_GROTTO_RAID_ID]);
    expect(db.lockoutRaids.map((raid) => raid.blizzardInstanceId)).toEqual([1320, 1317]);
    expect(db.findById(MANAFORGE_OMEGA_RAID_ID)).toMatchObject({ trackLockouts: false, blizzardInstanceId: 1302 });
  });

  it("keeps Blizzard and WCL ids separate and the WCL encounter map identical", async () => {
    const db = await raidRepository.loadCatalog();
    expect([...db.raidIdByWclEncounterId].sort()).toEqual([...fixtureRaidCatalog().raidIdByWclEncounterId].sort());
    const nymrissa = db.findById(TIDEBOUND_GROTTO_RAID_ID)!.bosses[0]!;
    expect(nymrissa).toMatchObject({ id: NYMRISSA_WAVECALLER_BOSS_ID, blizzardEncounterIds: [2849], wclEncounterIds: [3379] });
    expect(db.findById(TIDEBOUND_GROTTO_RAID_ID)).toMatchObject({ wclZoneId: 53, wclRankingEncounterId: 3379 });
    expect(db.findById(VENOMOUS_ABYSS_RAID_ID)).toMatchObject({ wclZoneId: 53, wclRankingEncounterId: null });
  });

  it("preserves legacy Raid.isActive semantics (standalone Create product)", async () => {
    const db = await raidRepository.loadCatalog();
    expect(db.findById(VENOMOUS_ABYSS_RAID_ID)!.availableForRuns).toBe(true);
    expect(db.findById(TIDEBOUND_GROTTO_RAID_ID)!.availableForRuns).toBe(false);
    expect(db.findById(MANAFORGE_OMEGA_RAID_ID)!.availableForRuns).toBe(false);
  });

  it("loads the whole catalog in one query", async () => {
    const { Client } = await import("pg");
    const { vi } = await import("vitest");
    const spy = vi.spyOn(Client.prototype, "query");
    try {
      await raidRepository.loadCatalog();
      expect(spy.mock.calls.length).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("product catalog parity", () => {
  it("seeds VENOMOUS_ABYSS and MIDNIGHT_S2_BUNDLE (no standalone Tide product)", async () => {
    const products = await productRepository.listAll();
    expect(products).toEqual(PRODUCT_CATALOG_FIXTURE);
    expect(products.map((product) => product.key)).toEqual(["VENOMOUS_ABYSS", "MIDNIGHT_S2_BUNDLE"]);
    const bundle = products.find((product) => product.key === "MIDNIGHT_S2_BUNDLE")!;
    expect(bundle.contents.map((content) => [content.raidId, content.bossCountMode])).toEqual([
      [TIDEBOUND_GROTTO_RAID_ID, "FIXED"],
      [VENOMOUS_ABYSS_RAID_ID, "VARIABLE"],
    ]);
    expect(bundle.contents[0]).toMatchObject({ fixedBossCount: 1, minBossCount: null, defaultBossCount: null });
    expect(bundle.contents[1]).toMatchObject({ fixedBossCount: null, minBossCount: 1, defaultBossCount: 8 });
    expect(await productRepository.listSelectable()).toHaveLength(2);
    expect((await productRepository.findByKey("VENOMOUS_ABYSS"))?.id).toBe(VENOMOUS_ABYSS_PRODUCT_ID);
    expect(await productRepository.findByKey("TIDEBOUND_GROTTO")).toBeNull();
  });
});

describe("ensureReferenceRaids is insert-only", () => {
  const venomousFirstBoss = WOW_RAID_CATALOG.find((raid) => raid.id === VENOMOUS_ABYSS_RAID_ID)!.bosses[0]!;
  const bundleVenomousContentId = "dd000003-dddd-4ddd-8ddd-dddddddddddd";
  const originals: {
    raid?: Record<string, unknown>;
    boss?: Record<string, unknown>;
    product?: Record<string, unknown>;
    content?: Record<string, unknown>;
  } = {};

  beforeAll(async () => {
    originals.raid = (await orm.Raid.where({ id: TIDEBOUND_GROTTO_RAID_ID }).first()) as Record<string, unknown>;
    originals.boss = (await orm.RaidBoss.where({ id: venomousFirstBoss.id }).first()) as Record<string, unknown>;
    originals.product = (await orm.Product.where({ id: VENOMOUS_ABYSS_PRODUCT_ID }).first()) as Record<string, unknown>;
    originals.content = (await orm.ProductRaidContent.where({ id: bundleVenomousContentId }).first()) as Record<
      string,
      unknown
    >;
  });

  afterAll(async () => {
    // Restore the exact seeded values so later test files see the canonical catalog.
    const raid = originals.raid!;
    await orm.Raid.where({ id: TIDEBOUND_GROTTO_RAID_ID }).update({
      name: raid.name as string,
      isActive: raid.isActive as boolean,
      trackLockouts: raid.trackLockouts as boolean,
      wclRankingEncounterId: raid.wclRankingEncounterId as number | null,
    });
    const boss = originals.boss!;
    await orm.RaidBoss.where({ id: venomousFirstBoss.id }).update({
      name: boss.name as string,
      blizzardEncounterIds: boss.blizzardEncounterIds as string,
      wclEncounterIds: boss.wclEncounterIds as string,
    });
    await orm.Product.where({ id: VENOMOUS_ABYSS_PRODUCT_ID }).update({ name: originals.product!.name as string });
    await raidRepository.ensureReferenceRaids();
    expect(await productRepository.listAll()).toEqual(PRODUCT_CATALOG_FIXTURE);
    const db = await raidRepository.loadCatalog();
    expect(db.findById(TIDEBOUND_GROTTO_RAID_ID)).toEqual(fixtureRaidCatalog().findById(TIDEBOUND_GROTTO_RAID_ID));
  });

  it("never overwrites DB-edited raid, boss and product values", async () => {
    await orm.Raid.where({ id: TIDEBOUND_GROTTO_RAID_ID }).update({
      name: "Tide (admin edit)",
      isActive: true,
      trackLockouts: false,
      wclRankingEncounterId: 4242,
    });
    await orm.RaidBoss.where({ id: venomousFirstBoss.id }).update({
      name: "Renamed Boss",
      blizzardEncounterIds: "[1]",
      wclEncounterIds: "[2]",
    });
    await orm.Product.where({ id: VENOMOUS_ABYSS_PRODUCT_ID }).update({ name: "Renamed product" });

    await raidRepository.ensureReferenceRaids();

    const raid = (await orm.Raid.where({ id: TIDEBOUND_GROTTO_RAID_ID }).first()) as Record<string, unknown>;
    expect(raid).toMatchObject({ name: "Tide (admin edit)", isActive: true, trackLockouts: false, wclRankingEncounterId: 4242 });
    const boss = (await orm.RaidBoss.where({ id: venomousFirstBoss.id }).first()) as Record<string, unknown>;
    expect(boss).toMatchObject({ name: "Renamed Boss", blizzardEncounterIds: "[1]", wclEncounterIds: "[2]" });
    const product = (await orm.Product.where({ id: VENOMOUS_ABYSS_PRODUCT_ID }).first()) as Record<string, unknown>;
    expect(product.name).toBe("Renamed product");

    // The runtime reads the DB value, not the fixture.
    const db = await raidRepository.loadCatalog();
    expect(db.lockoutRaids.map((row) => row.id)).toEqual([VENOMOUS_ABYSS_RAID_ID]);
    expect(db.raidIdByWclEncounterId.get(2)).toBe(VENOMOUS_ABYSS_RAID_ID);
  });

  it("still inserts missing rows (and never duplicates existing ones)", async () => {
    const manaforgeLastBoss = WOW_RAID_CATALOG.find((raid) => raid.id === MANAFORGE_OMEGA_RAID_ID)!.bosses.at(-1)!;
    await orm.ProductRaidContent.where({ id: bundleVenomousContentId }).delete();
    await orm.RaidBoss.where({ id: manaforgeLastBoss.id }).delete();
    const bossCountBefore = (await orm.RaidBoss.select("id").all()).length;

    await raidRepository.ensureReferenceRaids();

    const restored = (await orm.ProductRaidContent.where({ id: bundleVenomousContentId }).first()) as Record<
      string,
      unknown
    >;
    expect(restored).toMatchObject({
      productId: originals.content!.productId,
      raidId: VENOMOUS_ABYSS_RAID_ID,
      sortOrder: 2,
      bossCountMode: "VARIABLE",
      minBossCount: 1,
      defaultBossCount: 8,
    });
    const boss = (await orm.RaidBoss.where({ id: manaforgeLastBoss.id }).first()) as Record<string, unknown>;
    expect(boss).toMatchObject({
      raidId: MANAFORGE_OMEGA_RAID_ID,
      name: manaforgeLastBoss.name,
      sortOrder: manaforgeLastBoss.sortOrder,
      blizzardEncounterIds: JSON.stringify(manaforgeLastBoss.blizzardEncounterIds),
      wclEncounterIds: JSON.stringify(manaforgeLastBoss.warcraftLogsEncounterIds),
    });
    // Only the missing boss came back; the renamed boss keeps its id and is never duplicated.
    expect((await orm.RaidBoss.select("id").all()).length).toBe(bossCountBefore + 1);
  });
});
