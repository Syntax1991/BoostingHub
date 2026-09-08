#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1d08d80fbd5ce83fe93bf007eeab4ec19d84d96384d552390a68d1d917f15ded/contract';
import endContract from '../../snapshots/1d08d80fbd5ce83fe93bf007eeab4ec19d84d96384d552390a68d1d917f15ded/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/5ebe22dcdf5e13ef91f4838978ee6cd3e75265fe59d37994ab2fde2fcea9ca5d/contract';
import startContract from '../../snapshots/5ebe22dcdf5e13ef91f4838978ee6cd3e75265fe59d37994ab2fde2fcea9ca5d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({ schema: 'public', table: 'run_signup', column: 'lootbuddyWillPlay' }),
      this.addColumn({
        schema: 'public',
        table: 'run_signup',
        column: col('lootbuddyMode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_signup',
        column: col('lootbuddyVerification', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_signup',
        constraint: 'run_signup_lootbuddyMode_check_eaa3f64b',
        expression: "\"lootbuddyMode\" IN ('LOOT_ONLY', 'PLAYING')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_signup',
        constraint: 'run_signup_lootbuddyVerification_check_c94b2402',
        expression: "\"lootbuddyVerification\" IN ('NONE', 'ACCESS', 'TRIAL')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
