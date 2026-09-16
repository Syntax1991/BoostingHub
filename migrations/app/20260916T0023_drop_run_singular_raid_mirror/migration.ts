#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/9472b92f2c500d16a01866a6ef3b535617bcbedba167210e36f5cde896376c5f/contract';
import startContract from '../../snapshots/9472b92f2c500d16a01866a6ef3b535617bcbedba167210e36f5cde896376c5f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/edf19dd6b7c59253e41b335b4b7dde5177c934ab38ad96f8e51cebbf2ead1c7a/contract';
import endContract from '../../snapshots/edf19dd6b7c59253e41b335b4b7dde5177c934ab38ad96f8e51cebbf2ead1c7a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({ schema: 'public', table: 'run', column: 'plannedBossCount' }),
      this.dropConstraint({
        schema: 'public',
        table: 'run',
        constraint: 'run_raidId_fkey',
        kind: 'foreignKey',
      }),
      this.dropIndex({ schema: 'public', table: 'run', index: 'run_raidId_idx_996eeca9' }),
      this.dropColumn({ schema: 'public', table: 'run', column: 'raidId' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
