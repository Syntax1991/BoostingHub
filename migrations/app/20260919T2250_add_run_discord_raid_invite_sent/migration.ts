#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/6226ed1c5c811c3b10b25e618f47db27972dc35fdba6a0a5b47992da49679406/contract';
import startContract from '../../snapshots/6226ed1c5c811c3b10b25e618f47db27972dc35fdba6a0a5b47992da49679406/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/94cadc98f7f681a5a924f8038077e2a475f215299a5fe2cc44e7b02a2c6a306a/contract';
import endContract from '../../snapshots/94cadc98f7f681a5a924f8038077e2a475f215299a5fe2cc44e7b02a2c6a306a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run_discord_post',
        column: col('raidInviteSentSignupIds', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
