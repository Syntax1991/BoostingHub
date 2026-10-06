#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/348d8a8ee91b946265bf0c026db33325e99bc0943b9a46739f2f82d4cd026a3c/contract';
import endContract from '../../snapshots/348d8a8ee91b946265bf0c026db33325e99bc0943b9a46739f2f82d4cd026a3c/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/883475348809d9f7a8306f4723a62f0d0e12f85c94ecc2c145ad2e31e4f14886/contract';
import startContract from '../../snapshots/883475348809d9f7a8306f4723a62f0d0e12f85c94ecc2c145ad2e31e4f14886/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'community_schedule_slot',
        column: col('runMode', 'text', {
          notNull: true,
          default: lit('INHOUSE'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'community_schedule_slot',
        constraint: 'community_schedule_slot_runMode_check_dc95dab2',
        expression: "\"runMode\" IN ('INHOUSE', 'TEAM_RUN')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
