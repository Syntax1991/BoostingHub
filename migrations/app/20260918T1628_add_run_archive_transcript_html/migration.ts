#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/6226ed1c5c811c3b10b25e618f47db27972dc35fdba6a0a5b47992da49679406/contract';
import endContract from '../../snapshots/6226ed1c5c811c3b10b25e618f47db27972dc35fdba6a0a5b47992da49679406/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/686f7d4a630dd6e1e73a45107f304a4e7787743d7632e2d439d9234604790085/contract';
import startContract from '../../snapshots/686f7d4a630dd6e1e73a45107f304a4e7787743d7632e2d439d9234604790085/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run_discord_post',
        column: col('archiveTranscriptFilename', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_discord_post',
        column: col('archiveTranscriptHtml', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
