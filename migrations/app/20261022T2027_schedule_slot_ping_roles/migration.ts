#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/18eedde5299606ba7da14228477db8c80918d4ca030f4ccdc68cddf994078cab/contract';
import endContract from '../../snapshots/18eedde5299606ba7da14228477db8c80918d4ca030f4ccdc68cddf994078cab/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/694ae2b74bb3d73ff2a3730e8eafe50ea015fa8ed8ec51989f56391f79aaa99f/contract';
import startContract from '../../snapshots/694ae2b74bb3d73ff2a3730e8eafe50ea015fa8ed8ec51989f56391f79aaa99f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // Additive: existing slots get false (no Discord role ping for Schedule Runs).
      this.addColumn({
        schema: 'public',
        table: 'community_schedule_slot',
        column: col('discordRolePing', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
