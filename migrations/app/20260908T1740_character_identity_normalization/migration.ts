#!/usr/bin/env -S node
import type { Contract as Start } from "../../snapshots/5244433c3c7cf58977b92bcb2c3d44ae1260d60893053c632bd6f0ca47e055eb/contract";
import startContract from "../../snapshots/5244433c3c7cf58977b92bcb2c3d44ae1260d60893053c632bd6f0ca47e055eb/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/dee9853feea3fb59f766200ac8782b6af08b55290afa6d9546016404bd84f5a3/contract";
import endContract from "../../snapshots/dee9853feea3fb59f766200ac8782b6af08b55290afa6d9546016404bd84f5a3/contract.json" with { type: "json" };
import { Migration, MigrationCLI, col, rawSql } from "@prisma/orm-postgres/migration";

function backfillNormalizedColumn(column: "normalizedName" | "normalizedRealm", source: "name" | "realm") {
  const nullCheck = `SELECT 1 FROM "character" WHERE "${column}" IS NULL LIMIT 1`;
  return rawSql({
    id: `data_migration.backfill-character-${column}`,
    label: `Data transform: backfill-character-${column}`,
    operationClass: "data",
    target: { id: "postgres" },
    precheck: [
      {
        description: `Check backfill-character-${column} has work to do`,
        sql: `SELECT EXISTS (${nullCheck}) AS ok`,
        params: [],
      },
    ],
    execute: [
      {
        description: `Run backfill-character-${column}`,
        sql: `UPDATE "character" SET "${column}" = lower(btrim(regexp_replace("${source}", '[[:space:]]+', ' ', 'g'))) WHERE "${column}" IS NULL`,
        params: [],
      },
    ],
    postcheck: [
      {
        description: `Verify backfill-character-${column} resolved all violations`,
        sql: `SELECT NOT EXISTS (${nullCheck}) AS ok`,
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
        schema: "public",
        table: "character",
        column: col("normalizedName", "text", { codecRef: { codecId: "pg/text@1" } }),
      }),
      backfillNormalizedColumn("normalizedName", "name"),
      this.setNotNull({ schema: "public", table: "character", column: "normalizedName" }),
      this.addColumn({
        schema: "public",
        table: "character",
        column: col("normalizedRealm", "text", { codecRef: { codecId: "pg/text@1" } }),
      }),
      backfillNormalizedColumn("normalizedRealm", "realm"),
      this.setNotNull({ schema: "public", table: "character", column: "normalizedRealm" }),
      this.addUnique({
        schema: "public",
        table: "character",
        constraint: "character_userId_region_normalizedRealm_normalizedName_key",
        columns: ["userId", "region", "normalizedRealm", "normalizedName"],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
