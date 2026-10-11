#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/6ded3b0ad9f6ae304b15b27fe143363beed1ec34dbc4e4a35734562026b747c5/contract';
import endContract from '../../snapshots/6ded3b0ad9f6ae304b15b27fe143363beed1ec34dbc4e4a35734562026b747c5/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/7285120304500c3db5259df8a2e1b11f547ad54869b97c8767afdb8c3637973f/contract';
import startContract from '../../snapshots/7285120304500c3db5259df8a2e1b11f547ad54869b97c8767afdb8c3637973f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'run_discord_announcement',
        constraint: 'run_discord_announcement_type_check_2be127eb',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'user_notification',
        constraint: 'user_notification_type_check_c6b92315',
      }),
      this.addColumn({
        schema: 'public',
        table: 'run',
        column: col('contentRevision', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_discord_announcement',
        column: col('scopeChanges', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_discord_announcement',
        constraint: 'run_discord_announcement_type_check_93ddaaed',
        expression:
          "\"type\" IN ('RUN_RESCHEDULED', 'RUN_CANCELLED', 'RUN_REACTIVATED', 'RUN_SCOPE_CHANGED')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'user_notification',
        constraint: 'user_notification_type_check_586fff74',
        expression:
          "\"type\" IN ('ROSTER_SELECTED', 'RAID_INVITE', 'RUN_CANCELLED', 'RUN_RESCHEDULED', 'ROSTER_REMOVED', 'ROSTER_WITHDRAWN', 'RUN_REACTIVATED', 'RUN_SCOPE_CHANGED')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
