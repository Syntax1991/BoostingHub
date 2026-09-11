import "dotenv/config";
import { resolveTestDatabaseUrl } from "./src/lib/test-database-guard";

/**
 * Runs once, before any test file, in Vitest's main process. Fails the
 * entire run immediately and loudly if TEST_DATABASE_URL isn't configured
 * correctly, rather than letting individual DB-touching test files hit the
 * same problem one at a time (or, worse, a test file that happens not to
 * touch the database masking the misconfiguration entirely).
 */
export default function setup() {
  resolveTestDatabaseUrl();
}
