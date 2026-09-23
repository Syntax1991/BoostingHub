#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2f6b4d340d13a3a8edb7b85297e91dcfd4d278924cc8cef9e82d2fa0cf132b64/contract';
import startContract from '../../snapshots/2f6b4d340d13a3a8edb7b85297e91dcfd4d278924cc8cef9e82d2fa0cf132b64/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/6405043c2e829b78862b77955df72fcb210c31ac115ccb227c865be57da941fe/contract';
import endContract from '../../snapshots/6405043c2e829b78862b77955df72fcb210c31ac115ccb227c865be57da941fe/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('discordDmQuietHoursEnabled', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('discordDmQuietHoursEnd', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('discordDmQuietHoursStart', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user_notification',
        column: col('discordDeliverAfter', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'user_notification',
        index: 'user_notification_dm_deliver_idx',
        columns: ['discordDeliveryStatus', 'discordDeliverAfter'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
