#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/883475348809d9f7a8306f4723a62f0d0e12f85c94ecc2c145ad2e31e4f14886/contract';
import endContract from '../../snapshots/883475348809d9f7a8306f4723a62f0d0e12f85c94ecc2c145ad2e31e4f14886/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f5dd86968081fec0634a500b3fedabddb6d9517174a2691ff86edbcb7dadb564/contract';
import startContract from '../../snapshots/f5dd86968081fec0634a500b3fedabddb6d9517174a2691ff86edbcb7dadb564/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'community_schedule_run',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdByKind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurrenceStartAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('runId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('scheduleSlotId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('windowStartAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'community_schedule_run_createdByKind_check_49bae75c',
            "\"createdByKind\" IN ('USER', 'SYSTEM')",
          ),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'community_schedule_slot',
        column: col('autoCreateRun', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'community_schedule_slot',
        column: col('runTemplateId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'community_schedule_run',
        constraint: 'community_schedule_run_runId_key',
        columns: ['runId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'community_schedule_run',
        constraint: 'community_schedule_run_scheduleSlotId_windowStartAt_key',
        columns: ['scheduleSlotId', 'windowStartAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'community_schedule_run',
        index: 'community_schedule_run_createdById_idx_8bf640ed',
        columns: ['createdById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'community_schedule_run',
        index: 'community_schedule_run_scheduleSlotId_idx_fcaf54ee',
        columns: ['scheduleSlotId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'community_schedule_run',
        index: 'csr_slot_window_201741f9',
        columns: ['scheduleSlotId', 'windowStartAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'community_schedule_slot',
        index: 'css_auto_active_c0fd5ccb',
        columns: ['autoCreateRun', 'isActive'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'community_schedule_slot',
        index: 'css_template_99c44c3d',
        columns: ['runTemplateId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'community_schedule_run',
        foreignKey: {
          name: 'community_schedule_run_scheduleSlotId_fkey',
          columns: ['scheduleSlotId'],
          references: { schema: 'public', table: 'community_schedule_slot', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'community_schedule_run',
        foreignKey: {
          name: 'community_schedule_run_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'run', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'community_schedule_run',
        foreignKey: {
          name: 'community_schedule_run_createdById_fkey',
          columns: ['createdById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'community_schedule_slot',
        foreignKey: {
          name: 'community_schedule_slot_runTemplateId_fkey',
          columns: ['runTemplateId'],
          references: { schema: 'public', table: 'run_template', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
