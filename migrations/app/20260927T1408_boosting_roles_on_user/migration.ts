#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/67d60979569b1d2f02989c84f828ef338e25ef8eae9d725c3d83735634763a20/contract';
import endContract from '../../snapshots/67d60979569b1d2f02989c84f828ef338e25ef8eae9d725c3d83735634763a20/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/d79acc109f9c4760100a1e605dd78641f11076780b8850d5d682aad52eca8554/contract';
import startContract from '../../snapshots/d79acc109f9c4760100a1e605dd78641f11076780b8850d5d682aad52eca8554/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, rawSql } from '@prisma/orm-postgres/migration';

/**
 * Boosting Roles move onto User. Upgrades directly from the production schema,
 * where BoosterQualification is one row per (User, Difficulty):
 *   - ANY APPROVED row (whatever its difficulty) => User.isBooster = true,
 *     so no approved booster loses access because their approval named a difficulty;
 *   - only REVOKED rows, or no rows          => User.isBooster = false (the column default).
 * isLootbuddy has no prior authoritative source and stays at its default (false).
 * Legacy "booster_access" request history is intentionally left untouched.
 * The backfill must run after the columns exist and before the table is dropped.
 */
function backfillIsBoosterFromQualifications() {
  const approvedUsers = `SELECT DISTINCT "userId" FROM "booster_qualification" WHERE "status" = 'APPROVED'`;
  return rawSql({
    id: 'data_migration.backfill-user-is-booster-from-booster-qualification',
    label: 'Data transform: User.isBooster = true for every User with an APPROVED BoosterQualification',
    operationClass: 'data',
    target: { id: 'postgres' },
    precheck: [
      {
        description: 'Allow backfill (idempotent update)',
        sql: 'SELECT true AS ok',
        params: [],
      },
    ],
    execute: [
      {
        description: 'Mark every User with at least one APPROVED qualification as a Booster',
        sql: `UPDATE "user" SET "isBooster" = true WHERE "id" IN (${approvedUsers})`,
        params: [],
      },
    ],
    postcheck: [
      {
        description: 'Every User with an APPROVED qualification is a Booster',
        sql: `SELECT NOT EXISTS ( SELECT 1 FROM "user" WHERE "isBooster" = false AND "id" IN (${approvedUsers}) ) AS ok`,
        params: [],
      },
    ],
  });
}

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('isBooster', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('isLootbuddy', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      backfillIsBoosterFromQualifications(),
      this.dropTable({ schema: 'public', table: 'booster_qualification' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
