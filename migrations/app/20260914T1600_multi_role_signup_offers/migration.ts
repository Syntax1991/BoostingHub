#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1d845e0a9988c3cc7fa105ee1c5d78e15260f9a99e314b008ab6114152b1bda4/contract';
import endContract from '../../snapshots/1d845e0a9988c3cc7fa105ee1c5d78e15260f9a99e314b008ab6114152b1bda4/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/60c56dbcad0eaa2dc5cc7234e8a78e3df3cf3abbe41bd3c63f92b3e978279fa4/contract';
import startContract from '../../snapshots/60c56dbcad0eaa2dc5cc7234e8a78e3df3cf3abbe41bd3c63f92b3e978279fa4/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  primaryKey,
  rawSql,
} from '@prisma/orm-postgres/migration';

/**
 * Copy each legacy BOOSTER RunSignup.role into RunSignupRole before the column
 * is dropped. Lootbuddy rows (role null) are skipped intentionally.
 */
function backfillOfferedRolesFromLegacySignupRole() {
  return rawSql({
    id: 'data_migration.backfill-run-signup-role-from-legacy',
    label: 'Data transform: backfill RunSignupRole from RunSignup.role',
    operationClass: 'data',
    target: { id: 'postgres' },
    precheck: [
      {
        description: 'Allow offered-role backfill (idempotent insert)',
        sql: 'SELECT true AS ok',
        params: [],
      },
    ],
    execute: [
      {
        description: 'Insert one RunSignupRole per legacy BOOSTER role',
        sql: `INSERT INTO "run_signup_role" ("id", "signupId", "role", "createdAt")
SELECT gen_random_uuid()::text, s."id", s."role", now()
FROM "run_signup" s
WHERE s."participationType" = 'BOOSTER'
  AND s."role" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "run_signup_role" r
    WHERE r."signupId" = s."id" AND r."role" = s."role"
  )`,
        params: [],
      },
    ],
    postcheck: [
      {
        description: 'Every BOOSTER with a legacy role has a RunSignupRole row',
        sql: `SELECT NOT EXISTS (
  SELECT 1 FROM "run_signup" s
  WHERE s."participationType" = 'BOOSTER'
    AND s."role" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "run_signup_role" r
      WHERE r."signupId" = s."id" AND r."role" = s."role"
    )
) AS ok`,
        params: [],
      },
    ],
  });
}

/**
 * Selected BOOSTER roster entries inherit the legacy signup role as selectedRole.
 * LOOTBUDDY entries stay null.
 */
function backfillSelectedRoleFromLegacySignupRole() {
  return rawSql({
    id: 'data_migration.backfill-roster-selected-role-from-legacy',
    label: 'Data transform: backfill RunRosterEntry.selectedRole from RunSignup.role',
    operationClass: 'data',
    target: { id: 'postgres' },
    precheck: [
      {
        description: 'Allow selectedRole backfill (idempotent update)',
        sql: 'SELECT true AS ok',
        params: [],
      },
    ],
    execute: [
      {
        description: 'Copy legacy BOOSTER role onto selected roster entries',
        sql: `UPDATE "run_roster_entry" AS e
SET "selectedRole" = s."role",
    "updatedAt" = now()
FROM "run_signup" AS s
WHERE e."signupId" = s."id"
  AND e."selected" = true
  AND s."participationType" = 'BOOSTER'
  AND s."role" IS NOT NULL
  AND e."selectedRole" IS NULL`,
        params: [],
      },
    ],
    postcheck: [
      {
        description: 'Every selected BOOSTER entry with a legacy role has selectedRole',
        sql: `SELECT NOT EXISTS (
  SELECT 1
  FROM "run_roster_entry" e
  INNER JOIN "run_signup" s ON s."id" = e."signupId"
  WHERE e."selected" = true
    AND s."participationType" = 'BOOSTER'
    AND s."role" IS NOT NULL
    AND e."selectedRole" IS NULL
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
      // Additive first so backfills can read legacy RunSignup.role.
      this.createTable({
        schema: 'public',
        table: 'run_signup_role',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('signupId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_signup_role_role_check_b1616ae6',
            "\"role\" IN ('TANK', 'HEALER', 'DPS')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_signup_role',
        constraint: 'run_signup_role_signupId_role_key',
        columns: ['signupId', 'role'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_signup_role',
        index: 'run_signup_role_signupId_idx_acdbc7f1',
        columns: ['signupId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_signup_role',
        foreignKey: {
          name: 'run_signup_role_signupId_fkey',
          columns: ['signupId'],
          references: { schema: 'public', table: 'run_signup', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_roster_entry',
        column: col('selectedRole', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_roster_entry',
        constraint: 'run_roster_entry_selectedRole_check_e659d19f',
        expression: "\"selectedRole\" IN ('TANK', 'HEALER', 'DPS')",
      }),
      backfillOfferedRolesFromLegacySignupRole(),
      backfillSelectedRoleFromLegacySignupRole(),
      // Destructive only after backfill.
      this.dropCheckConstraint({
        schema: 'public',
        table: 'run_signup',
        constraint: 'run_signup_role_check_b1616ae6',
      }),
      this.dropColumn({ schema: 'public', table: 'run_signup', column: 'role' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
