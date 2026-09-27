#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/67d60979569b1d2f02989c84f828ef338e25ef8eae9d725c3d83735634763a20/contract';
import startContract from '../../snapshots/67d60979569b1d2f02989c84f828ef338e25ef8eae9d725c3d83735634763a20/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e1ac07b6a810888d26608cd1f136488065c3f2f75ba486dc7385fb932159ca95/contract';
import endContract from '../../snapshots/e1ac07b6a810888d26608cd1f136488065c3f2f75ba486dc7385fb932159ca95/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run_discord_post',
        column: col('lastRosterEmojiFingerprint', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
