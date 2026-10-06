#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/c61d6c9debd1aa276ddf258e7f0c7e6329fddb1af0a9b20ab2e52c05e51d9688/contract';
import startContract from '../../snapshots/c61d6c9debd1aa276ddf258e7f0c7e6329fddb1af0a9b20ab2e52c05e51d9688/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f5dd86968081fec0634a500b3fedabddb6d9517174a2691ff86edbcb7dadb564/contract';
import endContract from '../../snapshots/f5dd86968081fec0634a500b3fedabddb6d9517174a2691ff86edbcb7dadb564/contract.json' with { type: 'json' };
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
        table: 'community_schedule_slot',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isActive', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('localStartTime', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('notes', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('raidLeadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('updatedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('weekday', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'community_schedule_slot_weekday_check_fe15739f',
            "\"weekday\" IN ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'community_schedule_slot',
        constraint: 'community_schedule_slot_raidLeadId_weekday_localStartTime_key',
        columns: ['raidLeadId', 'weekday', 'localStartTime'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'community_schedule_slot',
        index: 'community_schedule_slot_createdById_idx_8bf640ed',
        columns: ['createdById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'community_schedule_slot',
        index: 'community_schedule_slot_raidLeadId_idx_e271c2cb',
        columns: ['raidLeadId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'community_schedule_slot',
        index: 'community_schedule_slot_updatedById_idx_d0517c24',
        columns: ['updatedById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'community_schedule_slot',
        index: 'css_active_day_time_43398fd0',
        columns: ['isActive', 'weekday', 'localStartTime'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'community_schedule_slot',
        index: 'css_lead_active_584288ab',
        columns: ['raidLeadId', 'isActive'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'community_schedule_slot',
        foreignKey: {
          name: 'community_schedule_slot_raidLeadId_fkey',
          columns: ['raidLeadId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'community_schedule_slot',
        foreignKey: {
          name: 'community_schedule_slot_createdById_fkey',
          columns: ['createdById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'community_schedule_slot',
        foreignKey: {
          name: 'community_schedule_slot_updatedById_fkey',
          columns: ['updatedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
