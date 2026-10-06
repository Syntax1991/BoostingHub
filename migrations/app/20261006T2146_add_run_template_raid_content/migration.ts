#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0e66c1fef0162ce4e3b958b28c3ed87e0ca500d00262092a14cb250d70b5a485/contract';
import endContract from '../../snapshots/0e66c1fef0162ce4e3b958b28c3ed87e0ca500d00262092a14cb250d70b5a485/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/348d8a8ee91b946265bf0c026db33325e99bc0943b9a46739f2f82d4cd026a3c/contract';
import startContract from '../../snapshots/348d8a8ee91b946265bf0c026db33325e99bc0943b9a46739f2f82d4cd026a3c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, rawSql } from '@prisma/orm-postgres/migration';

/**
 * One RunTemplateRaidContent row per existing RunTemplate from singular columns.
 * Idempotent: skips templates that already have any content row.
 */
function backfillTemplateContentsFromLegacyColumns() {
  return rawSql({
    id: 'data_migration.backfill-run-template-raid-content-from-legacy',
    label: 'Data transform: backfill RunTemplateRaidContent from RunTemplate.raidId/plannedBossCount',
    operationClass: 'data',
    target: { id: 'postgres' },
    precheck: [
      {
        description: 'Allow RunTemplateRaidContent backfill (idempotent insert)',
        sql: 'SELECT true AS ok',
        params: [],
      },
    ],
    execute: [
      {
        description: 'Insert sortOrder=1 content mirroring each template singular raid fields',
        sql: `INSERT INTO "run_template_raid_content" ("id", "runTemplateId", "raidId", "sortOrder", "plannedBossCount", "createdAt")
SELECT gen_random_uuid()::text, t."id", t."raidId", 1, t."plannedBossCount", t."createdAt"
FROM "run_template" t
WHERE NOT EXISTS (
  SELECT 1 FROM "run_template_raid_content" c WHERE c."runTemplateId" = t."id"
)`,
        params: [],
      },
    ],
    postcheck: [
      {
        description: 'Every RunTemplate has a matching sortOrder=1 content for its singular raid fields',
        sql: `SELECT NOT EXISTS (
  SELECT 1 FROM "run_template" t
  WHERE NOT EXISTS (
    SELECT 1 FROM "run_template_raid_content" c
    WHERE c."runTemplateId" = t."id"
      AND c."raidId" = t."raidId"
      AND c."plannedBossCount" = t."plannedBossCount"
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
        table: 'run_template_raid_content',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('plannedBossCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('raidId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('runTemplateId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sortOrder', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_template_raid_content',
        constraint: 'run_template_raid_content_runTemplateId_raidId_key',
        columns: ['runTemplateId', 'raidId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_template_raid_content',
        constraint: 'run_template_raid_content_runTemplateId_sortOrder_key',
        columns: ['runTemplateId', 'sortOrder'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_template_raid_content',
        index: 'run_template_raid_content_raidId_idx_996eeca9',
        columns: ['raidId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_template_raid_content',
        index: 'run_template_raid_content_runTemplateId_idx_99c44c3d',
        columns: ['runTemplateId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_template_raid_content',
        foreignKey: {
          name: 'run_template_raid_content_runTemplateId_fkey',
          columns: ['runTemplateId'],
          references: { schema: 'public', table: 'run_template', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_template_raid_content',
        foreignKey: {
          name: 'run_template_raid_content_raidId_fkey',
          columns: ['raidId'],
          references: { schema: 'public', table: 'raid', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      backfillTemplateContentsFromLegacyColumns(),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
