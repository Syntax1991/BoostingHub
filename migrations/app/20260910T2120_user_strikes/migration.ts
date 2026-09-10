#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5205d5a2344e04022a37bb44f384e025878e28c0d7e91be9ecfc9032a2bf12aa/contract';
import endContract from '../../snapshots/5205d5a2344e04022a37bb44f384e025878e28c0d7e91be9ecfc9032a2bf12aa/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/d177d99e5ee7ef8c389335cfff0f322b34d28e753c2fd2afef5fad4ddc88657f/contract';
import startContract from '../../snapshots/d177d99e5ee7ef8c389335cfff0f322b34d28e753c2fd2afef5fad4ddc88657f/contract.json' with { type: 'json' };
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
        table: 'strike',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('notes', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('revokedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('revokedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('revokedReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('runId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('ACTIVE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('strike_status_check_35f03e2c', "\"status\" IN ('ACTIVE', 'REVOKED')"),
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'strike',
        index: 'strike_createdById_idx_8bf640ed',
        columns: ['createdById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'strike',
        index: 'strike_revokedById_idx_ab374353',
        columns: ['revokedById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'strike',
        index: 'strike_runId_idx_a6016437',
        columns: ['runId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'strike',
        index: 'strike_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'strike',
        foreignKey: {
          name: 'strike_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'strike',
        foreignKey: {
          name: 'strike_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'run', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'strike',
        foreignKey: {
          name: 'strike_createdById_fkey',
          columns: ['createdById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'strike',
        foreignKey: {
          name: 'strike_revokedById_fkey',
          columns: ['revokedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
