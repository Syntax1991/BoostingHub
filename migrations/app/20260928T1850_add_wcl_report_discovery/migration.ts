#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/37e097bda2e9e2c75d25347fc19a95d7e6e7a0d3cacbb3ce755a0cc71d5f078f/contract';
import startContract from '../../snapshots/37e097bda2e9e2c75d25347fc19a95d7e6e7a0d3cacbb3ce755a0cc71d5f078f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e9665e734556b0c551f879899a7a054a242554e39ced499f128ae400462e1368/contract';
import endContract from '../../snapshots/e9665e734556b0c551f879899a7a054a242554e39ced499f128ae400462e1368/contract.json' with { type: 'json' };
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
        table: 'discord_channel_scan_cursor',
        columns: [
          col('channelId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastMessageId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['channelId'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'warcraft_logs_report_discovery',
        columns: [
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('authorId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('channelId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastAttemptAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('lastOutcome', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('linkedRunIds', 'text', {
            notNull: true,
            default: lit('[]'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('messageId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('nextAttemptAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('postedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('reportCode', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('PENDING'),
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
            'warcraft_logs_report_discovery_status_check_2ec05a75',
            "\"status\" IN ('PENDING', 'MATCHED', 'NEEDS_REVIEW', 'IGNORED')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'warcraft_logs_report_discovery',
        constraint: 'warcraft_logs_report_discovery_channelId_messageId_reportCode_key',
        columns: ['channelId', 'messageId', 'reportCode'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'warcraft_logs_report_discovery',
        index: 'warcraft_logs_report_discovery_nextAttemptAt_idx_34b4e877',
        columns: ['nextAttemptAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
