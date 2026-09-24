#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/a2610b424b6d8e89c59ad5c6e53c89e83b866d960a218fd5c2b457ed35a06d05/contract';
import startContract from '../../snapshots/a2610b424b6d8e89c59ad5c6e53c89e83b866d960a218fd5c2b457ed35a06d05/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/afb462bc9bb4914a27f98ec03af85ab70e9691f2eb755b863759050f4773aa36/contract';
import endContract from '../../snapshots/afb462bc9bb4914a27f98ec03af85ab70e9691f2eb755b863759050f4773aa36/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run_discord_post',
        column: col('lastStartRosterVersion', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
