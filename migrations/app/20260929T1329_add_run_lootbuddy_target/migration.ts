#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/4d4ce8b1eda059f6bcc34ae981987dc111d1f3ab69fd262ce0343b9b8130d144/contract';
import endContract from '../../snapshots/4d4ce8b1eda059f6bcc34ae981987dc111d1f3ab69fd262ce0343b9b8130d144/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e6e069169ebaa1f098a957c97a4912fab9e330a3d208587e250b8ea3f3a5a99e/contract';
import startContract from '../../snapshots/e6e069169ebaa1f098a957c97a4912fab9e330a3d208587e250b8ea3f3a5a99e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run',
        column: col('desiredLootbuddyCount', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_template',
        column: col('desiredLootbuddyCount', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
