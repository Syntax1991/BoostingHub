#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/88b442eebc2abf05f8e275d54d2e4f0af2e09f5143d0c164797fe29f8b22fd8f/contract';
import endContract from '../../snapshots/88b442eebc2abf05f8e275d54d2e4f0af2e09f5143d0c164797fe29f8b22fd8f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/8f242b35db5fe36cfdada043c58c954d14a3429ebebef3745e05e0260a6e74ee/contract';
import startContract from '../../snapshots/8f242b35db5fe36cfdada043c58c954d14a3429ebebef3745e05e0260a6e74ee/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
  rawSql,
} from '@prisma/orm-postgres/migration';

/**
 * Content catalog seed. Self-contained snapshot of the code catalog at the time
 * of this migration (never import app code into a migration).
 *
 * Identity safety: existing Raid / RaidBoss rows keep their UUIDs, names,
 * seasons, isActive and sortOrder. Only the NEW metadata columns are filled for
 * them. Missing raids/bosses (fresh database) are inserted with the stable
 * UUIDs. Runs, RunTemplates and CharacterRaidLockout rows are never touched.
 */
const SEED_RAIDS = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Manaforge Omega', season: 'The War Within Season 3', isActive: false, sortOrder: 1, trackLockouts: false, blizzardInstanceId: 1302, wclZoneId: null, wclRankingEncounterId: null },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'The Venomous Abyss', season: 'Midnight Season 2', isActive: true, sortOrder: 2, trackLockouts: true, blizzardInstanceId: 1320, wclZoneId: 53, wclRankingEncounterId: null },
  { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'The Tidebound Grotto', season: 'Midnight Season 2', isActive: false, sortOrder: 3, trackLockouts: true, blizzardInstanceId: 1317, wclZoneId: 53, wclRankingEncounterId: 3379 },
] as const;

