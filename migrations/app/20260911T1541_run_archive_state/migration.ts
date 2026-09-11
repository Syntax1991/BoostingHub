#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/80beca6c41b879665b85c5f02c2cdd9c849b476fa8c2936ffc80453a8ac6134c/contract';
import endContract from '../../snapshots/80beca6c41b879665b85c5f02c2cdd9c849b476fa8c2936ffc80453a8ac6134c/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a64a235b66c4f4ce4c07ae6d47fc706c5e40312723aa26aa5aa1575223f9a585/contract';
import startContract from '../../snapshots/a64a235b66c4f4ce4c07ae6d47fc706c5e40312723aa26aa5aa1575223f9a585/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run',
        column: col('archivedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'run',
        column: col('archivedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'run',
        index: 'run_archivedAt_idx_5fc66e5b',
        columns: ['archivedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run',
        index: 'run_archivedById_idx_d546efc6',
        columns: ['archivedById'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run',
        foreignKey: {
          name: 'run_archivedById_fkey',
          columns: ['archivedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
