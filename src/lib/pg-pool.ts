import "dotenv/config";
import { Pool } from "pg";

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
 */
const databaseUrl = process.env.DATABASE_URL;

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
