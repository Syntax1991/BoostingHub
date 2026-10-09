#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/b5f7252fce6aebcbd89a8664435c92a715f6b389581a79c4ef137fe117b3373b/contract';
import endContract from '../../snapshots/b5f7252fce6aebcbd89a8664435c92a715f6b389581a79c4ef137fe117b3373b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f82031150f6f206346f775373f3fe2226506d5f2d032b00ecd47d1cef18cec24/contract';
import startContract from '../../snapshots/f82031150f6f206346f775373f3fe2226506d5f2d032b00ecd47d1cef18cec24/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'character_offspec_role',
        columns: [
          col('characterId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'character_offspec_role_role_check_e8a47be4',
            "\"role\" IN ('TANK', 'HEALER', 'MELEE_DPS', 'RANGED_DPS', 'DPS')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'character_offspec_role',
        constraint: 'character_offspec_role_characterId_role_key',
        columns: ['characterId', 'role'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'character_offspec_role',
        index: 'character_offspec_role_characterId_idx_2423fe9d',
        columns: ['characterId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'character_offspec_role',
        foreignKey: {
          name: 'character_offspec_role_characterId_fkey',
          columns: ['characterId'],
          references: { schema: 'public', table: 'character', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
