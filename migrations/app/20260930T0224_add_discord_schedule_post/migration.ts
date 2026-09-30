#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0997cd939b8c093f24b9df56258422bc1a5301ab4026b9d91344a21da13ee44b/contract';
import endContract from '../../snapshots/0997cd939b8c093f24b9df56258422bc1a5301ab4026b9d91344a21da13ee44b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/415430a681c72b2ecaaf5c450efc66212913fb8b18e1b315a0a512c21f841031/contract';
import startContract from '../../snapshots/415430a681c72b2ecaaf5c450efc66212913fb8b18e1b315a0a512c21f841031/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'discord_schedule_post',
        columns: [
          col('bucket', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('channelId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastSignature', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('messageId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'discord_schedule_post_bucket_check_b7555829',
            "\"bucket\" IN ('CURRENT', 'NEXT')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'discord_schedule_post',
        constraint: 'discord_schedule_post_bucket_key',
        columns: ['bucket'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
