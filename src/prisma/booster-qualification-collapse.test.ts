import { readFileSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgPool } from "@/lib/pg-pool";

/**
 * Runs the exact collapse SQL shipped in the account_level_booster_qualification
 * migration (ops.json) against the PREVIOUS table shape (User + Difficulty rows).
 *
 * The live test database is already on the new contract (one row per User, no
 * difficulty column), so the old shape is recreated as a session-local TEMP
 * table: unqualified "booster_qualification" in the migration SQL resolves to
 * pg_temp first, leaving the real table untouched.
 */
const MIGRATION_DIR = path.resolve(
  process.cwd(),
  "migrations/app/20260927T1206_account_level_booster_qualification",
);

type RawStep = { sql: string };
type RawOp = { id: string; execute?: RawStep[]; postcheck?: RawStep[] };

function collapseOp(): RawOp {
  const ops = JSON.parse(readFileSync(path.join(MIGRATION_DIR, "ops.json"), "utf-8")) as RawOp[];
  const index = ops.findIndex((candidate) => candidate.id === "data_migration.collapse-booster-qualification-to-account-level");
  const op = ops[index];
  if (!op?.execute?.length) throw new Error("collapse op missing from ops.json");
  // Must run before the (userId) unique constraint is added and the difficulty column dropped.
  const uniqueIndex = ops.findIndex((candidate) => candidate.id === "unique.booster_qualification.booster_qualification_userId_key");
  const dropColumnIndex = ops.findIndex((candidate) => candidate.id === "dropColumn.booster_qualification.difficulty");
  expect(index).toBeLessThan(uniqueIndex);
  expect(index).toBeLessThan(dropColumnIndex);
  return op;
}

type Status = "APPROVED" | "REVOKED";
type Difficulty = "NORMAL" | "HEROIC" | "MYTHIC";

const USERS = {
  a: "normal approved",
  b: "heroic approved",
  c: "mythic approved",
  d: "normal + heroic approved",
  e: "all three approved",
  f: "only revoked",
  g: "one approved + one revoked",
} as const;
type UserKey = keyof typeof USERS;

const FIXTURES: Array<{ id: string; user: UserKey; difficulty: Difficulty; status: Status; at: string }> = [
  { id: "a-n", user: "a", difficulty: "NORMAL", status: "APPROVED", at: "2026-01-01" },
  { id: "b-h", user: "b", difficulty: "HEROIC", status: "APPROVED", at: "2026-01-01" },
  { id: "c-m", user: "c", difficulty: "MYTHIC", status: "APPROVED", at: "2026-01-01" },
  { id: "d-n", user: "d", difficulty: "NORMAL", status: "APPROVED", at: "2026-01-01" },
  { id: "d-h", user: "d", difficulty: "HEROIC", status: "APPROVED", at: "2026-02-01" },
  { id: "e-n", user: "e", difficulty: "NORMAL", status: "APPROVED", at: "2026-01-01" },
  { id: "e-h", user: "e", difficulty: "HEROIC", status: "APPROVED", at: "2026-01-02" },
  { id: "e-m", user: "e", difficulty: "MYTHIC", status: "APPROVED", at: "2026-01-03" },
  { id: "f-n", user: "f", difficulty: "NORMAL", status: "REVOKED", at: "2026-03-01" },
  { id: "f-m", user: "f", difficulty: "MYTHIC", status: "REVOKED", at: "2026-03-05" },
  // The REVOKED row is the most recent one — APPROVED must still win.
  { id: "g-h", user: "g", difficulty: "HEROIC", status: "APPROVED", at: "2026-01-01" },
  { id: "g-m", user: "g", difficulty: "MYTHIC", status: "REVOKED", at: "2026-04-01" },
];

let client: PoolClient;

async function rowsByUser(): Promise<Map<string, Array<{ id: string; status: Status }>>> {
  const result = await client.query<{ id: string; userId: string; status: Status }>(
    `SELECT "id", "userId", "status" FROM pg_temp."booster_qualification" ORDER BY "id"`,
  );
  const map = new Map<string, Array<{ id: string; status: Status }>>();
  for (const row of result.rows) {
    const list = map.get(row.userId) ?? [];
    list.push({ id: row.id, status: row.status });
    map.set(row.userId, list);
  }
  return map;
}

beforeAll(async () => {
  client = await pgPool.connect();
  await client.query(`
    CREATE TEMP TABLE "booster_qualification" (
      "id" text PRIMARY KEY,
      "userId" text NOT NULL,
      "difficulty" text NOT NULL,
      "status" text NOT NULL,
      "grantedAt" timestamptz,
      "revokedAt" timestamptz,
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      UNIQUE ("userId", "difficulty")
    )
  `);
  for (const row of FIXTURES) {
    await client.query(
      `INSERT INTO pg_temp."booster_qualification" ("id", "userId", "difficulty", "status", "grantedAt", "revokedAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        row.id,
        row.user,
        row.difficulty,
        row.status,
        row.status === "APPROVED" ? row.at : "2025-12-01",
        row.status === "REVOKED" ? row.at : null,
      ],
    );
  }
});

afterAll(async () => {
  await client?.query(`DROP TABLE IF EXISTS pg_temp."booster_qualification"`);
  client?.release();
});

describe("migration: collapse BoosterQualification to one account-level row per User", () => {
  it("keeps every approved booster approved, collapses duplicates, and keeps revoked-only users not approved", async () => {
    const op = collapseOp();
    for (const step of op.execute!) await client.query(step.sql);
    // Idempotent: a second pass changes nothing.
    for (const step of op.execute!) await client.query(step.sql);

    const byUser = await rowsByUser();
    // No duplicate qualification rows remain.
    for (const rows of byUser.values()) expect(rows).toHaveLength(1);
    expect([...byUser.keys()].sort()).toEqual(Object.keys(USERS).sort());

    const status = (user: UserKey) => byUser.get(user)?.[0]?.status;
    expect(status("a")).toBe("APPROVED");
    expect(status("b")).toBe("APPROVED");
    expect(status("c")).toBe("APPROVED");
    expect(status("d")).toBe("APPROVED");
    expect(status("e")).toBe("APPROVED");
    expect(status("f")).toBe("REVOKED");
    expect(status("g")).toBe("APPROVED");

    // Among several approvals, the most recently granted row is kept.
    expect(byUser.get("d")?.[0]?.id).toBe("d-h");
    expect(byUser.get("e")?.[0]?.id).toBe("e-m");
    expect(byUser.get("g")?.[0]?.id).toBe("g-h");

    for (const check of op.postcheck ?? []) {
      const result = await client.query<{ ok: boolean }>(check.sql);
      expect(result.rows[0]?.ok).toBe(true);
    }

    // The new (userId) uniqueness now holds on the collapsed data.
    await expect(
      client.query(`ALTER TABLE pg_temp."booster_qualification" ADD CONSTRAINT bq_tmp_user_key UNIQUE ("userId")`),
    ).resolves.toBeDefined();
  });
});
