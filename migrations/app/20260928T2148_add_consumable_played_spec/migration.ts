#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/e6e069169ebaa1f098a957c97a4912fab9e330a3d208587e250b8ea3f3a5a99e/contract';
import endContract from '../../snapshots/e6e069169ebaa1f098a957c97a4912fab9e330a3d208587e250b8ea3f3a5a99e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e9665e734556b0c551f879899a7a054a242554e39ced499f128ae400462e1368/contract';
import startContract from '../../snapshots/e9665e734556b0c551f879899a7a054a242554e39ced499f128ae400462e1368/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run_consumable_audit',
        column: col('factsVersion', 'int4', {
          notNull: true,
          default: lit(1),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_consumable_audit_observation',
        column: col('specId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
