#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/4dc4e3e4992b86217d8fc9d3ea09bfe0b3deee47daf3a2d4e789bc0e64f58198/contract';
import endContract from '../../snapshots/4dc4e3e4992b86217d8fc9d3ea09bfe0b3deee47daf3a2d4e789bc0e64f58198/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/6bf45172add1e36a8b1f7b73f96a6ed59a18db85fa7aa3ad9414f9466e9df267/contract';
import startContract from '../../snapshots/6bf45172add1e36a8b1f7b73f96a6ed59a18db85fa7aa3ad9414f9466e9df267/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('discordGlobalName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('discordGuildNickname', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('discordNameSyncedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
