#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/af95e636c77ff4fcb33a3831d78a957f93394db80da993911405a18bb0346ae3/contract';
import startContract from '../../snapshots/af95e636c77ff4fcb33a3831d78a957f93394db80da993911405a18bb0346ae3/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c61d6c9debd1aa276ddf258e7f0c7e6329fddb1af0a9b20ab2e52c05e51d9688/contract';
import endContract from '../../snapshots/c61d6c9debd1aa276ddf258e7f0c7e6329fddb1af0a9b20ab2e52c05e51d9688/contract.json' with { type: 'json' };
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
        table: 'run_domain_event',
        columns: [
          col('actorKind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('actorUserId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurredAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('payloadJson', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('runId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('summary', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_domain_event_actorKind_check_2e50fd04',
            "\"actorKind\" IN ('USER', 'SYSTEM')",
          ),
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_domain_event',
        index: 'run_domain_event_actorUserId_idx_96dac96c',
        columns: ['actorUserId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_domain_event',
        index: 'run_domain_event_occurredAt_idx_c6b89167',
        columns: ['occurredAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_domain_event',
        index: 'run_domain_event_runId_idx_a6016437',
        columns: ['runId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_domain_event',
        index: 'run_domain_event_runId_occurredAt_idx_9e803df7',
        columns: ['runId', 'occurredAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_domain_event',
        index: 'run_domain_event_type_occurredAt_idx_4a74ac21',
        columns: ['type', 'occurredAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_domain_event',
        foreignKey: {
          name: 'run_domain_event_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'run', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_domain_event',
        foreignKey: {
          name: 'run_domain_event_actorUserId_fkey',
          columns: ['actorUserId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
