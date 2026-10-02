#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/a4ffcd2c3331ed35c1500027a7baa2bf28de8a8656c1c46ffd7aaefa43a26c23/contract';
import startContract from '../../snapshots/a4ffcd2c3331ed35c1500027a7baa2bf28de8a8656c1c46ffd7aaefa43a26c23/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f8798188c4faa1922fa0f11503c7a1e1ec61828974d618286a9a350c3770e71a/contract';
import endContract from '../../snapshots/f8798188c4faa1922fa0f11503c7a1e1ec61828974d618286a9a350c3770e71a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'booster_access',
        constraint: 'booster_access_role_check_b1616ae6',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'character',
        constraint: 'character_primaryRole_check_1fa7067b',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'run_consumable_audit_player',
        constraint: 'run_consumable_audit_player_role_check_b1616ae6',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'run_external_booster',
        constraint: 'run_external_booster_role_check_b1616ae6',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'run_payout_entry',
        constraint: 'run_payout_entry_role_check_b1616ae6',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'run_roster_entry',
        constraint: 'run_roster_entry_selectedRole_check_e659d19f',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'run_signup',
        constraint: 'run_signup_publishedRole_check_17f7e8a4',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'run_signup_role',
        constraint: 'run_signup_role_role_check_b1616ae6',
      }),
      this.createTable({
        schema: 'public',
        table: 'character_playable_spec',
        columns: [
          col('characterId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('specialization', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'booster_access',
        constraint: 'booster_access_role_check_e8a47be4',
        expression: "\"role\" IN ('TANK', 'HEALER', 'MELEE_DPS', 'RANGED_DPS', 'DPS')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'character',
        constraint: 'character_primaryRole_check_490a2046',
        expression: "\"primaryRole\" IN ('TANK', 'HEALER', 'MELEE_DPS', 'RANGED_DPS', 'DPS')",
      }),
      this.addUnique({
        schema: 'public',
        table: 'character_playable_spec',
        constraint: 'character_playable_spec_characterId_specialization_key',
        columns: ['characterId', 'specialization'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_consumable_audit_player',
        constraint: 'run_consumable_audit_player_role_check_e8a47be4',
        expression: "\"role\" IN ('TANK', 'HEALER', 'MELEE_DPS', 'RANGED_DPS', 'DPS')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_external_booster',
        constraint: 'run_external_booster_role_check_e8a47be4',
        expression: "\"role\" IN ('TANK', 'HEALER', 'MELEE_DPS', 'RANGED_DPS', 'DPS')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_payout_entry',
        constraint: 'run_payout_entry_role_check_e8a47be4',
        expression: "\"role\" IN ('TANK', 'HEALER', 'MELEE_DPS', 'RANGED_DPS', 'DPS')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_roster_entry',
        constraint: 'run_roster_entry_selectedRole_check_a4665995',
        expression: "\"selectedRole\" IN ('TANK', 'HEALER', 'MELEE_DPS', 'RANGED_DPS', 'DPS')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_signup',
        constraint: 'run_signup_publishedRole_check_f7d3ea54',
        expression: "\"publishedRole\" IN ('TANK', 'HEALER', 'MELEE_DPS', 'RANGED_DPS', 'DPS')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_signup_role',
        constraint: 'run_signup_role_role_check_e8a47be4',
        expression: "\"role\" IN ('TANK', 'HEALER', 'MELEE_DPS', 'RANGED_DPS', 'DPS')",
      }),
      this.createIndex({
        schema: 'public',
        table: 'character_playable_spec',
        index: 'character_playable_spec_characterId_idx_2423fe9d',
        columns: ['characterId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'character_playable_spec',
        foreignKey: {
          name: 'character_playable_spec_characterId_fkey',
          columns: ['characterId'],
          references: { schema: 'public', table: 'character', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
