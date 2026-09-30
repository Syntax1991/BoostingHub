#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/786753873a13c54dae528bf9166f6cfdbfde274e041dd20fc370210795d0e3cc/contract';
import endContract from '../../snapshots/786753873a13c54dae528bf9166f6cfdbfde274e041dd20fc370210795d0e3cc/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/dbad356042188ae4456d56fe738b240c8c251a8e45f548d1158ad6a44ea47f33/contract';
import startContract from '../../snapshots/dbad356042188ae4456d56fe738b240c8c251a8e45f548d1158ad6a44ea47f33/contract.json' with { type: 'json' };
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
