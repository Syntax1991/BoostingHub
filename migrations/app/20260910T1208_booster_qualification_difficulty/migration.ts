#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/6feeabca45e778fead991e8b84f172094a463408f06522cc40a564bba100885a/contract';
import startContract from '../../snapshots/6feeabca45e778fead991e8b84f172094a463408f06522cc40a564bba100885a/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/99195123b1ac9414e49fb31343a888dcb59fb8e1b9f6dca72d2a03785f3c0220/contract';
import endContract from '../../snapshots/99195123b1ac9414e49fb31343a888dcb59fb8e1b9f6dca72d2a03785f3c0220/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  primaryKey,
  rawSql,
} from '@prisma/orm-postgres/migration';

function backfillQualificationsFromApprovedLegacy() {
  return rawSql({
    id: 'data_migration.backfill-booster-qualification-from-approved-access',
    label: 'Data transform: backfill BoosterQualification from APPROVED BoosterAccess',
    operationClass: 'data',
    target: { id: 'postgres' },
    precheck: [
      {
        description: 'Allow backfill (idempotent insert)',
        sql: 'SELECT true AS ok',
        params: [],
      },
    ],
    execute: [
      {
        description: 'Insert one APPROVED qualification per user + difficulty',
        sql: `INSERT INTO "booster_qualification" ("id", "userId", "difficulty", "status", "grantedAt", "grantedById", "notes", "createdAt", "updatedAt") SELECT gen_random_uuid()::text, src."userId", src."difficulty", 'APPROVED', src."grantedAt", src."grantedById", src."notes", now(), now() FROM ( SELECT DISTINCT ON ("userId", "difficulty") "userId", "difficulty", COALESCE("approvedAt", "reviewedAt", "createdAt") AS "grantedAt", COALESCE("approvedById", "reviewedById") AS "grantedById", "notes" FROM "booster_access" WHERE "status" = 'APPROVED' ORDER BY "userId", "difficulty", COALESCE("approvedAt", "reviewedAt", "createdAt") DESC NULLS LAST, "updatedAt" DESC ) src WHERE NOT EXISTS ( SELECT 1 FROM "booster_qualification" q WHERE q."userId" = src."userId" AND q."difficulty" = src."difficulty" )`,
        params: [],
      },
    ],
    postcheck: [
      {
        description: 'Every APPROVED legacy user+difficulty has a qualification',
        sql: `SELECT NOT EXISTS ( SELECT 1 FROM "booster_access" ba WHERE ba."status" = 'APPROVED' AND NOT EXISTS ( SELECT 1 FROM "booster_qualification" q WHERE q."userId" = ba."userId" AND q."difficulty" = ba."difficulty" ) ) AS ok`,
        params: [],
      },
    ],
  });
}

function resolvePendingLegacySatisfiedByQualification() {
  return rawSql({
    id: 'data_migration.resolve-pending-legacy-satisfied-by-qualification',
    label: 'Data transform: resolve PENDING BoosterAccess covered by qualification',
    operationClass: 'data',
    target: { id: 'postgres' },
    precheck: [
      {
        description: 'Allow sibling resolution (idempotent update)',
        sql: 'SELECT true AS ok',
        params: [],
      },
    ],
    execute: [
      {
        description: 'Mark covered PENDING legacy rows APPROVED',
        sql: `UPDATE "booster_access" AS ba SET "status" = 'APPROVED', "approvedAt" = COALESCE(ba."approvedAt", q."grantedAt", now()), "approvedById" = COALESCE(ba."approvedById", q."grantedById"), "reviewedAt" = COALESCE(ba."reviewedAt", now()), "reviewedById" = COALESCE(ba."reviewedById", q."grantedById"), "notes" = COALESCE(ba."notes", 'Resolved: account already qualified for this difficulty.'), "updatedAt" = now() FROM "booster_qualification" AS q WHERE ba."status" = 'PENDING' AND ba."userId" = q."userId" AND ba."difficulty" = q."difficulty" AND q."status" = 'APPROVED'`,
        params: [],
      },
    ],
    postcheck: [
      {
        description: 'No PENDING legacy remains for APPROVED qualifications',
        sql: `SELECT NOT EXISTS ( SELECT 1 FROM "booster_access" ba INNER JOIN "booster_qualification" q ON q."userId" = ba."userId" AND q."difficulty" = ba."difficulty" AND q."status" = 'APPROVED' WHERE ba."status" = 'PENDING' ) AS ok`,
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
      this.createTable({
        schema: 'public',
        table: 'booster_qualification',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('difficulty', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('grantedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('grantedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('notes', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('revokedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('revokedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'booster_qualification_difficulty_check_05ae26c2',
            "\"difficulty\" IN ('NORMAL', 'HEROIC', 'MYTHIC')",
          ),
          checkExpression(
            'booster_qualification_status_check_c670181c',
            "\"status\" IN ('APPROVED', 'REVOKED')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'booster_qualification',
        constraint: 'booster_qualification_userId_difficulty_key',
        columns: ['userId', 'difficulty'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'booster_qualification',
        index: 'booster_qualification_difficulty_idx_ab7b4a75',
        columns: ['difficulty'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'booster_qualification',
        index: 'booster_qualification_grantedById_idx_416f9b2b',
        columns: ['grantedById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'booster_qualification',
        index: 'booster_qualification_revokedById_idx_ab374353',
        columns: ['revokedById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'booster_qualification',
        index: 'booster_qualification_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'booster_qualification',
        index: 'booster_qualification_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'booster_qualification',
        foreignKey: {
          name: 'booster_qualification_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'booster_qualification',
        foreignKey: {
          name: 'booster_qualification_grantedById_fkey',
          columns: ['grantedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'booster_qualification',
        foreignKey: {
          name: 'booster_qualification_revokedById_fkey',
          columns: ['revokedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      backfillQualificationsFromApprovedLegacy(),
      resolvePendingLegacySatisfiedByQualification(),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
