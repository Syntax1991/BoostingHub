#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/446fdbf8b590ea5c4a84fedce42c3f52fa2c1ca2cb50b57bd567d4adccb8f97b/contract';
import endContract from '../../snapshots/446fdbf8b590ea5c4a84fedce42c3f52fa2c1ca2cb50b57bd567d4adccb8f97b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/9d7de262ce89e4758b1c93ed1c10ea84eae34d6151ed45a79c920f28ac13a7f1/contract';
import startContract from '../../snapshots/9d7de262ce89e4758b1c93ed1c10ea84eae34d6151ed45a79c920f28ac13a7f1/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run_settlement',
        column: col('advertiserCutBps', 'int4', {
          notNull: true,
          default: lit(3000),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_settlement',
        column: col('boosterCutBps', 'int4', {
          notNull: true,
          default: lit(6250),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_settlement',
        column: col('raidLeadCutBps', 'int4', {
          notNull: true,
          default: lit(300),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
