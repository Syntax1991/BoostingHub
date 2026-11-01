#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/6bf45172add1e36a8b1f7b73f96a6ed59a18db85fa7aa3ad9414f9466e9df267/contract';
import endContract from '../../snapshots/6bf45172add1e36a8b1f7b73f96a6ed59a18db85fa7aa3ad9414f9466e9df267/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/883e1fd522f355c4012102fadb12368abc4002a6fb13e8b06ea79fc3db85aecc/contract';
import startContract from '../../snapshots/883e1fd522f355c4012102fadb12368abc4002a6fb13e8b06ea79fc3db85aecc/contract.json' with { type: 'json' };
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
        table: 'run_roster_boss_exception',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('playSignupId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('raidBossId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('rosterId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('runRaidContentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('slotSignupId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('stage', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_roster_boss_exception_role_check_e8a47be4',
            "\"role\" IN ('TANK', 'HEALER', 'MELEE_DPS', 'RANGED_DPS', 'DPS')",
          ),
          checkExpression(
            'run_roster_boss_exception_stage_check_1b5054bc',
            "\"stage\" IN ('DRAFT', 'PUBLISHED')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_roster_boss_exception',
        constraint:
          'run_roster_boss_exception_rosterId_stage_slotSignupId_runRaidContentId_raidBossId_key',
        columns: ['rosterId', 'stage', 'slotSignupId', 'runRaidContentId', 'raidBossId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_roster_boss_exception',
        index: 'run_roster_boss_exception_playSignupId_idx_d7101728',
        columns: ['playSignupId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_roster_boss_exception',
        index: 'run_roster_boss_exception_raidBossId_idx_869a61e0',
        columns: ['raidBossId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_roster_boss_exception',
        index: 'run_roster_boss_exception_rosterId_idx_ca029c6b',
        columns: ['rosterId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_roster_boss_exception',
        index: 'run_roster_boss_exception_rosterId_stage_idx_5519d655',
        columns: ['rosterId', 'stage'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_roster_boss_exception',
        index: 'run_roster_boss_exception_runRaidContentId_idx_b5f2a8be',
        columns: ['runRaidContentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_roster_boss_exception',
        index: 'run_roster_boss_exception_slotSignupId_idx_0e62234d',
        columns: ['slotSignupId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_roster_boss_exception',
        foreignKey: {
          name: 'run_roster_boss_exception_rosterId_fkey',
          columns: ['rosterId'],
          references: { schema: 'public', table: 'run_roster', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_roster_boss_exception',
        foreignKey: {
          name: 'run_roster_boss_exception_slotSignupId_fkey',
          columns: ['slotSignupId'],
          references: { schema: 'public', table: 'run_signup', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_roster_boss_exception',
        foreignKey: {
          name: 'run_roster_boss_exception_runRaidContentId_fkey',
          columns: ['runRaidContentId'],
          references: { schema: 'public', table: 'run_raid_content', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_roster_boss_exception',
        foreignKey: {
          name: 'run_roster_boss_exception_raidBossId_fkey',
          columns: ['raidBossId'],
          references: { schema: 'public', table: 'raid_boss', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_roster_boss_exception',
        foreignKey: {
          name: 'run_roster_boss_exception_playSignupId_fkey',
          columns: ['playSignupId'],
          references: { schema: 'public', table: 'run_signup', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