// [id, raidId, name, sortOrder, blizzardEncounterIds, wclEncounterIds]
const SEED_BOSSES: ReadonlyArray<readonly [string, string, string, number, number[], number[]]> = [
  ['ab000001-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Plexus Sentinel', 1, [2684], [3129]],
  ['ab000002-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', "Loom'ithar", 2, [2686], [3131]],
  ['ab000003-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Soulbinder Naazindhri', 3, [2685], [3130]],
  ['ab000004-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Forgeweaver Araz', 4, [2687], [3132]],
  ['ab000005-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'The Soul Hunters', 5, [2688], [3122]],
  ['ab000006-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Fractillus', 6, [2747], [3133]],
  ['ab000007-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Nexus-King Salhadaar', 7, [2690], [3134]],
  ['ab000008-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Dimensius, the All-Devouring', 8, [2691], [3135]],
  ['bb000001-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', "Nek'zali the Soulcoiler", 1, [2888], [3470]],
  ['bb000002-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Entombed Sentinels', 2, [2874], [3445]],
  ['bb000003-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'The Lost Explorers', 3, [2894], [3497]],
  ['bb000004-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Vashnik the Malignant', 4, [2882], [3455]],
  ['bb000005-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Sszorak', 5, [2871], [3420]],
  ['bb000006-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'The Twin Fangs', 6, [2887], [3421]],
  ['bb000007-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'The Coiled Altar', 7, [2883], [3429]],
  ['bb000008-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', "Ula'tek", 8, [2895], [3492]],
  ['cc000001-cccc-4ccc-8ccc-cccccccccccc', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Nymrissa Wavecaller', 1, [2849], [3379]],
];

const SEED_PRODUCTS = [
  { id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', key: 'VENOMOUS_ABYSS', name: 'The Venomous Abyss', sortOrder: 1 },
  { id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2', key: 'MIDNIGHT_S2_BUNDLE', name: 'Season 2 Bundle — Tide + The Venomous Abyss', sortOrder: 2 },
] as const;

// [id, productId, raidId, sortOrder, bossCountMode, fixedBossCount, minBossCount, defaultBossCount]
const SEED_PRODUCT_CONTENTS: ReadonlyArray<
  readonly [string, string, string, number, 'FIXED' | 'VARIABLE', number | null, number | null, number | null]
> = [
  ['dd000001-dddd-4ddd-8ddd-dddddddddddd', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1, 'VARIABLE', null, 1, 8],
  ['dd000002-dddd-4ddd-8ddd-dddddddddddd', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 1, 'FIXED', 1, null, null],
  ['dd000003-dddd-4ddd-8ddd-dddddddddddd', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2, 'VARIABLE', null, 1, 8],
];

function q(value: string | number | boolean | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

function idList(values: number[]): string {
  return q(JSON.stringify(values));
}

function seedContentCatalog() {
  const raidRows = SEED_RAIDS.map(
    (r) =>
      `(${[r.id, r.name, r.season, r.isActive, r.sortOrder, r.trackLockouts, r.blizzardInstanceId, r.wclZoneId, r.wclRankingEncounterId].map(q).join(', ')}, now(), now())`,
  ).join(',\n  ');
  const bossRows = SEED_BOSSES.map(
    ([id, raidId, name, sortOrder, blizzard, wcl]) =>
      `(${q(id)}, ${q(raidId)}, ${q(name)}, ${sortOrder}, ${idList(blizzard)}, ${idList(wcl)})`,
  ).join(',\n  ');
  const productRows = SEED_PRODUCTS.map(
    (p) => `(${q(p.id)}, ${q(p.key)}, ${q(p.name)}, true, true, ${p.sortOrder}, now(), now())`,
  ).join(',\n  ');
  const contentRows = SEED_PRODUCT_CONTENTS.map((row) => `(${row.map(q).join(', ')})`).join(',\n  ');

  const expectedRaids = SEED_RAIDS.map(
    (r) =>
      `(${[r.id, r.sortOrder, r.trackLockouts, r.blizzardInstanceId, r.wclZoneId, r.wclRankingEncounterId].map(q).join(', ')})`,
  ).join(', ');
  const expectedBosses = SEED_BOSSES.map(
    ([id, , , , blizzard, wcl]) => `(${q(id)}, ${idList(blizzard)}, ${idList(wcl)})`,
  ).join(', ');
  const seededBossKeys = SEED_BOSSES.map(([id, raidId, name]) => `(${q(id)}, ${q(raidId)}, ${q(name)})`).join(', ');
  const contentIds = SEED_PRODUCT_CONTENTS.map(([id]) => q(id)).join(', ');
  const productKeys = SEED_PRODUCTS.map((p) => q(p.key)).join(', ');

  return rawSql({
    id: 'data_migration.seed-content-catalog',
    label: 'Data seed: raid catalog metadata (Blizzard/WCL ids, lockout tracking) and products',
    operationClass: 'data',
    target: { id: 'postgres' },
    precheck: [
      {
        description: 'No existing boss holds a seeded (raid, name) under a different id (identity must be preserved)',
        sql: `SELECT NOT EXISTS (
  SELECT 1 FROM "raid_boss" b
  JOIN (VALUES ${seededBossKeys}) AS s(id, "raidId", name) ON s."raidId" = b."raidId" AND s.name = b.name
  WHERE b.id <> s.id
) AS ok`,
        params: [],
      },
    ],
    execute: [
      {
        description: 'Insert missing raids; fill only the new metadata columns on existing raids',
        sql: `INSERT INTO "raid" ("id", "name", "season", "isActive", "sortOrder", "trackLockouts", "blizzardInstanceId", "wclZoneId", "wclRankingEncounterId", "createdAt", "updatedAt")
VALUES
  ${raidRows}
ON CONFLICT ("id") DO UPDATE SET
  "sortOrder" = EXCLUDED."sortOrder",
  "trackLockouts" = EXCLUDED."trackLockouts",
  "blizzardInstanceId" = EXCLUDED."blizzardInstanceId",
  "wclZoneId" = EXCLUDED."wclZoneId",
  "wclRankingEncounterId" = EXCLUDED."wclRankingEncounterId"`,
        params: [],
      },
      {
        description: 'Insert missing bosses; fill only the encounter id columns on existing bosses',
        sql: `INSERT INTO "raid_boss" ("id", "raidId", "name", "sortOrder", "blizzardEncounterIds", "wclEncounterIds")
VALUES
  ${bossRows}
ON CONFLICT ("id") DO UPDATE SET
  "blizzardEncounterIds" = EXCLUDED."blizzardEncounterIds",
  "wclEncounterIds" = EXCLUDED."wclEncounterIds"`,
        params: [],
      },
      {
        description: 'Insert products',
        sql: `INSERT INTO "product" ("id", "key", "name", "active", "selectable", "sortOrder", "createdAt", "updatedAt")
VALUES
  ${productRows}
ON CONFLICT DO NOTHING`,
        params: [],
      },
      {
        description: 'Insert product raid contents',
        sql: `INSERT INTO "product_raid_content" ("id", "productId", "raidId", "sortOrder", "bossCountMode", "fixedBossCount", "minBossCount", "defaultBossCount")
VALUES
  ${contentRows}
ON CONFLICT DO NOTHING`,
        params: [],
      },
    ],
    postcheck: [
      {
        description: 'Every seeded raid carries its catalog metadata',
        sql: `SELECT NOT EXISTS (
  SELECT 1 FROM (VALUES ${expectedRaids}) AS e(id, "sortOrder", "trackLockouts", "blizzardInstanceId", "wclZoneId", "wclRankingEncounterId")
  LEFT JOIN "raid" r ON r.id = e.id
  WHERE r.id IS NULL
     OR r."sortOrder" <> e."sortOrder"
     OR r."trackLockouts" <> e."trackLockouts"
     OR r."blizzardInstanceId" IS DISTINCT FROM e."blizzardInstanceId"::int4
     OR r."wclZoneId" IS DISTINCT FROM e."wclZoneId"::int4
     OR r."wclRankingEncounterId" IS DISTINCT FROM e."wclRankingEncounterId"::int4
) AS ok`,
        params: [],
      },
      {
        description: 'Every seeded boss carries its Blizzard and WCL encounter ids',
        sql: `SELECT NOT EXISTS (
  SELECT 1 FROM (VALUES ${expectedBosses}) AS e(id, "blizzardEncounterIds", "wclEncounterIds")
  LEFT JOIN "raid_boss" b ON b.id = e.id
  WHERE b.id IS NULL
     OR b."blizzardEncounterIds" <> e."blizzardEncounterIds"
     OR b."wclEncounterIds" <> e."wclEncounterIds"
) AS ok`,
        params: [],
      },
      {
        description: 'Seeded products and their contents exist',
        sql: `SELECT (
  (SELECT count(*) FROM "product" WHERE "key" IN (${productKeys})) = ${SEED_PRODUCTS.length}
  AND (SELECT count(*) FROM "product_raid_content" WHERE "id" IN (${contentIds})) = ${SEED_PRODUCT_CONTENTS.length}
) AS ok`,
        params: [],
      },
    ],
  });
}

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'product',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('selectable', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('sortOrder', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'product_raid_content',
        columns: [
          col('bossCountMode', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('defaultBossCount', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('fixedBossCount', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('minBossCount', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('productId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('raidId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sortOrder', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'product_raid_content_bossCountMode_check_2c6322c6',
            "\"bossCountMode\" IN ('FIXED', 'VARIABLE')",
          ),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'raid',
        column: col('blizzardInstanceId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'raid',
        column: col('sortOrder', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'raid',
        column: col('trackLockouts', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'raid',
        column: col('wclRankingEncounterId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'raid',
        column: col('wclZoneId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'raid_boss',
        column: col('blizzardEncounterIds', 'text', {
          notNull: true,
          default: lit('[]'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'raid_boss',
        column: col('wclEncounterIds', 'text', {
          notNull: true,
          default: lit('[]'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'product',
        constraint: 'product_key_key',
        columns: ['key'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'product_raid_content',
        constraint: 'product_raid_content_productId_sortOrder_key',
        columns: ['productId', 'sortOrder'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'product_raid_content',
        constraint: 'product_raid_content_productId_raidId_key',
        columns: ['productId', 'raidId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_raid_content',
        index: 'product_raid_content_productId_idx_5858600a',
        columns: ['productId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_raid_content',
        index: 'product_raid_content_raidId_idx_996eeca9',
        columns: ['raidId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'product_raid_content',
        foreignKey: {
          name: 'product_raid_content_productId_fkey',
          columns: ['productId'],
          references: { schema: 'public', table: 'product', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'product_raid_content',
        foreignKey: {
          name: 'product_raid_content_raidId_fkey',
          columns: ['raidId'],
          references: { schema: 'public', table: 'raid', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      seedContentCatalog(),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
