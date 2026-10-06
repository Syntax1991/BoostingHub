#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0e66c1fef0162ce4e3b958b28c3ed87e0ca500d00262092a14cb250d70b5a485/contract';
import startContract from '../../snapshots/0e66c1fef0162ce4e3b958b28c3ed87e0ca500d00262092a14cb250d70b5a485/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/9a4b528d68b4bad608906c9fe9eea6e8c2d367549a41308c9dc6ffb440a30595/contract';
import endContract from '../../snapshots/9a4b528d68b4bad608906c9fe9eea6e8c2d367549a41308c9dc6ffb440a30595/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

/**
 * Allow Schedule slot hard-delete after materialization:
 * CommunityScheduleRun.scheduleSlotId becomes nullable with ON DELETE SET NULL.
 * Concrete Runs and provenance rows are preserved.
 */
export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropConstraint({
        schema: 'public',
        table: 'community_schedule_run',
        constraint: 'community_schedule_run_scheduleSlotId_fkey',
      }),
      this.dropNotNull({
        schema: 'public',
        table: 'community_schedule_run',
        column: 'scheduleSlotId',
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'community_schedule_run',
        foreignKey: {
          name: 'community_schedule_run_scheduleSlotId_fkey',
          columns: ['scheduleSlotId'],
          references: { schema: 'public', table: 'community_schedule_slot', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
