#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/b3dee35fc7b9568f86082e4e88873fd0da9334450dfe0a2fcf5570e06f5a3c8b/contract';
import startContract from '../../snapshots/b3dee35fc7b9568f86082e4e88873fd0da9334450dfe0a2fcf5570e06f5a3c8b/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ed3a2a3abfc593e7f2eda1a17c3d336fac7625844500efd7998e685a32c6735a/contract';
import endContract from '../../snapshots/ed3a2a3abfc593e7f2eda1a17c3d336fac7625844500efd7998e685a32c6735a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run_discord_post',
        column: col('lastStartVoiceChannelId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
