#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1d08d80fbd5ce83fe93bf007eeab4ec19d84d96384d552390a68d1d917f15ded/contract';
import startContract from '../../snapshots/1d08d80fbd5ce83fe93bf007eeab4ec19d84d96384d552390a68d1d917f15ded/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/5244433c3c7cf58977b92bcb2c3d44ae1260d60893053c632bd6f0ca47e055eb/contract';
import endContract from '../../snapshots/5244433c3c7cf58977b92bcb2c3d44ae1260d60893053c632bd6f0ca47e055eb/contract.json' with { type: 'json' };
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
        table: 'run_roster',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('publishedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('publishedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('runId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('state', 'text', {
            notNull: true,
            default: lit('DRAFT'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('version', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('run_roster_state_check_af9774b1', "\"state\" IN ('DRAFT', 'PUBLISHED')"),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'run_roster_entry',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('rosterId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('selected', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('signupId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_roster',
        constraint: 'run_roster_runId_key',
        columns: ['runId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_roster_entry',
        constraint: 'run_roster_entry_rosterId_signupId_key',
        columns: ['rosterId', 'signupId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_roster',
        index: 'run_roster_publishedById_idx_ffaf4a1d',
        columns: ['publishedById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_roster_entry',
        index: 'run_roster_entry_rosterId_idx_ca029c6b',
        columns: ['rosterId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_roster_entry',
        index: 'run_roster_entry_signupId_idx_acdbc7f1',
        columns: ['signupId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_roster',
        foreignKey: {
          name: 'run_roster_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'run', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_roster',
        foreignKey: {
          name: 'run_roster_publishedById_fkey',
          columns: ['publishedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_roster_entry',
        foreignKey: {
          name: 'run_roster_entry_rosterId_fkey',
          columns: ['rosterId'],
          references: { schema: 'public', table: 'run_roster', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_roster_entry',
        foreignKey: {
          name: 'run_roster_entry_signupId_fkey',
          columns: ['signupId'],
          references: { schema: 'public', table: 'run_signup', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
