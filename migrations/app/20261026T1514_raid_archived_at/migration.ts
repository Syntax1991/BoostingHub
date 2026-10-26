#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/61b92f9402f7825de761de9d22b7ce30c0a3a4d6e59f9c54d21f64583fd27260/contract';
import startContract from '../../snapshots/61b92f9402f7825de761de9d22b7ce30c0a3a4d6e59f9c54d21f64583fd27260/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/8d62cbc3da30bdeac418ac71f1d705e04e5c2526b0161bec92c1f5458054568f/contract';
import endContract from '../../snapshots/8d62cbc3da30bdeac418ac71f1d705e04e5c2526b0161bec92c1f5458054568f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // Additive, no backfill: every existing Raid stays in the catalog (null).
      this.addColumn({
        schema: 'public',
        table: 'raid',
        column: col('archivedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
