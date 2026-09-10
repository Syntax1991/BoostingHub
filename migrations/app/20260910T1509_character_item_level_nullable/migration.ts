#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/99195123b1ac9414e49fb31343a888dcb59fb8e1b9f6dca72d2a03785f3c0220/contract';
import startContract from '../../snapshots/99195123b1ac9414e49fb31343a888dcb59fb8e1b9f6dca72d2a03785f3c0220/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d177d99e5ee7ef8c389335cfff0f322b34d28e753c2fd2afef5fad4ddc88657f/contract';
import endContract from '../../snapshots/d177d99e5ee7ef8c389335cfff0f322b34d28e753c2fd2afef5fad4ddc88657f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.dropNotNull({ schema: 'public', table: 'character', column: 'itemLevel' })];
  }
}

MigrationCLI.run(import.meta.url, M);
