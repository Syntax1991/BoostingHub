#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/88b442eebc2abf05f8e275d54d2e4f0af2e09f5143d0c164797fe29f8b22fd8f/contract';
import startContract from '../../snapshots/88b442eebc2abf05f8e275d54d2e4f0af2e09f5143d0c164797fe29f8b22fd8f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/cf6ac14eb6dc83ff8424bce619ba8a279407cbad759ef3a4ff3269f83e271e39/contract';
import endContract from '../../snapshots/cf6ac14eb6dc83ff8424bce619ba8a279407cbad759ef3a4ff3269f83e271e39/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/migration';

/**
 * Safety gate: refuse to drop RunTemplate.raidId / plannedBossCount unless every
 * template already has authoritative RunTemplateRaidContent rows.
 */
function assertEveryTemplateHasContents() {
  return rawSql({
    id: 'data_migration.assert-run-template-contents-before-mirror-drop',
    label: 'Assert every RunTemplate has RunTemplateRaidContent before dropping mirror columns',
    operationClass: 'data',
    target: { id: 'postgres' },
    precheck: [
      {
        description: 'Every RunTemplate has at least one content row',
        sql: `SELECT NOT EXISTS (
  SELECT 1 FROM "run_template" t
  WHERE NOT EXISTS (
    SELECT 1 FROM "run_template_raid_content" c WHERE c."runTemplateId" = t."id"
  )
) AS ok`,
        params: [],
      },
    ],
    execute: [
      {
        description: 'No-op (assertion-only step)',
        sql: 'SELECT true',
        params: [],
      },
    ],
    postcheck: [
      {
        description: 'Contents still present after assertion',
        sql: `SELECT NOT EXISTS (
  SELECT 1 FROM "run_template" t
  WHERE NOT EXISTS (
    SELECT 1 FROM "run_template_raid_content" c WHERE c."runTemplateId" = t."id"
  )
) AS ok`,
        params: [],
      },
    ],
  });
}

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      assertEveryTemplateHasContents(),
      this.dropColumn({ schema: 'public', table: 'run_template', column: 'plannedBossCount' }),
      this.dropConstraint({
        schema: 'public',
        table: 'run_template',
        constraint: 'run_template_raidId_fkey',
        kind: 'foreignKey',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'run_template',
        index: 'run_template_raidId_idx_996eeca9',
      }),
      this.dropColumn({ schema: 'public', table: 'run_template', column: 'raidId' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
