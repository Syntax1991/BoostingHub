#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/7dff7df8f540891dbd2f78ace1eb7bbc038ab04448d541c5ff0c80bc9aeccd54/contract';
import startContract from '../../snapshots/7dff7df8f540891dbd2f78ace1eb7bbc038ab04448d541c5ff0c80bc9aeccd54/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/a64a235b66c4f4ce4c07ae6d47fc706c5e40312723aa26aa5aa1575223f9a585/contract';
import endContract from '../../snapshots/a64a235b66c4f4ce4c07ae6d47fc706c5e40312723aa26aa5aa1575223f9a585/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run_discord_post',
        column: col('runChannelId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
