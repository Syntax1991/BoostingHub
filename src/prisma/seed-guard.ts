import ConnectionParameters from "pg/lib/connection-parameters";

/** Name of the production database. The seed never runs against it, whatever else is set. */
const PROTECTED_DATABASE_NAMES: ReadonlySet<string> = new Set(["boostinghub"]);
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Everything else in a URL query could change the target or session, so it is refused. */
const ALLOWED_QUERY_PARAMETERS: ReadonlySet<string> = new Set(["sslmode", "application_name"]);
const POSTGRES_PROTOCOLS: ReadonlySet<string> = new Set(["postgres:", "postgresql:"]);
const PLAIN_DATABASE_NAME = /^[A-Za-z0-9_-]+$/;
const DEFAULT_POSTGRES_PORT = 5432;

/** Database name in a connection string's path, or null when it cannot be read. Never user or password. */
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
 * Fails closed before the seed deletes anything, and returns the database it allowed.
 *
 * The production database also runs on localhost, and a shell on the server may not have
 * NODE_ENV set, so neither check is enough alone. The seed therefore needs an explicit
 * confirmation that names the exact target, which production's `.env` does not contain.
 *
 * Host, port and database are read through the driver's own ConnectionParameters and must
 * agree with the URL, because the driver lets query parameters and PG* variables override it.
 */
export function assertSeedTargetAllowed(
  connectionString: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.NODE_ENV === "production") refuse("NODE_ENV is production.");
  if (!connectionString) refuse("The target database could not be determined.");

  let url: URL;
  let driver: ConnectionParameters;
  try {
    url = new URL(connectionString);
    driver = new ConnectionParameters(connectionString);
  } catch {
    refuse("The target database could not be determined.");
  }

  if (!POSTGRES_PROTOCOLS.has(url.protocol)) refuse("Only postgres:// connection strings are supported.");

  const unsupported = [...new Set(url.searchParams.keys())].filter((key) => !ALLOWED_QUERY_PARAMETERS.has(key));
  if (unsupported.length > 0) refuse(`Unsupported connection parameters: ${unsupported.join(", ")}.`);
  if (driver.options || driver.replication) refuse("Connection options from the environment are not supported.");

  const database = databaseNameOf(connectionString);
  if (!database) refuse("The target database could not be determined.");
  if (!PLAIN_DATABASE_NAME.test(database)) refuse("The database name has unsupported characters.");

  // Without a port in the URL the target must be the default port, not one set by PGPORT.
  const urlPort = url.port ? Number(url.port) : DEFAULT_POSTGRES_PORT;
  if (driver.host !== url.hostname || driver.database !== database || driver.port !== urlPort) {
    refuse("The driver would connect to a different target than the URL shows.");
  }

  if (!LOCAL_HOSTS.has(driver.host)) refuse("The target database is not on this computer.");
  if (PROTECTED_DATABASE_NAMES.has(database.toLowerCase())) refuse(`"${database}" is the production database.`);
  if (env.SEED_CONFIRM_DATABASE?.trim() !== database) {
    refuse(`To seed "${database}" on purpose, set SEED_CONFIRM_DATABASE="${database}".`);
  }
  return database;
}

/** Last check, on the open connection: the server must report the database that was allowed. */
export function assertConnectedDatabaseMatches(allowed: string, connected: string | null | undefined): void {
  if (connected !== allowed) refuse("The open connection is not the allowed database.");
}
