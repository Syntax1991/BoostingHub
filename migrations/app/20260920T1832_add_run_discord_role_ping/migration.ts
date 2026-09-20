#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/94cadc98f7f681a5a924f8038077e2a475f215299a5fe2cc44e7b02a2c6a306a/contract';
import startContract from '../../snapshots/94cadc98f7f681a5a924f8038077e2a475f215299a5fe2cc44e7b02a2c6a306a/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d0baceb8d12d7ee342eee5e908f4cc64cb38514a74bf2efef58af6458a5aabf1/contract';
import endContract from '../../snapshots/d0baceb8d12d7ee342eee5e908f4cc64cb38514a74bf2efef58af6458a5aabf1/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run',
        column: col('discordRolePing', 'bool', {
          notNull: true,
          default: lit(true),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
