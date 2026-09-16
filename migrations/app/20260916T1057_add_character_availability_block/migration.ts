#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/966a9105220945586e21dcce84f7286ebac50074def621915221c66e20600735/contract';
import endContract from '../../snapshots/966a9105220945586e21dcce84f7286ebac50074def621915221c66e20600735/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/edf19dd6b7c59253e41b335b4b7dde5177c934ab38ad96f8e51cebbf2ead1c7a/contract';
import startContract from '../../snapshots/edf19dd6b7c59253e41b335b4b7dde5177c934ab38ad96f8e51cebbf2ead1c7a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'character_availability_block',
        columns: [
          col('characterId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('endsAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('startsAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'character_availability_block',
        index: 'character_availability_block_characterId_idx_2423fe9d',
        columns: ['characterId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'character_availability_block',
        foreignKey: {
          name: 'character_availability_block_characterId_fkey',
          columns: ['characterId'],
          references: { schema: 'public', table: 'character', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
