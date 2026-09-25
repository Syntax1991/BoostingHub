#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/7047ab4203b0ba0258b8d66343044c9319e1071c6bafb3a4a315a2fef9e458cd/contract';
import startContract from '../../snapshots/7047ab4203b0ba0258b8d66343044c9319e1071c6bafb3a4a315a2fef9e458cd/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/af5737a76482ba8a717a13bc9facad3bbca86f5813c46f2cc67573ac736abd9e/contract';
import endContract from '../../snapshots/af5737a76482ba8a717a13bc9facad3bbca86f5813c46f2cc67573ac736abd9e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run_discord_post',
        column: col('lastRosterPostRevision', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_roster',
        column: col('postRevision', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_roster',
        column: col('runChangedSinceAck', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
