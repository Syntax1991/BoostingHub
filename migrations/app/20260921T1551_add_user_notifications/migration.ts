#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/b6965eeecc4b50ec21177d6973308846f7983e8541be35e450884652b309828c/contract';
import endContract from '../../snapshots/b6965eeecc4b50ec21177d6973308846f7983e8541be35e450884652b309828c/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e13eedd1751f2a8f28c4322ddbeacbdf97eaa74ee6f99ab1e1d7ab487fd7dedd/contract';
import startContract from '../../snapshots/e13eedd1751f2a8f28c4322ddbeacbdf97eaa74ee6f99ab1e1d7ab487fd7dedd/contract.json' with { type: 'json' };
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
        table: 'user_notification',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('discordDeliveryStatus', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('discordUserId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('href', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('message', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('readAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('runId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('signupId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sourceKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'user_notification_discordDeliveryStatus_check_2752241d',
            "\"discordDeliveryStatus\" IN ('PENDING', 'SENT', 'SKIPPED', 'FAILED_PERMANENT')",
          ),
          checkExpression(
            'user_notification_type_check_1b0a5b12',
            "\"type\" IN ('ROSTER_SELECTED', 'RAID_INVITE')",
          ),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('dmRaidInviteEnabled', 'bool', {
          notNull: true,
          default: lit(true),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('dmRosterSelectedEnabled', 'bool', {
          notNull: true,
          default: lit(true),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'user_notification',
        constraint: 'user_notification_sourceKey_key',
        columns: ['sourceKey'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'user_notification',
        index: 'user_notification_discordDeliveryStatus_idx_bc6e068f',
        columns: ['discordDeliveryStatus'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'user_notification',
        index: 'user_notification_runId_idx_a6016437',
        columns: ['runId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'user_notification',
        index: 'user_notification_signupId_idx_acdbc7f1',
        columns: ['signupId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'user_notification',
        index: 'user_notification_userId_createdAt_idx_f726f04a',
        columns: ['userId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'user_notification',
        index: 'user_notification_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'user_notification',
        index: 'user_notification_userId_readAt_idx_8bd92969',
        columns: ['userId', 'readAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'user_notification',
        foreignKey: {
          name: 'user_notification_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'user_notification',
        foreignKey: {
          name: 'user_notification_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'run', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'user_notification',
        foreignKey: {
          name: 'user_notification_signupId_fkey',
          columns: ['signupId'],
          references: { schema: 'public', table: 'run_signup', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
