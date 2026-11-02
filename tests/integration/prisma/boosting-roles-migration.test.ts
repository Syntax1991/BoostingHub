import { readFileSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgPool } from "@/lib/pg-pool";

/**
 * Runs the exact backfill SQL shipped in the boosting_roles_on_user migration
 * (ops.json) against the PRODUCTION table shape it upgrades from: one
 * BoosterQualification row per (User, Difficulty).
 *
 * The live test database is already on the new contract (no booster_qualification
 * table, User flags present), so the old shape is recreated as session-local TEMP
 * tables: the unqualified "user" / "booster_qualification" in the migration SQL
 * resolve to pg_temp first, leaving the real tables untouched.
 */
const MIGRATION_DIR = path.resolve(process.cwd(), "migrations/app/20260927T1408_boosting_roles_on_user");
const BACKFILL_ID = "data_migration.backfill-user-is-booster-from-booster-qualification";

type RawStep = { sql: string };
type RawOp = { id: string; execute?: RawStep[]; postcheck?: RawStep[] };

function readOps(): RawOp[] {
  return JSON.parse(readFileSync(path.join(MIGRATION_DIR, "ops.json"), "utf-8")) as RawOp[];
}

type Status = "APPROVED" | "REVOKED";
type Difficulty = "NORMAL" | "HEROIC" | "MYTHIC";

/** Scenario letter → description; `expected` is the resulting User.isBooster. */
const USERS = {
  a: { label: "NORMAL approved", expected: true },
  b: { label: "HEROIC approved", expected: true },
  c: { label: "MYTHIC approved", expected: true },
  d: { label: "NORMAL + HEROIC approved", expected: true },
  e: { label: "all three approved", expected: true },
  f: { label: "only revoked", expected: false },
  g: { label: "approved + revoked", expected: true },
  h: { label: "no qualification", expected: false },
} as const;
type UserKey = keyof typeof USERS;

const QUALIFICATIONS: Array<{ id: string; user: UserKey; difficulty: Difficulty; status: Status }> = [
  { id: "a-n", user: "a", difficulty: "NORMAL", status: "APPROVED" },
  { id: "b-h", user: "b", difficulty: "HEROIC", status: "APPROVED" },
  { id: "c-m", user: "c", difficulty: "MYTHIC", status: "APPROVED" },
  { id: "d-n", user: "d", difficulty: "NORMAL", status: "APPROVED" },
  { id: "d-h", user: "d", difficulty: "HEROIC", status: "APPROVED" },
  { id: "e-n", user: "e", difficulty: "NORMAL", status: "APPROVED" },
  { id: "e-h", user: "e", difficulty: "HEROIC", status: "APPROVED" },
  { id: "e-m", user: "e", difficulty: "MYTHIC", status: "APPROVED" },
  { id: "f-n", user: "f", difficulty: "NORMAL", status: "REVOKED" },
  { id: "f-m", user: "f", difficulty: "MYTHIC", status: "REVOKED" },
  { id: "g-h", user: "g", difficulty: "HEROIC", status: "APPROVED" },
  { id: "g-m", user: "g", difficulty: "MYTHIC", status: "REVOKED" },
];

let client: PoolClient;

async function flags(): Promise<Map<string, { isBooster: boolean; isLootbuddy: boolean }>> {
  const result = await client.query<{ id: string; isBooster: boolean; isLootbuddy: boolean }>(
    `SELECT "id", "isBooster", "isLootbuddy" FROM pg_temp."user" ORDER BY "id"`,
  );
  return new Map(result.rows.map((row) => [row.id, { isBooster: row.isBooster, isLootbuddy: row.isLootbuddy }]));
}

beforeAll(async () => {
  client = await pgPool.connect();
  // The User columns as the migration's addColumn ops create them (NOT NULL DEFAULT false).
  await client.query(`
    CREATE TEMP TABLE "user" (
      "id" text PRIMARY KEY,
      "isBooster" bool NOT NULL DEFAULT false,
      "isLootbuddy" bool NOT NULL DEFAULT false
    )
  `);
  await client.query(`
    CREATE TEMP TABLE "booster_qualification" (
      "id" text PRIMARY KEY,
      "userId" text NOT NULL,
      "difficulty" text NOT NULL,
      "status" text NOT NULL,
      UNIQUE ("userId", "difficulty")
    )
  `);
  for (const user of Object.keys(USERS)) {
    await client.query(`INSERT INTO pg_temp."user" ("id") VALUES ($1)`, [user]);
  }
  for (const row of QUALIFICATIONS) {
    await client.query(
      `INSERT INTO pg_temp."booster_qualification" ("id", "userId", "difficulty", "status") VALUES ($1, $2, $3, $4)`,
      [row.id, row.user, row.difficulty, row.status],
    );
  }
});

afterAll(async () => {
  await client?.query(`DROP TABLE IF EXISTS pg_temp."booster_qualification"`);
  await client?.query(`DROP TABLE IF EXISTS pg_temp."user"`);
  client?.release();
});

describe("migration: Boosting Roles move onto User", () => {
  it("adds the User flags, backfills, and only then drops booster_qualification", () => {
    const ids = readOps().map((op) => op.id);
    const backfill = ids.indexOf(BACKFILL_ID);
    expect(backfill).toBeGreaterThan(-1);
    expect(ids.indexOf("column.public.user.isBooster")).toBeLessThan(backfill);
    expect(ids.indexOf("column.public.user.isLootbuddy")).toBeLessThan(backfill);
    expect(ids.indexOf("dropTable.booster_qualification")).toBeGreaterThan(backfill);
    // Legacy request history is preserved: the migration never touches booster_access.
    expect(JSON.stringify(readOps())).not.toMatch(/booster_access/);
  });

  it("maps any APPROVED qualification (any difficulty) to isBooster, and leaves Lootbuddy false", async () => {
    const op = readOps().find((candidate) => candidate.id === BACKFILL_ID);
    if (!op?.execute?.length) throw new Error("backfill op missing from ops.json");

    for (const step of op.execute) await client.query(step.sql);
    // Idempotent: a second pass changes nothing.
    for (const step of op.execute) await client.query(step.sql);

    const byUser = await flags();
    for (const [user, scenario] of Object.entries(USERS)) {
      expect(byUser.get(user), `${user}: ${scenario.label}`).toEqual({
        isBooster: scenario.expected,
        isLootbuddy: false,
      });
    }

    for (const check of op.postcheck ?? []) {
      const result = await client.query<{ ok: boolean }>(check.sql);
      expect(result.rows[0]?.ok).toBe(true);
    }
  });
});
