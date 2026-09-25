#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/30c59f88fbba1846d874388926b91ada25fb5326d8af0960feb6ad6478167c70/contract';
import endContract from '../../snapshots/30c59f88fbba1846d874388926b91ada25fb5326d8af0960feb6ad6478167c70/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/ed3a2a3abfc593e7f2eda1a17c3d336fac7625844500efd7998e685a32c6735a/contract';
import startContract from '../../snapshots/ed3a2a3abfc593e7f2eda1a17c3d336fac7625844500efd7998e685a32c6735a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, rawSql } from '@prisma/orm-postgres/migration';

// The silent half of a booster character swap (roster.repository.ts
// notifyRosterSelectionChangesInTx): a ROSTER_REMOVED for the old character,
// written in the same transaction as the new character's `roster-swapped:`
// ROSTER_SELECTED — same user, run and roster version (sourceKey segments 2
// and 3), different signup (segment 4) — with no DM and created already read
// (readAt = createdAt). A genuine removal is never created read, so a
// SKIPPED / read / no-Discord-id removal on its own is NOT enough to hide it.
const SWAP_BOOKKEEPING_REMOVAL = `r."type" = 'ROSTER_REMOVED' AND r."sourceKey" LIKE 'roster-removed:%' AND r."discordDeliveryStatus" = 'SKIPPED' AND r."discordUserId" IS NULL AND r."discordDeliverAfter" IS NULL AND r."readAt" IS NOT NULL AND r."readAt" = r."createdAt" AND EXISTS ( SELECT 1 FROM "user_notification" s WHERE s."type" = 'ROSTER_SELECTED' AND s."sourceKey" LIKE 'roster-swapped:%' AND s."userId" = r."userId" AND split_part(s."sourceKey", ':', 2) = split_part(r."sourceKey", ':', 2) AND split_part(s."sourceKey", ':', 3) = split_part(r."sourceKey", ':', 3) AND split_part(s."sourceKey", ':', 4) <> split_part(r."sourceKey", ':', 4) )`;

function hideRosterSwapBookkeepingRemovals() {
  return rawSql({
    id: 'data_migration.hide-roster-swap-bookkeeping-removals',
    label: 'Data transform: hide the silent removal half of booster character swaps',
    operationClass: 'data',
    target: { id: 'postgres' },
    precheck: [
      {
        description: 'Allow backfill (idempotent update)',
        sql: 'SELECT true AS ok',
        params: [],
      },
    ],
    execute: [
      {
        description: 'Mark swap bookkeeping removals as not visible in app',
        sql: `UPDATE "user_notification" AS r SET "visibleInApp" = false WHERE r."visibleInApp" = true AND ${SWAP_BOOKKEEPING_REMOVAL}`,
        params: [],
      },
    ],
    postcheck: [
      {
        description: 'No swap bookkeeping removal is still visible',
        sql: `SELECT NOT EXISTS ( SELECT 1 FROM "user_notification" AS r WHERE r."visibleInApp" = true AND ${SWAP_BOOKKEEPING_REMOVAL} ) AS ok`,
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
      this.addColumn({
        schema: 'public',
        table: 'user_notification',
        column: col('visibleInApp', 'bool', {
          notNull: true,
          default: lit(true),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      hideRosterSwapBookkeepingRemovals(),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
