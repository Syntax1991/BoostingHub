#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/58e51ab35e4c9bc152038e5988e98923118ffedbca70c6b767e03d93e9b34c7f/contract';
import startContract from '../../snapshots/58e51ab35e4c9bc152038e5988e98923118ffedbca70c6b767e03d93e9b34c7f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/85e46eb0f05ccd857478f0cec7abbe7b66e9933c5dccd7ab0a876f3c4abaf607/contract';
import endContract from '../../snapshots/85e46eb0f05ccd857478f0cec7abbe7b66e9933c5dccd7ab0a876f3c4abaf607/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'run_discord_announcement',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('difficulty', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lootType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('previousScheduledStartAt', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('productLabel', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('runId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('scheduledStartAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('sentAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('sourceKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_discord_announcement_difficulty_check_05ae26c2',
            "\"difficulty\" IN ('NORMAL', 'HEROIC', 'MYTHIC')",
          ),
          checkExpression(
            'run_discord_announcement_lootType_check_3071d052',
            "\"lootType\" IN ('SAVED', 'UNSAVED', 'VIP')",
          ),
          checkExpression(
            'run_discord_announcement_status_check_86966e08',
            "\"status\" IN ('PENDING', 'SENT', 'SKIPPED', 'FAILED_PERMANENT')",
          ),
          checkExpression(
            'run_discord_announcement_type_check_b8186a62',
            "\"type\" IN ('RUN_RESCHEDULED', 'RUN_CANCELLED')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_discord_announcement',
        constraint: 'run_discord_announcement_sourceKey_key',
        columns: ['sourceKey'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_discord_announcement',
        index: 'run_discord_announcement_runId_createdAt_idx_7a7455cf',
        columns: ['runId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_discord_announcement',
        index: 'run_discord_announcement_runId_idx_a6016437',
        columns: ['runId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_discord_announcement',
        index: 'run_discord_announcement_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_discord_announcement',
        foreignKey: {
          name: 'run_discord_announcement_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'run', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
