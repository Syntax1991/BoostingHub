#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/3169e897c3da55d7b45d8993dcb94df970eba052cb8fdf00478fbc6c962e5f79/contract';
import endContract from '../../snapshots/3169e897c3da55d7b45d8993dcb94df970eba052cb8fdf00478fbc6c962e5f79/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/d9154f982c56d940ca5cd44fa850d230c21c8cdf09024ec3105b0179d5d258b3/contract';
import startContract from '../../snapshots/d9154f982c56d940ca5cd44fa850d230c21c8cdf09024ec3105b0179d5d258b3/contract.json' with { type: 'json' };
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
        table: 'run_template',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('desiredDpsCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('desiredHealerCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('desiredTankCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('difficulty', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isActive', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('lootType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('notes', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('plannedBossCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('raidId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('raidLeadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('updatedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_template_difficulty_check_05ae26c2',
            "\"difficulty\" IN ('NORMAL', 'HEROIC', 'MYTHIC')",
          ),
          checkExpression(
            'run_template_lootType_check_3071d052',
            "\"lootType\" IN ('SAVED', 'UNSAVED', 'VIP')",
          ),
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_template',
        index: 'run_template_createdById_idx_8bf640ed',
        columns: ['createdById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_template',
        index: 'run_template_raidId_idx_996eeca9',
        columns: ['raidId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_template',
        index: 'run_template_raidLeadId_idx_e271c2cb',
        columns: ['raidLeadId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_template',
        index: 'run_template_raidLeadId_isActive_idx_584288ab',
        columns: ['raidLeadId', 'isActive'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_template',
        index: 'run_template_updatedById_idx_d0517c24',
        columns: ['updatedById'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_template',
        foreignKey: {
          name: 'run_template_raidLeadId_fkey',
          columns: ['raidLeadId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_template',
        foreignKey: {
          name: 'run_template_raidId_fkey',
          columns: ['raidId'],
          references: { schema: 'public', table: 'raid', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_template',
        foreignKey: {
          name: 'run_template_createdById_fkey',
          columns: ['createdById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_template',
        foreignKey: {
          name: 'run_template_updatedById_fkey',
          columns: ['updatedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
