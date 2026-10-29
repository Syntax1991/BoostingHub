#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/25368e38526cd62cfae17bb29020bd90a0541020d5dcf1193a0562091b451711/contract';
import endContract from '../../snapshots/25368e38526cd62cfae17bb29020bd90a0541020d5dcf1193a0562091b451711/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/4dc4e3e4992b86217d8fc9d3ea09bfe0b3deee47daf3a2d4e789bc0e64f58198/contract';
import startContract from '../../snapshots/4dc4e3e4992b86217d8fc9d3ea09bfe0b3deee47daf3a2d4e789bc0e64f58198/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'run_discord_announcement',
        constraint: 'run_discord_announcement_type_check_93ddaaed',
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_discord_announcement',
        column: col('helpRoles', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_discord_announcement',
        constraint: 'run_discord_announcement_type_check_7dc0d0e2',
        expression:
          "\"type\" IN ('RUN_RESCHEDULED', 'RUN_CANCELLED', 'RUN_REACTIVATED', 'RUN_SCOPE_CHANGED', 'LATE_FILL_HELP')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
