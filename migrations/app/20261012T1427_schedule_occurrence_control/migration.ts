#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/694ae2b74bb3d73ff2a3730e8eafe50ea015fa8ed8ec51989f56391f79aaa99f/contract';
import endContract from '../../snapshots/694ae2b74bb3d73ff2a3730e8eafe50ea015fa8ed8ec51989f56391f79aaa99f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/6ded3b0ad9f6ae304b15b27fe143363beed1ec34dbc4e4a35734562026b747c5/contract';
import startContract from '../../snapshots/6ded3b0ad9f6ae304b15b27fe143363beed1ec34dbc4e4a35734562026b747c5/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'community_schedule_run',
        column: col('origin', 'text', {
          notNull: true,
          default: lit('MATERIALIZED'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'community_schedule_slot',
        column: col('firstWindowStartAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'community_schedule_run',
        constraint: 'community_schedule_run_origin_check_ba8ca21e',
        expression: "\"origin\" IN ('MATERIALIZED', 'ATTACHED')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
