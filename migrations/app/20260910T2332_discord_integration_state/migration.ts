#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5205d5a2344e04022a37bb44f384e025878e28c0d7e91be9ecfc9032a2bf12aa/contract';
import startContract from '../../snapshots/5205d5a2344e04022a37bb44f384e025878e28c0d7e91be9ecfc9032a2bf12aa/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/7dff7df8f540891dbd2f78ace1eb7bbc038ab04448d541c5ff0c80bc9aeccd54/contract';
import endContract from '../../snapshots/7dff7df8f540891dbd2f78ace1eb7bbc038ab04448d541c5ff0c80bc9aeccd54/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'run_discord_post',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastRosterVersion', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('lastSignupSignature', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('rosterChannelId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('rosterMessageId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('rosterPostedAt', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('runId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('signupChannelId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('signupMessageId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('signupPostedAt', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_discord_post',
        constraint: 'run_discord_post_runId_key',
        columns: ['runId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_discord_post',
        foreignKey: {
          name: 'run_discord_post_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'run', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
