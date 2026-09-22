#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2f6b4d340d13a3a8edb7b85297e91dcfd4d278924cc8cef9e82d2fa0cf132b64/contract';
import endContract from '../../snapshots/2f6b4d340d13a3a8edb7b85297e91dcfd4d278924cc8cef9e82d2fa0cf132b64/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/85e46eb0f05ccd857478f0cec7abbe7b66e9933c5dccd7ab0a876f3c4abaf607/contract';
import startContract from '../../snapshots/85e46eb0f05ccd857478f0cec7abbe7b66e9933c5dccd7ab0a876f3c4abaf607/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('discordRunChannelNickname', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
