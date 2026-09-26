#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/350c9c0e4ac04b7bc7dc972cb8f42137d1aa0591b6c707b42b64d79b91db44e6/contract';
import startContract from '../../snapshots/350c9c0e4ac04b7bc7dc972cb8f42137d1aa0591b6c707b42b64d79b91db44e6/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d79acc109f9c4760100a1e605dd78641f11076780b8850d5d682aad52eca8554/contract';
import endContract from '../../snapshots/d79acc109f9c4760100a1e605dd78641f11076780b8850d5d682aad52eca8554/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'character',
        column: col('lastSyncAttemptAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'character',
        column: col('lastSyncErrorAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'character',
        column: col('lastSyncErrorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'character',
        column: col('syncFailureCount', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'character',
        constraint: 'character_lastSyncErrorCode_check_d5a4a203',
        expression:
          "\"lastSyncErrorCode\" IN ('PROFILE_UNAVAILABLE', 'IDENTITY_CONFLICT', 'NAME_CONFLICT', 'RATE_LIMITED', 'UPSTREAM_UNAVAILABLE', 'AUTH_OR_CONFIG', 'INTERNAL')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
