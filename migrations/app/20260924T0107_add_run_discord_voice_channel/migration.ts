#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/6405043c2e829b78862b77955df72fcb210c31ac115ccb227c865be57da941fe/contract';
import startContract from '../../snapshots/6405043c2e829b78862b77955df72fcb210c31ac115ccb227c865be57da941fe/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/85ba44364f9fa3d98e2cce5fb06cc0653843e3db62bfb6317df792ab14749c1f/contract';
import endContract from '../../snapshots/85ba44364f9fa3d98e2cce5fb06cc0653843e3db62bfb6317df792ab14749c1f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run_discord_post',
        column: col('voiceChannelId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
