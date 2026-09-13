#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/446fdbf8b590ea5c4a84fedce42c3f52fa2c1ca2cb50b57bd567d4adccb8f97b/contract';
import startContract from '../../snapshots/446fdbf8b590ea5c4a84fedce42c3f52fa2c1ca2cb50b57bd567d4adccb8f97b/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/a2fe637fd1ffa1754e920299de0414c0552ff8124c0c80ea37e3e3b4361f6351/contract';
import endContract from '../../snapshots/a2fe637fd1ffa1754e920299de0414c0552ff8124c0c80ea37e3e3b4361f6351/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'run_start_snapshot',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('goldCollector1Name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('goldCollector1Realm', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('goldCollector2Name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('goldCollector2Realm', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('runId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('startedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_discord_post',
        column: col('startChannelId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_discord_post',
        column: col('startMessageId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_discord_post',
        column: col('startPostedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_start_snapshot',
        constraint: 'run_start_snapshot_runId_key',
        columns: ['runId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_start_snapshot',
        index: 'run_start_snapshot_startedById_idx_a8358300',
        columns: ['startedById'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_start_snapshot',
        foreignKey: {
          name: 'run_start_snapshot_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'run', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_start_snapshot',
        foreignKey: {
          name: 'run_start_snapshot_startedById_fkey',
          columns: ['startedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
