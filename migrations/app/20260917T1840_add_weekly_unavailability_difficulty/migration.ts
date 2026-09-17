#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/740029d3e7be9cc73d969cdebeac876082ab92e038a773dff561334fb95b08bc/contract';
import startContract from '../../snapshots/740029d3e7be9cc73d969cdebeac876082ab92e038a773dff561334fb95b08bc/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d80ac736e580edd515c8b300c2b6e6342ad510b70becf65871e06c68c45a7325/contract';
import endContract from '../../snapshots/d80ac736e580edd515c8b300c2b6e6342ad510b70becf65871e06c68c45a7325/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, rawSql } from '@prisma/orm-postgres/migration';

/**
 * Old whole-reset unavailability (no difficulty) means unavailable for every
 * supported difficulty. Expand each legacy null-difficulty row into
 * NORMAL + HEROIC + MYTHIC before the column becomes NOT NULL.
 */
function expandLegacyWeeklyUnavailabilityToDifficulties() {
  return rawSql({
    id: 'data_migration.expand-character-weekly-unavailability-difficulties',
    label:
      'Data transform: expand legacy weekly unavailability rows to NORMAL+HEROIC+MYTHIC',
    operationClass: 'data',
    target: { id: 'postgres' },
    precheck: [
      {
        description: 'Allow expand when null-difficulty rows remain (or already expanded)',
        sql: 'SELECT true AS ok',
        params: [],
      },
    ],
    execute: [
      {
        description:
          'Promote null-difficulty rows to NORMAL and insert missing HEROIC/MYTHIC siblings',
        sql: `WITH to_expand AS (
  SELECT "id", "characterId", "resetIdentifier", "createdAt", "updatedAt"
  FROM "character_weekly_unavailability"
  WHERE "difficulty" IS NULL
),
updated AS (
  UPDATE "character_weekly_unavailability" AS c
  SET "difficulty" = 'NORMAL'
  FROM to_expand AS t
  WHERE c."id" = t."id"
  RETURNING c."characterId", c."resetIdentifier", c."createdAt", c."updatedAt"
)
INSERT INTO "character_weekly_unavailability" (
  "id", "characterId", "resetIdentifier", "difficulty", "createdAt", "updatedAt"
)
SELECT gen_random_uuid()::text,
       u."characterId",
       u."resetIdentifier",
       d."difficulty",
       u."createdAt",
       u."updatedAt"
FROM updated AS u
CROSS JOIN (VALUES ('HEROIC'), ('MYTHIC')) AS d("difficulty")
WHERE NOT EXISTS (
  SELECT 1
  FROM "character_weekly_unavailability" AS x
  WHERE x."characterId" = u."characterId"
    AND x."resetIdentifier" = u."resetIdentifier"
    AND x."difficulty" = d."difficulty"
)`,
        params: [],
      },
    ],
    postcheck: [
      {
        description: 'No null-difficulty weekly unavailability rows remain',
        sql: `SELECT NOT EXISTS (
  SELECT 1 FROM "character_weekly_unavailability" WHERE "difficulty" IS NULL
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
      this.dropConstraint({
        schema: 'public',
        table: 'character_weekly_unavailability',
        constraint: 'character_weekly_unavailability_characterId_resetIdentifier_key',
      }),
      this.addColumn({
        schema: 'public',
        table: 'character_weekly_unavailability',
        column: col('difficulty', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      expandLegacyWeeklyUnavailabilityToDifficulties(),
      this.setNotNull({
        schema: 'public',
        table: 'character_weekly_unavailability',
        column: 'difficulty',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'character_weekly_unavailability',
        constraint: 'character_weekly_unavailability_difficulty_check_05ae26c2',
        expression: "\"difficulty\" IN ('NORMAL', 'HEROIC', 'MYTHIC')",
      }),
      this.addUnique({
        schema: 'public',
        table: 'character_weekly_unavailability',
        constraint: 'character_weekly_unavailability_characterId_resetIdentifier_difficulty_key',
        columns: ['characterId', 'resetIdentifier', 'difficulty'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
