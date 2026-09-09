#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0e77d9eabd5bec25d2e415654967a9e360018316db7464e9656e8674a1ff4454/contract';
import endContract from '../../snapshots/0e77d9eabd5bec25d2e415654967a9e360018316db7464e9656e8674a1ff4454/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/dd1bc61818d0b4aeb417568d27fa6091417e19ea8d2525f6119a578233d3a0c1/contract';
import startContract from '../../snapshots/dd1bc61818d0b4aeb417568d27fa6091417e19ea8d2525f6119a578233d3a0c1/contract.json' with { type: 'json' };
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
        table: 'run_attendance',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('markedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('markedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('rosterEntryId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('runId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('UNMARKED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_attendance_status_check_71e1f65a',
            "\"status\" IN ('UNMARKED', 'PRESENT', 'LATE', 'LEFT_EARLY', 'NO_SHOW', 'EXCUSED', 'STANDBY')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_attendance',
        constraint: 'run_attendance_rosterEntryId_key',
        columns: ['rosterEntryId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_attendance',
        index: 'run_attendance_markedById_idx_114ec907',
        columns: ['markedById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_attendance',
        index: 'run_attendance_runId_idx_a6016437',
        columns: ['runId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_attendance',
        index: 'run_attendance_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_attendance',
        foreignKey: {
          name: 'run_attendance_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'run', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_attendance',
        foreignKey: {
          name: 'run_attendance_rosterEntryId_fkey',
          columns: ['rosterEntryId'],
          references: { schema: 'public', table: 'run_roster_entry', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_attendance',
        foreignKey: {
          name: 'run_attendance_markedById_fkey',
          columns: ['markedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
