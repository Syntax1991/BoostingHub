import { isTestRuntime, resolveTestDatabaseUrl } from "@/lib/test-database-guard";

/** Name of the production database. The seed never runs against it, whatever else is set. */
const PROTECTED_DATABASE_NAMES: ReadonlySet<string> = new Set(["boostinghub"]);
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Database name of a connection string, or null when it cannot be read. Never user or password. */
export function databaseNameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    return name || null;
  } catch {
    return null;
  }
}

function refuse(reason: string): never {
  throw new Error(`Refusing to run the seed, which wipes the database. Nothing was changed. ${reason}`);
}

/**
 * Fails closed before the seed deletes anything. The production database also runs on
 * localhost, and a shell on the server may not have NODE_ENV set, so neither check is enough
 * alone. The seed therefore needs an explicit confirmation that names the exact target,
 * which production's `.env` does not contain. Resolves the target like pg-pool.ts does.
 */
export function assertSeedTargetAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production") refuse("NODE_ENV is production.");

  const url = isTestRuntime() ? resolveTestDatabaseUrl() : env.DATABASE_URL;
  const database = databaseNameOf(url);
  if (!url || !database) refuse("The target database could not be determined.");

  if (!LOCAL_HOSTS.has(new URL(url).hostname)) refuse("The target database is not on this computer.");
  if (PROTECTED_DATABASE_NAMES.has(database)) refuse(`"${database}" is the production database.`);
  if (env.SEED_CONFIRM_DATABASE?.trim() !== database) {
    refuse(`To seed "${database}" on purpose, set SEED_CONFIRM_DATABASE="${database}".`);
  }
}
