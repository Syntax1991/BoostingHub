#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/58e51ab35e4c9bc152038e5988e98923118ffedbca70c6b767e03d93e9b34c7f/contract';
import endContract from '../../snapshots/58e51ab35e4c9bc152038e5988e98923118ffedbca70c6b767e03d93e9b34c7f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b6965eeecc4b50ec21177d6973308846f7983e8541be35e450884652b309828c/contract';
import startContract from '../../snapshots/b6965eeecc4b50ec21177d6973308846f7983e8541be35e450884652b309828c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'user_notification',
        constraint: 'user_notification_type_check_1b0a5b12',
      }),
      this.addColumn({
        schema: 'public',
        table: 'run',
        column: col('scheduleRevision', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('defaultCharacterId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('discordDmEnabled', 'bool', {
          notNull: true,
          default: lit(true),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('dmRosterRemovedEnabled', 'bool', {
          notNull: true,
          default: lit(true),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('dmRunCancelledEnabled', 'bool', {
          notNull: true,
          default: lit(true),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('dmRunRescheduledEnabled', 'bool', {
          notNull: true,
          default: lit(true),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('timeZone', 'text', {
          notNull: true,
          default: lit('Europe/Berlin'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'user_notification',
        constraint: 'user_notification_type_check_3f82dea7',
        expression:
          "\"type\" IN ('ROSTER_SELECTED', 'RAID_INVITE', 'RUN_CANCELLED', 'RUN_RESCHEDULED', 'ROSTER_REMOVED')",
      }),
      this.createIndex({
        schema: 'public',
        table: 'user',
        index: 'user_defaultCharacterId_idx_b1c87c96',
        columns: ['defaultCharacterId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'user',
        foreignKey: {
          name: 'user_defaultCharacterId_fkey',
          columns: ['defaultCharacterId'],
          references: { schema: 'public', table: 'character', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
