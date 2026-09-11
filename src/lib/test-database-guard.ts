/**
 * Single source of truth for "is it safe to point automated tests at this
 * database". Shared by the runtime connection pool (pg-pool.ts, so every
 * repository/service/Better Auth query is automatically isolated whenever
 * the process is a test run) and scripts/test-db-reset.ts (so the
 * destructive reset can never land on DATABASE_URL). Keeping the check in
 * one place means the two can never drift apart.
 */
export function isTestRuntime(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

/**
 * Throws with a clear, actionable message rather than ever falling back to
 * DATABASE_URL. Checked in order: present, not identical to DATABASE_URL,
 * and — as defense in depth, never the only check — names something that
 * looks like a test database.
 */
export function resolveTestDatabaseUrl(): string {
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  const devUrl = process.env.DATABASE_URL?.trim();

  if (!testUrl) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Automated tests must run against a dedicated test " +
        "database and must never fall back to DATABASE_URL. Set TEST_DATABASE_URL in .env " +
        "to a separate PostgreSQL database (see .env.example).",
    );
  }

  if (testUrl === devUrl) {
    throw new Error(
      "TEST_DATABASE_URL is identical to DATABASE_URL. Automated tests would run — and a " +
        "reset would wipe — the real development/QA database. Point TEST_DATABASE_URL at a " +
        "separate database (see .env.example).",
    );
  }

  if (!/test/i.test(testUrl)) {
    throw new Error(
      'TEST_DATABASE_URL does not look like a test database (its connection string does ' +
        'not contain "test", e.g. boostinghub_test). This is a safety check on top of the ' +
        "DATABASE_URL equality check, to catch a misconfigured URL before it's used " +
        "destructively — if this is genuinely a dedicated test database, include \"test\" " +
        "in its name.",
    );
  }

  return testUrl;
}
