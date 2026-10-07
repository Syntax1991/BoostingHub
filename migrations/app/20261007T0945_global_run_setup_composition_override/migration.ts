#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/8f242b35db5fe36cfdada043c58c954d14a3429ebebef3745e05e0260a6e74ee/contract';
import endContract from '../../snapshots/8f242b35db5fe36cfdada043c58c954d14a3429ebebef3745e05e0260a6e74ee/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/9a4b528d68b4bad608906c9fe9eea6e8c2d367549a41308c9dc6ffb440a30595/contract';
import startContract from '../../snapshots/9a4b528d68b4bad608906c9fe9eea6e8c2d367549a41308c9dc6ffb440a30595/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropConstraint({
        schema: 'public',
        table: 'run_template',
        constraint: 'run_template_raidLeadId_fkey',
        kind: 'foreignKey',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'run_template',
        index: 'run_template_raidLeadId_idx_e271c2cb',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'run_template',
        index: 'run_template_raidLeadId_isActive_idx_584288ab',
      }),
      this.dropColumn({ schema: 'public', table: 'run_template', column: 'raidLeadId' }),
      this.addColumn({
        schema: 'public',
        table: 'community_schedule_slot',
        column: col('compositionOverrideEnabled', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'community_schedule_slot',
        column: col('desiredDpsCountOverride', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'community_schedule_slot',
        column: col('desiredHealerCountOverride', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'community_schedule_slot',
        column: col('desiredLootbuddyCountOverride', 'int4', {
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'community_schedule_slot',
        column: col('desiredTankCountOverride', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_template',
        index: 'run_template_isActive_idx_77fe3ba1',
        columns: ['isActive'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
