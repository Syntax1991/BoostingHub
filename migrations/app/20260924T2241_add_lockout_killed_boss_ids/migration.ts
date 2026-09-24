#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/d15547a2c6dd3b86346f672849fcc38e6c1a83e93dba522b6b926ea2cd2062f9/contract';
import startContract from '../../snapshots/d15547a2c6dd3b86346f672849fcc38e6c1a83e93dba522b6b926ea2cd2062f9/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e98563859594fd00daa0d639f97732df3fafec261bfc8689e680decc7b02c94e/contract';
import endContract from '../../snapshots/e98563859594fd00daa0d639f97732df3fafec261bfc8689e680decc7b02c94e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'character_raid_lockout',
        column: col('killedBossIds', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
