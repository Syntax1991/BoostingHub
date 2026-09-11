import "dotenv/config";
import { spawnSync } from "node:child_process";
import { resolveTestDatabaseUrl } from "@/lib/test-database-guard";

/**
 * Destructively resets and reseeds the dedicated automated-test database
 * (TEST_DATABASE_URL) — safe to do because it is never DATABASE_URL, enforced
 * by resolveTestDatabaseUrl(). Reuses the existing db:migrate/db:seed scripts
 * unmodified, just with DATABASE_URL overridden to the test URL for these two
 * child processes only; the real DATABASE_URL (and every other process using
 * it) is never touched.
 */
function maskCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "(unparseable URL)";
  }
}

function run(label: string, npmScript: string, env: NodeJS.ProcessEnv) {
  console.log(`\n> ${label} (npm run ${npmScript})`);
  // npmScript is always one of this file's own literals below, never
  // external input, so building one command string for `shell: true` (the
  // reliable way to resolve npm's .cmd shim on Windows) is safe — passing an
  // args array alongside shell:true is what Node's own docs warn against.
  const result = spawnSync(`npm run ${npmScript}`, {
    env,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    console.error(`\n${label} failed (exit code ${result.status ?? "unknown"}).`);
    process.exit(result.status ?? 1);
  }
}

const testUrl = resolveTestDatabaseUrl();

console.log("Resetting the automated-test database only — DATABASE_URL is never touched:");
console.log(`  ${maskCredentials(testUrl)}`);

const childEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testUrl };

run("Applying schema to the test database", "db:migrate", childEnv);
run("Seeding deterministic fixtures into the test database", "db:seed", childEnv);

console.log("\nTest database reset complete.");
