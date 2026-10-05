#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/af95e636c77ff4fcb33a3831d78a957f93394db80da993911405a18bb0346ae3/contract';
import endContract from '../../snapshots/af95e636c77ff4fcb33a3831d78a957f93394db80da993911405a18bb0346ae3/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f8798188c4faa1922fa0f11503c7a1e1ec61828974d618286a9a350c3770e71a/contract';
import startContract from '../../snapshots/f8798188c4faa1922fa0f11503c7a1e1ec61828974d618286a9a350c3770e71a/contract.json' with { type: 'json' };
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
        table: 'integration_event',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('durationMs', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('entityId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('entityType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('httpStatus', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metadataJson', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('operation', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('provider', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('region', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'integration_event_provider_check_0cda3fe9',
            "\"provider\" IN ('BLIZZARD', 'WARCRAFT_LOGS', 'DISCORD', 'RAIDER_IO', 'SYSTEM', 'BACKUP')",
          ),
          checkExpression('integration_event_region_check_0ad0075e', "\"region\" IN ('EU', 'US')"),
          checkExpression(
            'integration_event_status_check_739674ef',
            "\"status\" IN ('SUCCESS', 'WARNING', 'ERROR')",
          ),
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'integration_event',
        index: 'integration_event_createdAt_idx_9575dbd7',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'integration_event',
        index: 'integration_event_provider_createdAt_idx_fd3b9fd1',
        columns: ['provider', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'integration_event',
        index: 'integration_event_provider_operation_createdAt_idx_40fc1a5a',
        columns: ['provider', 'operation', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'integration_event',
        index: 'integration_event_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
