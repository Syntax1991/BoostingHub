#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/85ba44364f9fa3d98e2cce5fb06cc0653843e3db62bfb6317df792ab14749c1f/contract';
import startContract from '../../snapshots/85ba44364f9fa3d98e2cce5fb06cc0653843e3db62bfb6317df792ab14749c1f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c85b5ac147fb990a2a877fac6346c50336afdd8cee55b49c12996d6bd1834e6e/contract';
import endContract from '../../snapshots/c85b5ac147fb990a2a877fac6346c50336afdd8cee55b49c12996d6bd1834e6e/contract.json' with { type: 'json' };
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
        table: 'run_external_booster',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('rosterId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('wowClass', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_external_booster_role_check_b1616ae6',
            "\"role\" IN ('TANK', 'HEALER', 'DPS')",
          ),
          checkExpression(
            'run_external_booster_wowClass_check_8876c2a5',
            "\"wowClass\" IN ('DEATH_KNIGHT', 'DEMON_HUNTER', 'DRUID', 'EVOKER', 'HUNTER', 'MAGE', 'MONK', 'PALADIN', 'PRIEST', 'ROGUE', 'SHAMAN', 'WARLOCK', 'WARRIOR')",
          ),
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_external_booster',
        index: 'run_external_booster_rosterId_idx_ca029c6b',
        columns: ['rosterId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_external_booster',
        foreignKey: {
          name: 'run_external_booster_rosterId_fkey',
          columns: ['rosterId'],
          references: { schema: 'public', table: 'run_roster', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
