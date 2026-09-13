#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/3169e897c3da55d7b45d8993dcb94df970eba052cb8fdf00478fbc6c962e5f79/contract';
import startContract from '../../snapshots/3169e897c3da55d7b45d8993dcb94df970eba052cb8fdf00478fbc6c962e5f79/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/40a32a4868bfdb44beb2a152a157bab172c5b30044b41969861f2122dd0b4071/contract';
import endContract from '../../snapshots/40a32a4868bfdb44beb2a152a157bab172c5b30044b41969861f2122dd0b4071/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run_signup',
        column: col('lootbuddyClass', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_signup',
        constraint: 'run_signup_lootbuddyClass_check_f786dcc9',
        expression:
          "\"lootbuddyClass\" IN ('DEATH_KNIGHT', 'DEMON_HUNTER', 'DRUID', 'EVOKER', 'HUNTER', 'MAGE', 'MONK', 'PALADIN', 'PRIEST', 'ROGUE', 'SHAMAN', 'WARLOCK', 'WARRIOR')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
