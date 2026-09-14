#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/60c56dbcad0eaa2dc5cc7234e8a78e3df3cf3abbe41bd3c63f92b3e978279fa4/contract';
import endContract from '../../snapshots/60c56dbcad0eaa2dc5cc7234e8a78e3df3cf3abbe41bd3c63f92b3e978279fa4/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a2fe637fd1ffa1754e920299de0414c0552ff8124c0c80ea37e3e3b4361f6351/contract';
import startContract from '../../snapshots/a2fe637fd1ffa1754e920299de0414c0552ff8124c0c80ea37e3e3b4361f6351/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({
        schema: 'public',
        table: 'run_start_snapshot',
        column: 'goldCollector1Name',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'run_start_snapshot',
        column: 'goldCollector1Realm',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'run_start_snapshot',
        column: 'goldCollector2Name',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'run_start_snapshot',
        column: 'goldCollector2Realm',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
