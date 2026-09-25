#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/30c59f88fbba1846d874388926b91ada25fb5326d8af0960feb6ad6478167c70/contract';
import startContract from '../../snapshots/30c59f88fbba1846d874388926b91ada25fb5326d8af0960feb6ad6478167c70/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/7047ab4203b0ba0258b8d66343044c9319e1071c6bafb3a4a315a2fef9e458cd/contract';
import endContract from '../../snapshots/7047ab4203b0ba0258b8d66343044c9319e1071c6bafb3a4a315a2fef9e458cd/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropTable({ schema: 'public', table: 'discord_ticket_panel' }),
      this.dropTable({ schema: 'public', table: 'support_ticket' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
