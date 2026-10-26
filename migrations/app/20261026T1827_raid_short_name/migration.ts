#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/7b89d762d89a8727648436736954dfbb86a8b6b7bf1d66f8443334e55b7289a5/contract';
import endContract from '../../snapshots/7b89d762d89a8727648436736954dfbb86a8b6b7bf1d66f8443334e55b7289a5/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/8d62cbc3da30bdeac418ac71f1d705e04e5c2526b0161bec92c1f5458054568f/contract';
import startContract from '../../snapshots/8d62cbc3da30bdeac418ac71f1d705e04e5c2526b0161bec92c1f5458054568f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // Additive, no backfill: null = short name derived from Raid.name.
      this.addColumn({
        schema: 'public',
        table: 'raid',
        column: col('shortName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
