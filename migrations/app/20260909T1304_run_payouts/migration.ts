#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0e77d9eabd5bec25d2e415654967a9e360018316db7464e9656e8674a1ff4454/contract';
import startContract from '../../snapshots/0e77d9eabd5bec25d2e415654967a9e360018316db7464e9656e8674a1ff4454/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/43267012523ddbffd0ca68a1d58943053670e814e5af38a2da9e427014dbacbd/contract';
import endContract from '../../snapshots/43267012523ddbffd0ca68a1d58943053670e814e5af38a2da9e427014dbacbd/contract.json' with { type: 'json' };
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
        table: 'run_payout_entry',
        columns: [
          col('adjustmentReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('amountGold', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('attendanceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('attendanceStatus', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('characterId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('characterName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('characterRealm', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('characterRegion', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isBackup', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('participationType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('rosterEntryId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('settlementId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('shareUnits', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('signupId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userDisplayName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_payout_entry_attendanceStatus_check_bee4e5d2',
            "\"attendanceStatus\" IN ('UNMARKED', 'PRESENT', 'LATE', 'LEFT_EARLY', 'NO_SHOW', 'EXCUSED', 'STANDBY')",
          ),
          checkExpression(
            'run_payout_entry_characterRegion_check_4f6701ca',
            "\"characterRegion\" IN ('EU', 'US')",
          ),
          checkExpression(
            'run_payout_entry_participationType_check_c88ba3d2',
            "\"participationType\" IN ('BOOSTER', 'LOOTBUDDY')",
          ),
          checkExpression(
            'run_payout_entry_role_check_b1616ae6',
            "\"role\" IN ('TANK', 'HEALER', 'DPS')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'run_settlement',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('difficulty', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('finalizedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('finalizedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('paidAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('paidById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('preparedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('raidLeadName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('raidName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('runId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('runTitle', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('DRAFT'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('totalGold', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_settlement_difficulty_check_05ae26c2',
            "\"difficulty\" IN ('NORMAL', 'HEROIC', 'MYTHIC')",
          ),
          checkExpression(
            'run_settlement_status_check_54af39d0',
            "\"status\" IN ('DRAFT', 'FINALIZED', 'PAID')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_payout_entry',
        constraint: 'run_payout_entry_attendanceId_key',
        columns: ['attendanceId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_settlement',
        constraint: 'run_settlement_runId_key',
        columns: ['runId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_payout_entry',
        index: 'run_payout_entry_characterId_idx_2423fe9d',
        columns: ['characterId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_payout_entry',
        index: 'run_payout_entry_rosterEntryId_idx_06788738',
        columns: ['rosterEntryId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_payout_entry',
        index: 'run_payout_entry_settlementId_idx_427ee326',
        columns: ['settlementId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_payout_entry',
        index: 'run_payout_entry_signupId_idx_acdbc7f1',
        columns: ['signupId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_payout_entry',
        index: 'run_payout_entry_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_settlement',
        index: 'run_settlement_finalizedById_idx_7e97fe52',
        columns: ['finalizedById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_settlement',
        index: 'run_settlement_paidById_idx_406e50ef',
        columns: ['paidById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_settlement',
        index: 'run_settlement_preparedById_idx_1dcf84f2',
        columns: ['preparedById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_settlement',
        index: 'run_settlement_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_payout_entry',
        foreignKey: {
          name: 'run_payout_entry_settlementId_fkey',
          columns: ['settlementId'],
          references: { schema: 'public', table: 'run_settlement', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_payout_entry',
        foreignKey: {
          name: 'run_payout_entry_attendanceId_fkey',
          columns: ['attendanceId'],
          references: { schema: 'public', table: 'run_attendance', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_payout_entry',
        foreignKey: {
          name: 'run_payout_entry_rosterEntryId_fkey',
          columns: ['rosterEntryId'],
          references: { schema: 'public', table: 'run_roster_entry', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_payout_entry',
        foreignKey: {
          name: 'run_payout_entry_signupId_fkey',
          columns: ['signupId'],
          references: { schema: 'public', table: 'run_signup', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_payout_entry',
        foreignKey: {
          name: 'run_payout_entry_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_payout_entry',
        foreignKey: {
          name: 'run_payout_entry_characterId_fkey',
          columns: ['characterId'],
          references: { schema: 'public', table: 'character', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_settlement',
        foreignKey: {
          name: 'run_settlement_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'run', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_settlement',
        foreignKey: {
          name: 'run_settlement_preparedById_fkey',
          columns: ['preparedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_settlement',
        foreignKey: {
          name: 'run_settlement_finalizedById_fkey',
          columns: ['finalizedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_settlement',
        foreignKey: {
          name: 'run_settlement_paidById_fkey',
          columns: ['paidById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
