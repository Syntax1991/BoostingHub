#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/786753873a13c54dae528bf9166f6cfdbfde274e041dd20fc370210795d0e3cc/contract';
import startContract from '../../snapshots/786753873a13c54dae528bf9166f6cfdbfde274e041dd20fc370210795d0e3cc/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/a4ffcd2c3331ed35c1500027a7baa2bf28de8a8656c1c46ffd7aaefa43a26c23/contract';
import endContract from '../../snapshots/a4ffcd2c3331ed35c1500027a7baa2bf28de8a8656c1c46ffd7aaefa43a26c23/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'run_discord_announcement',
        constraint: 'run_discord_announcement_type_check_b8186a62',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'user_notification',
        constraint: 'user_notification_type_check_6413e97d',
      }),
      this.addColumn({
        schema: 'public',
        table: 'run',
        column: col('cancelRevision', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'run',
        column: col('cancelledFromSignupsOpen', 'bool', { codecRef: { codecId: 'pg/bool@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'run',
        column: col('cancelledFromStatus', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run',
        constraint: 'run_cancelledFromStatus_check_30cdad8d',
        expression:
          "\"cancelledFromStatus\" IN ('DRAFT', 'OPEN', 'ROSTERING', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_discord_announcement',
        constraint: 'run_discord_announcement_type_check_2be127eb',
        expression: "\"type\" IN ('RUN_RESCHEDULED', 'RUN_CANCELLED', 'RUN_REACTIVATED')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'user_notification',
        constraint: 'user_notification_type_check_c6b92315',
        expression:
          "\"type\" IN ('ROSTER_SELECTED', 'RAID_INVITE', 'RUN_CANCELLED', 'RUN_RESCHEDULED', 'ROSTER_REMOVED', 'ROSTER_WITHDRAWN', 'RUN_REACTIVATED')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
