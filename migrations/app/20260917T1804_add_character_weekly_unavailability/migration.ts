#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/740029d3e7be9cc73d969cdebeac876082ab92e038a773dff561334fb95b08bc/contract';
import endContract from '../../snapshots/740029d3e7be9cc73d969cdebeac876082ab92e038a773dff561334fb95b08bc/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/966a9105220945586e21dcce84f7286ebac50074def621915221c66e20600735/contract';
import startContract from '../../snapshots/966a9105220945586e21dcce84f7286ebac50074def621915221c66e20600735/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'character_weekly_unavailability',
        columns: [
          col('characterId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resetIdentifier', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'character_weekly_unavailability',
        constraint: 'character_weekly_unavailability_characterId_resetIdentifier_key',
        columns: ['characterId', 'resetIdentifier'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'character_weekly_unavailability',
        index: 'character_weekly_unavailability_characterId_idx_2423fe9d',
        columns: ['characterId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'character_weekly_unavailability',
        index: 'character_weekly_unavailability_resetIdentifier_idx_bfbda43f',
        columns: ['resetIdentifier'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'character_weekly_unavailability',
        foreignKey: {
          name: 'character_weekly_unavailability_characterId_fkey',
          columns: ['characterId'],
          references: { schema: 'public', table: 'character', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
