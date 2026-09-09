#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/dd1bc61818d0b4aeb417568d27fa6091417e19ea8d2525f6119a578233d3a0c1/contract';
import endContract from '../../snapshots/dd1bc61818d0b4aeb417568d27fa6091417e19ea8d2525f6119a578233d3a0c1/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/dee9853feea3fb59f766200ac8782b6af08b55290afa6d9546016404bd84f5a3/contract';
import startContract from '../../snapshots/dee9853feea3fb59f766200ac8782b6af08b55290afa6d9546016404bd84f5a3/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'booster_access',
        constraint: 'booster_access_status_check_3260663c',
      }),
      this.addColumn({
        schema: 'public',
        table: 'booster_access',
        column: col('reviewedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'booster_access',
        column: col('reviewedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'booster_access',
        constraint: 'booster_access_status_check_4f4d1767',
        expression: "\"status\" IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED')",
      }),
      this.createIndex({
        schema: 'public',
        table: 'booster_access',
        index: 'booster_access_reviewedById_idx_e2835478',
        columns: ['reviewedById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'booster_access',
        index: 'booster_access_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'booster_access',
        foreignKey: {
          name: 'booster_access_reviewedById_fkey',
          columns: ['reviewedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
