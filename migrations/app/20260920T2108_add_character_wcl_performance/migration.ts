#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/d0baceb8d12d7ee342eee5e908f4cc64cb38514a74bf2efef58af6458a5aabf1/contract';
import startContract from '../../snapshots/d0baceb8d12d7ee342eee5e908f4cc64cb38514a74bf2efef58af6458a5aabf1/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e13eedd1751f2a8f28c4322ddbeacbdf97eaa74ee6f99ab1e1d7ab487fd7dedd/contract';
import endContract from '../../snapshots/e13eedd1751f2a8f28c4322ddbeacbdf97eaa74ee6f99ab1e1d7ab487fd7dedd/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'character_wcl_performance',
        columns: [
          col('avgPct', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
          col('bestPct', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
          col('characterId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('difficulty', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('encounterId', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('fetchedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metricKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('zoneId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'character_wcl_performance',
        constraint: 'character_wcl_perf_uq',
        columns: ['characterId', 'zoneId', 'encounterId', 'difficulty', 'metricKey'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'character_wcl_performance',
        index: 'character_wcl_perf_character_idx',
        columns: ['characterId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'character_wcl_performance',
        foreignKey: {
          name: 'character_wcl_performance_characterId_fkey',
          columns: ['characterId'],
          references: { schema: 'public', table: 'character', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
