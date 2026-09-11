import "dotenv/config";
import { Pool } from "pg";
import { isTestRuntime, resolveTestDatabaseUrl } from "@/lib/test-database-guard";

/**
 * Shared node-postgres pool for Better Auth (Kysely) and Prisma 8.
 *
 * Separate default pools both default to max=10. Hosted Postgres often allows
 * about that many backends total, so Auth can hold every connection idle while
 * Prisma waits forever — the document request never completes.
 *
 * Keep this module a singleton (including HMR) so Next.js reloads do not leak
 * additional pools. connectionTimeoutMillis makes a saturated pool fail the
 * request instead of spinning the browser indefinitely.
 *
 * This is the ONLY place that reads DATABASE_URL — every repository,
 * service, and Better Auth query goes through this one pool, so isolating
 * automated tests onto TEST_DATABASE_URL here (rather than in each
 * repository) makes it impossible for a test to accidentally reach the real
 * development/QA database. isTestRuntime() is true under Vitest (which sets
 * VITEST=true) or any explicit NODE_ENV=test — in either case this throws
 * rather than silently falling back to DATABASE_URL if no test database is
 * configured.
 */
const databaseUrl = isTestRuntime() ? resolveTestDatabaseUrl() : process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const connectionString = databaseUrl;
const useSsl = connectionString.includes("sslmode=");

const globalForPg = globalThis as unknown as { pgPool?: Pool };

function createPool() {
  const pool = new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on("error", (error) => {
    console.error("PostgreSQL pool error", error.message);
  });
  return pool;
}

export const pgPool = globalForPg.pgPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalForPg.pgPool = pgPool;
}
