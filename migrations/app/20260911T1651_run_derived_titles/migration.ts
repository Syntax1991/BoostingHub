#!/usr/bin/env -S node
import postgresStatic from '@prisma/orm-postgres/static';
import type { Contract as Start } from '../../snapshots/80beca6c41b879665b85c5f02c2cdd9c849b476fa8c2936ffc80453a8ac6134c/contract';
import startContract from '../../snapshots/80beca6c41b879665b85c5f02c2cdd9c849b476fa8c2936ffc80453a8ac6134c/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d9154f982c56d940ca5cd44fa850d230c21c8cdf09024ec3105b0179d5d258b3/contract';
import endContract from '../../snapshots/d9154f982c56d940ca5cd44fa850d230c21c8cdf09024ec3105b0179d5d258b3/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

// Backfill values, not runtime authority: the app always computes a Raid's
// total boss count live from its RaidBoss rows (see raid.repository.ts).
// These are simply what that computation resolves to, today, for the two
// reference raids that exist at the time this migration was authored — a
// one-time historical fix, not a hardcoded presentation constant.
const RAID_TOTAL_BOSS_COUNT_AT_MIGRATION_TIME: Record<string, number> = {
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': 8, // Manaforge Omega
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb': 8, // The Venomous Abyss
};

// Build-only query plans (no live DB connection needed at self-emit time —
// db migrate executes the rendered SQL from ops.json, not this instance).
const migrationDb = postgresStatic<End>({ contractJson: endContract });

// Fixed, not "now": self-emit re-evaluates these closures on every verify/apply
// pass. An auto-injected `updatedAt: new Date()` default would render a new
// timestamp each time and make the migration's content hash non-reproducible.
const BACKFILL_UPDATED_AT = '2026-09-11T00:00:00.000Z';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'run',
        column: col('lootType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.dataTransform(migrationDb.contract, 'backfill-run-lootType', {
        // No reliable signal in historical Runs distinguishes SAVED/UNSAVED/VIP —
        // UNSAVED is the only value valid for every difficulty including MYTHIC,
        // so it can never backfill an invalid MYTHIC+SAVED combination.
        check: () =>
          migrationDb.sql.public.run
            .select('id')
            .where((f, fns) => fns.eq(f.lootType, null))
            .limit(1)
            .build(),
        run: () =>
          migrationDb.sql.public.run
            .update({ lootType: 'UNSAVED', updatedAt: BACKFILL_UPDATED_AT })
            .where((f, fns) => fns.eq(f.lootType, null))
            .build(),
      }),
      this.setNotNull({ schema: 'public', table: 'run', column: 'lootType' }),
      this.addColumn({
        schema: 'public',
        table: 'run',
        column: col('plannedBossCount', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.dataTransform(migrationDb.contract, 'backfill-run-plannedBossCount', {
        check: () =>
          migrationDb.sql.public.run
            .select('id')
            .where((f, fns) => fns.eq(f.plannedBossCount, null))
            .limit(1)
            .build(),
        run: Object.entries(RAID_TOTAL_BOSS_COUNT_AT_MIGRATION_TIME).map(
          ([raidId, totalBossCount]) => () =>
            migrationDb.sql.public.run
              .update({ plannedBossCount: totalBossCount, updatedAt: BACKFILL_UPDATED_AT })
              .where((f, fns) => fns.and(fns.eq(f.raidId, raidId), fns.eq(f.plannedBossCount, null)))
              .build(),
        ),
      }),
      this.setNotNull({ schema: 'public', table: 'run', column: 'plannedBossCount' }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run',
        constraint: 'run_lootType_check_3071d052',
        expression: "\"lootType\" IN ('SAVED', 'UNSAVED', 'VIP')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
