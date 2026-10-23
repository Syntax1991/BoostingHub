#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/18eedde5299606ba7da14228477db8c80918d4ca030f4ccdc68cddf994078cab/contract';
import startContract from '../../snapshots/18eedde5299606ba7da14228477db8c80918d4ca030f4ccdc68cddf994078cab/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/61b92f9402f7825de761de9d22b7ce30c0a3a4d6e59f9c54d21f64583fd27260/contract';
import endContract from '../../snapshots/61b92f9402f7825de761de9d22b7ce30c0a3a4d6e59f9c54d21f64583fd27260/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'user_notification',
        constraint: 'user_notification_type_check_586fff74',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'user_notification',
        constraint: 'user_notification_type_check_00ed1686',
        expression:
          "\"type\" IN ('ROSTER_SELECTED', 'RAID_INVITE', 'RUN_CANCELLED', 'RUN_RESCHEDULED', 'ROSTER_REMOVED', 'ROSTER_WITHDRAWN', 'RUN_REACTIVATED', 'RUN_SCOPE_CHANGED', 'CHARACTER_BATTLENET_REPAIR')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
