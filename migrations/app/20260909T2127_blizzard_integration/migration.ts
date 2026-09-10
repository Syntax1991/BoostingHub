#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/43267012523ddbffd0ca68a1d58943053670e814e5af38a2da9e427014dbacbd/contract';
import startContract from '../../snapshots/43267012523ddbffd0ca68a1d58943053670e814e5af38a2da9e427014dbacbd/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/6feeabca45e778fead991e8b84f172094a463408f06522cc40a564bba100885a/contract';
import endContract from '../../snapshots/6feeabca45e778fead991e8b84f172094a463408f06522cc40a564bba100885a/contract.json' with { type: 'json' };
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
        table: 'battle_net_connection',
        columns: [
          col('battleNetAccountId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('battleTag', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('connectedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastSuccessfulSyncAt', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('region', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('scope', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'battle_net_connection_region_check_0ad0075e',
            "\"region\" IN ('EU', 'US')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'battle_net_import_session',
        columns: [
          col('charactersJson', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('consumedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('expiresAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('region', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'battle_net_import_session_region_check_0ad0075e',
            "\"region\" IN ('EU', 'US')",
          ),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'character',
        column: col('blizzardRealmId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'battle_net_connection',
        constraint: 'battle_net_connection_userId_region_key',
        columns: ['userId', 'region'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'character',
        constraint: 'character_region_blizzardRealmId_blizzardCharacterId_key',
        columns: ['region', 'blizzardRealmId', 'blizzardCharacterId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'battle_net_connection',
        index: 'battle_net_connection_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'battle_net_import_session',
        index: 'battle_net_import_session_expiresAt_idx_6b6b8c10',
        columns: ['expiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'battle_net_import_session',
        index: 'battle_net_import_session_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'battle_net_import_session',
        index: 'battle_net_import_session_userId_region_idx_a8f34ae4',
        columns: ['userId', 'region'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'battle_net_connection',
        foreignKey: {
          name: 'battle_net_connection_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'battle_net_import_session',
        foreignKey: {
          name: 'battle_net_import_session_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
