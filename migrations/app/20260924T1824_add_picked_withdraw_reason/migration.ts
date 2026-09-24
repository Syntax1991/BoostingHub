#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/a2610b424b6d8e89c59ad5c6e53c89e83b866d960a218fd5c2b457ed35a06d05/contract';
import endContract from '../../snapshots/a2610b424b6d8e89c59ad5c6e53c89e83b866d960a218fd5c2b457ed35a06d05/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c85b5ac147fb990a2a877fac6346c50336afdd8cee55b49c12996d6bd1834e6e/contract';
import startContract from '../../snapshots/c85b5ac147fb990a2a877fac6346c50336afdd8cee55b49c12996d6bd1834e6e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'user_notification',
        constraint: 'user_notification_type_check_3f82dea7',
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_signup',
        column: col('withdrawReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'user_notification',
        constraint: 'user_notification_type_check_6413e97d',
        expression:
          "\"type\" IN ('ROSTER_SELECTED', 'RAID_INVITE', 'RUN_CANCELLED', 'RUN_RESCHEDULED', 'ROSTER_REMOVED', 'ROSTER_WITHDRAWN')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
