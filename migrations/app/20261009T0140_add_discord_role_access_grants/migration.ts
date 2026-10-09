#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/cf6ac14eb6dc83ff8424bce619ba8a279407cbad759ef3a4ff3269f83e271e39/contract';
import startContract from '../../snapshots/cf6ac14eb6dc83ff8424bce619ba8a279407cbad759ef3a4ff3269f83e271e39/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f82031150f6f206346f775373f3fe2226506d5f2d032b00ecd47d1cef18cec24/contract';
import endContract from '../../snapshots/f82031150f6f206346f775373f3fe2226506d5f2d032b00ecd47d1cef18cec24/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('discordLootbuddy', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('discordRaidBooster', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
