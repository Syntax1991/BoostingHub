import "dotenv/config";
import { spawnSync } from "node:child_process";
import {
  describeDatabaseTarget,
  evaluateMigrationStatus,
  parseMigrationStatusOutput,
} from "@/lib/dev-db-schema-check";

/**
 * `predev` guard: before `next dev` starts, check (read-only) that the database in
 * DATABASE_URL is on the committed migration history and current. A stale schema
 * otherwise only shows up deep in a request as `SqlQueryError: column … does not
 * exist`. Never migrates or changes anything; set SKIP_DEV_DB_SCHEMA_CHECK=1 to
 * bypass (e.g. offline UI work).
 */
const target = describeDatabaseTarget(process.env.DATABASE_URL);

if (process.env.SKIP_DEV_DB_SCHEMA_CHECK === "1") {
  console.warn(`[db-schema-check] skipped (SKIP_DEV_DB_SCHEMA_CHECK=1) — ${target} is NOT verified.`);
  process.exit(0);
}

const run = spawnSync("npx", ["prisma", "migration", "status", "--json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  env: process.env,
});
const verdict = evaluateMigrationStatus(parseMigrationStatusOutput(`${run.stdout ?? ""}\n${run.stderr ?? ""}`));

if (verdict.ok) {
  console.log(`[db-schema-check] ${target} is up to date with the committed migrations.`);
  process.exit(0);
}

const lines = [
  "",
  `[db-schema-check] ${target}: ${verdict.summary}`,
  ...(verdict.pending.length > 0 ? ["  Pending:", ...verdict.pending.map((name) => `    - ${name}`)] : []),
  ...verdict.instructions.map((line) => `  → ${line}`),
  "  (Read-only check; nothing was changed. SKIP_DEV_DB_SCHEMA_CHECK=1 bypasses it.)",
  "",
];
console.error(lines.join("\n"));
process.exit(1);
