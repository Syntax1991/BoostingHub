#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/b3dee35fc7b9568f86082e4e88873fd0da9334450dfe0a2fcf5570e06f5a3c8b/contract';
import endContract from '../../snapshots/b3dee35fc7b9568f86082e4e88873fd0da9334450dfe0a2fcf5570e06f5a3c8b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e98563859594fd00daa0d639f97732df3fafec261bfc8689e680decc7b02c94e/contract';
import startContract from '../../snapshots/e98563859594fd00daa0d639f97732df3fafec261bfc8689e680decc7b02c94e/contract.json' with { type: 'json' };
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
        table: 'discord_ticket_panel',
        columns: [
          col('channelId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastSignature', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('messageId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'support_ticket',
        columns: [
          col('activeKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('archiveMessageId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('channelId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('channelName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('closeLockUntil', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('closedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('closedByDiscordUserId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('closingStartedAt', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('creatorDiscordUserId', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('creatorDisplayName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('creatorUserId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('description', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('number', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('openedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('reference', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reportedBoosterLabel', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reportedDiscordUserId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('OPENING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('subject', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('transcriptFilename', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('transcriptHtml', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('transcriptMessageCount', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('transcriptTruncated', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'support_ticket_status_check_4cc10313',
            "\"status\" IN ('OPENING', 'OPEN', 'CLOSING', 'CLOSED', 'FAILED')",
          ),
          checkExpression(
            'support_ticket_type_check_1c44511b',
            "\"type\" IN ('ADMIN_SUPPORT', 'RAID_SUPPORT', 'MYTHIC_PLUS_SUPPORT', 'GENERAL_SUPPORT', 'REPORT_BOOSTER')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'support_ticket',
        constraint: 'support_ticket_number_key',
        columns: ['number'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'support_ticket',
        constraint: 'support_ticket_activeKey_key',
        columns: ['activeKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'support_ticket',
        constraint: 'support_ticket_channelId_key',
        columns: ['channelId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_ticket',
        index: 'support_ticket_creatorDiscordUserId_idx_f59d8d30',
        columns: ['creatorDiscordUserId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_ticket',
        index: 'support_ticket_creatorUserId_idx_da5f686b',
        columns: ['creatorUserId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_ticket',
        index: 'support_ticket_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'support_ticket',
        foreignKey: {
          name: 'support_ticket_creatorUserId_fkey',
          columns: ['creatorUserId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
