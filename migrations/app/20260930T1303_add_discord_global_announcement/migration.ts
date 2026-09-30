#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/415430a681c72b2ecaaf5c450efc66212913fb8b18e1b315a0a512c21f841031/contract';
import startContract from '../../snapshots/415430a681c72b2ecaaf5c450efc66212913fb8b18e1b315a0a512c21f841031/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/dbad356042188ae4456d56fe738b240c8c251a8e45f548d1158ad6a44ea47f33/contract';
import endContract from '../../snapshots/dbad356042188ae4456d56fe738b240c8c251a8e45f548d1158ad6a44ea47f33/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'discord_global_announcement',
        columns: [
          col('channelId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('messageId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['key'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
