#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/afb462bc9bb4914a27f98ec03af85ab70e9691f2eb755b863759050f4773aa36/contract';
import startContract from '../../snapshots/afb462bc9bb4914a27f98ec03af85ab70e9691f2eb755b863759050f4773aa36/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d15547a2c6dd3b86346f672849fcc38e6c1a83e93dba522b6b926ea2cd2062f9/contract';
import endContract from '../../snapshots/d15547a2c6dd3b86346f672849fcc38e6c1a83e93dba522b6b926ea2cd2062f9/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run_external_booster',
        column: col('participationType', 'text', {
          notNull: true,
          default: lit('BOOSTER'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.dropNotNull({ schema: 'public', table: 'run_external_booster', column: 'role' }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_external_booster',
        constraint: 'run_external_booster_participationType_check_c88ba3d2',
        expression: "\"participationType\" IN ('BOOSTER', 'LOOTBUDDY')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
