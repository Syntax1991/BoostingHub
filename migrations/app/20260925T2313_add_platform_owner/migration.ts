#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/350c9c0e4ac04b7bc7dc972cb8f42137d1aa0591b6c707b42b64d79b91db44e6/contract';
import endContract from '../../snapshots/350c9c0e4ac04b7bc7dc972cb8f42137d1aa0591b6c707b42b64d79b91db44e6/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/af5737a76482ba8a717a13bc9facad3bbca86f5813c46f2cc67573ac736abd9e/contract';
import startContract from '../../snapshots/af5737a76482ba8a717a13bc9facad3bbca86f5813c46f2cc67573ac736abd9e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'user',
        constraint: 'user_accountRole_check_bf325bd2',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'user',
        constraint: 'user_accountRole_check_ce88b195',
        expression: "\"accountRole\" IN ('USER', 'RAID_LEAD', 'ADMIN', 'OWNER')",
      }),
      this.createIndex({
        schema: 'public',
        table: 'user',
        index: 'user_single_owner_da579d9c',
        columns: ['accountRole'],
        extras: { where: '("accountRole" = \'OWNER\'::text)', unique: true },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
