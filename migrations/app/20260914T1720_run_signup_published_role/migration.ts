#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1d845e0a9988c3cc7fa105ee1c5d78e15260f9a99e314b008ab6114152b1bda4/contract';
import startContract from '../../snapshots/1d845e0a9988c3cc7fa105ee1c5d78e15260f9a99e314b008ab6114152b1bda4/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ef31069df7e990253bb121096193155ce91c322f9c4da10a3b400c9ece4fe9ed/contract';
import endContract from '../../snapshots/ef31069df7e990253bb121096193155ce91c322f9c4da10a3b400c9ece4fe9ed/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, rawSql } from '@prisma/orm-postgres/migration';

/**
 * Snapshot published booster roles onto RunSignup.publishedRole.
 *
 * Prefer the selected draft entry's selectedRole (what was saved when the
 * roster was published). If that is missing, fall back only when the offer
 * has exactly one volunteered role — never guess for multi-role rows.
 */
function backfillPublishedRoleFromSelectedDraft() {
  return rawSql({
    id: 'data_migration.backfill-run-signup-published-role',
    label: 'Data transform: backfill RunSignup.publishedRole from selected draft / sole offer',
    operationClass: 'data',
    target: { id: 'postgres' },
    precheck: [
      {
        description: 'Allow publishedRole backfill (idempotent update)',
        sql: 'SELECT true AS ok',
        params: [],
      },
    ],
    execute: [
      {
        description: 'Copy selected RunRosterEntry.selectedRole onto SELECTED BOOSTER signups',
        sql: `UPDATE "run_signup" AS s
SET "publishedRole" = e."selectedRole",
    "updatedAt" = now()
FROM "run_roster_entry" AS e
WHERE e."signupId" = s."id"
  AND e."selected" = true
  AND s."status" = 'SELECTED'
  AND s."participationType" = 'BOOSTER'
  AND e."selectedRole" IS NOT NULL
  AND s."publishedRole" IS NULL`,
        params: [],
      },
      {
        description: 'Infer publishedRole from a sole offered role when no selectedRole exists',
        sql: `UPDATE "run_signup" AS s
SET "publishedRole" = sole."role",
    "updatedAt" = now()
FROM (
  SELECT r."signupId", MIN(r."role") AS "role"
  FROM "run_signup_role" r
  GROUP BY r."signupId"
  HAVING COUNT(*) = 1
) AS sole
WHERE sole."signupId" = s."id"
  AND s."status" = 'SELECTED'
  AND s."participationType" = 'BOOSTER'
  AND s."publishedRole" IS NULL`,
        params: [],
      },
    ],
    postcheck: [
      {
        description:
          'Every SELECTED BOOSTER with a resolvable role has publishedRole (selectedRole or sole offer)',
        sql: `SELECT NOT EXISTS (
  SELECT 1
  FROM "run_signup" s
  WHERE s."status" = 'SELECTED'
    AND s."participationType" = 'BOOSTER'
    AND s."publishedRole" IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM "run_roster_entry" e
        WHERE e."signupId" = s."id"
          AND e."selected" = true
          AND e."selectedRole" IS NOT NULL
      )
      OR (
        SELECT COUNT(*) FROM "run_signup_role" r WHERE r."signupId" = s."id"
      ) = 1
    )
) AS ok`,
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
        table: 'run_signup',
        column: col('publishedRole', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_signup',
        constraint: 'run_signup_publishedRole_check_17f7e8a4',
        expression: "\"publishedRole\" IN ('TANK', 'HEALER', 'DPS')",
      }),
      backfillPublishedRoleFromSelectedDraft(),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
