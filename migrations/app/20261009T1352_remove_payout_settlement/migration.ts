#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/7285120304500c3db5259df8a2e1b11f547ad54869b97c8767afdb8c3637973f/contract';
import endContract from '../../snapshots/7285120304500c3db5259df8a2e1b11f547ad54869b97c8767afdb8c3637973f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b5f7252fce6aebcbd89a8664435c92a715f6b389581a79c4ef137fe117b3373b/contract';
import startContract from '../../snapshots/b5f7252fce6aebcbd89a8664435c92a715f6b389581a79c4ef137fe117b3373b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropTable({ schema: 'public', table: 'run_payout_entry' }),
      this.dropTable({ schema: 'public', table: 'run_settlement' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
