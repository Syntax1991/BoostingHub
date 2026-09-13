#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/40a32a4868bfdb44beb2a152a157bab172c5b30044b41969861f2122dd0b4071/contract';
import startContract from '../../snapshots/40a32a4868bfdb44beb2a152a157bab172c5b30044b41969861f2122dd0b4071/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/9d7de262ce89e4758b1c93ed1c10ea84eae34d6151ed45a79c920f28ac13a7f1/contract';
import endContract from '../../snapshots/9d7de262ce89e4758b1c93ed1c10ea84eae34d6151ed45a79c920f28ac13a7f1/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run_settlement',
        column: col('raidLeadCutMode', 'text', {
          notNull: true,
          default: lit('SHARE'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_settlement',
        constraint: 'run_settlement_raidLeadCutMode_check_8050fe6d',
        expression: "\"raidLeadCutMode\" IN ('KEEP', 'SHARE')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
