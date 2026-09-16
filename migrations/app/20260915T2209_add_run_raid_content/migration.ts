#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/9472b92f2c500d16a01866a6ef3b535617bcbedba167210e36f5cde896376c5f/contract';
import endContract from '../../snapshots/9472b92f2c500d16a01866a6ef3b535617bcbedba167210e36f5cde896376c5f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/ef31069df7e990253bb121096193155ce91c322f9c4da10a3b400c9ece4fe9ed/contract';
import startContract from '../../snapshots/ef31069df7e990253bb121096193155ce91c322f9c4da10a3b400c9ece4fe9ed/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, rawSql } from '@prisma/orm-postgres/migration';

/**
 * One RunRaidContent row per existing Run from transitional singular columns.
 * Idempotent: skips Runs that already have any content row.
 */
function backfillRunRaidContentFromLegacyRunColumns() {
  return rawSql({
    id: 'data_migration.backfill-run-raid-content-from-legacy',
    label: 'Data transform: backfill RunRaidContent from Run.raidId/plannedBossCount',
    operationClass: 'data',
    target: { id: 'postgres' },
    precheck: [
      {
        description: 'Allow RunRaidContent backfill (idempotent insert)',
        sql: 'SELECT true AS ok',
        params: [],
      },
    ],
    execute: [
      {
        description: 'Insert sortOrder=1 content mirroring each Run singular raid fields',
        sql: `INSERT INTO "run_raid_content" ("id", "runId", "raidId", "sortOrder", "plannedBossCount", "createdAt")
SELECT gen_random_uuid()::text, r."id", r."raidId", 1, r."plannedBossCount", r."createdAt"
FROM "run" r
WHERE NOT EXISTS (
  SELECT 1 FROM "run_raid_content" c WHERE c."runId" = r."id"
)`,
        params: [],
      },
    ],
    postcheck: [
      {
        description: 'Every Run has a matching sortOrder=1 content for its singular raid fields',
        sql: `SELECT NOT EXISTS (
  SELECT 1 FROM "run" r
  WHERE NOT EXISTS (
    SELECT 1 FROM "run_raid_content" c
    WHERE c."runId" = r."id"
      AND c."raidId" = r."raidId"
      AND c."plannedBossCount" = r."plannedBossCount"
      AND c."sortOrder" = 1
  )
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
        table: 'run_raid_content',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('plannedBossCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('raidId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('runId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sortOrder', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_raid_content',
        constraint: 'run_raid_content_runId_raidId_key',
        columns: ['runId', 'raidId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_raid_content',
        constraint: 'run_raid_content_runId_sortOrder_key',
        columns: ['runId', 'sortOrder'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_raid_content',
        index: 'run_raid_content_raidId_idx_996eeca9',
        columns: ['raidId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_raid_content',
        index: 'run_raid_content_runId_idx_a6016437',
        columns: ['runId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_raid_content',
        foreignKey: {
          name: 'run_raid_content_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'run', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_raid_content',
        foreignKey: {
          name: 'run_raid_content_raidId_fkey',
          columns: ['raidId'],
          references: { schema: 'public', table: 'raid', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      backfillRunRaidContentFromLegacyRunColumns(),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
