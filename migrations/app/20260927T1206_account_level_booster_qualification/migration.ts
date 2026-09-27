#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/6f9b9e6221938aaf72c3b12d03680c371ec3178caa7a6e2cd296cb7b73e0ea74/contract';
import endContract from '../../snapshots/6f9b9e6221938aaf72c3b12d03680c371ec3178caa7a6e2cd296cb7b73e0ea74/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/d79acc109f9c4760100a1e605dd78641f11076780b8850d5d682aad52eca8554/contract';
import startContract from '../../snapshots/d79acc109f9c4760100a1e605dd78641f11076780b8850d5d682aad52eca8554/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/migration';

/**
 * Booster qualification becomes account-level (one row per User, no difficulty).
 * Collapse the old User + Difficulty rows to exactly one row per User BEFORE the
 * (userId) unique constraint is added:
 *   - any APPROVED row  => the kept row is APPROVED (the most recently granted one),
 *     so no approved booster loses access because their approval named a difficulty;
 *   - only REVOKED rows => the kept row is the most recently revoked one (still REVOKED).
 * Legacy "booster_access" request history is intentionally left untouched.
 */
function collapseQualificationsToOnePerUser() {
  const keeperIds = `SELECT DISTINCT ON ("userId") "id" FROM "booster_qualification" ORDER BY "userId", ("status" = 'APPROVED') DESC, COALESCE("revokedAt", "grantedAt", "updatedAt") DESC NULLS LAST, "updatedAt" DESC, "id"`;
  return rawSql({
    id: 'data_migration.collapse-booster-qualification-to-account-level',
    label: 'Data transform: collapse BoosterQualification to one row per User (APPROVED wins)',
    operationClass: 'data',
    target: { id: 'postgres' },
    precheck: [
      {
        description: 'Allow collapse (idempotent delete)',
        sql: 'SELECT true AS ok',
        params: [],
      },
    ],
    execute: [
      {
        description: 'Delete every qualification row except the per-User keeper',
        sql: `DELETE FROM "booster_qualification" WHERE "id" NOT IN (${keeperIds})`,
        params: [],
      },
    ],
    postcheck: [
      {
        description: 'At most one qualification row per User',
        sql: `SELECT NOT EXISTS ( SELECT 1 FROM "booster_qualification" GROUP BY "userId" HAVING count(*) > 1 ) AS ok`,
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
      collapseQualificationsToOnePerUser(),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'booster_qualification',
        constraint: 'booster_qualification_difficulty_check_05ae26c2',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'booster_qualification',
        index: 'booster_qualification_difficulty_idx_ab7b4a75',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'booster_qualification',
        index: 'booster_qualification_userId_idx_a489d58a',
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'booster_qualification',
        constraint: 'booster_qualification_userId_difficulty_key',
      }),
      this.dropColumn({ schema: 'public', table: 'booster_qualification', column: 'difficulty' }),
      this.addUnique({
        schema: 'public',
        table: 'booster_qualification',
        constraint: 'booster_qualification_userId_key',
        columns: ['userId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
