#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/7b89d762d89a8727648436736954dfbb86a8b6b7bf1d66f8443334e55b7289a5/contract';
import startContract from '../../snapshots/7b89d762d89a8727648436736954dfbb86a8b6b7bf1d66f8443334e55b7289a5/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/883e1fd522f355c4012102fadb12368abc4002a6fb13e8b06ea79fc3db85aecc/contract';
import endContract from '../../snapshots/883e1fd522f355c4012102fadb12368abc4002a6fb13e8b06ea79fc3db85aecc/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'user_notification',
        constraint: 'user_notification_type_check_00ed1686',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'user_notification',
        constraint: 'user_notification_type_check_ec419d7b',
        expression:
          "\"type\" IN ('ROSTER_SELECTED', 'RAID_INVITE', 'RUN_CANCELLED', 'RUN_RESCHEDULED', 'ROSTER_REMOVED', 'ROSTER_WITHDRAWN', 'RUN_REACTIVATED', 'RUN_SCOPE_CHANGED', 'CHARACTER_BATTLENET_REPAIR', 'ROSTER_CHARACTER_SAVED')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
