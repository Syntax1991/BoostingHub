/**
 * Pure evaluation of `prisma migration status --json` for the `predev` guard
 * (scripts/check-dev-db-schema.ts). Read-only by design: it tells the developer
 * what to run, it never migrates, signs or resets anything itself — applying
 * migrations to a shared database from whatever branch happens to be checked out
 * is exactly how the development database once fell off the migration history.
 */

type StatusMigration = { name?: string; status?: string };
type StatusSpace = {
  space?: string;
  currentContract?: string | null;
  targetContract?: string | null;
  migrations?: StatusMigration[];
};
type StatusDiagnostic = { code?: string; severity?: string; message?: string };

/** The `envelope` of the CLI's final `{"kind":"result"}` line. */
export type MigrationStatusEnvelope = {
  ok?: boolean;
  error?: { code?: string; message?: string };
  code?: string;
  message?: string;
  diagnostics?: StatusDiagnostic[];
  result?: {
    summary?: string;
    spaces?: StatusSpace[];
    diagnostics?: StatusDiagnostic[];
  };
};

export type DevDbSchemaVerdict =
  | { ok: true }
  | {
      ok: false;
      kind: "unreachable" | "behind" | "off-history" | "unknown";
      summary: string;
      /** Pending migration directory names, oldest first (only for "behind"). */
      pending: string[];
      /** What the developer should do next. */
      instructions: string[];
    };

const OFF_HISTORY_CODES = new Set([
  "MIGRATION.NO_MARKER",
  "MIGRATION.MARKER_NOT_IN_HISTORY",
  "MIGRATION.DIVERGED",
  "CONTRACT.AHEAD",
  "CONTRACT.UNREADABLE",
]);

export function evaluateMigrationStatus(envelope: MigrationStatusEnvelope | null | undefined): DevDbSchemaVerdict {
  if (!envelope) {
    return {
      ok: false,
      kind: "unknown",
      summary: "`prisma migration status` produced no result.",
      pending: [],
      instructions: ["Run `npm run db:status` to see the full output."],
    };
  }

  if (envelope.ok === false) {
    const code = envelope.error?.code ?? envelope.code ?? "";
    const unreachable = code.startsWith("DRIVER.") || code === "PN-CLI-4005";
    return {
      ok: false,
      kind: unreachable ? "unreachable" : "unknown",
      summary: unreachable
        ? `The development database is not reachable (${code}).`
        : `\`prisma migration status\` failed${code ? ` (${code})` : ""}.`,
      pending: [],
      instructions: unreachable
        ? ["Start the development Postgres and check DATABASE_URL in .env."]
        : ["Run `npm run db:status` to see the full output."],
    };
  }

  const diagnostics = [...(envelope.diagnostics ?? []), ...(envelope.result?.diagnostics ?? [])];
  const offHistory = diagnostics.find((diagnostic) => diagnostic.code && OFF_HISTORY_CODES.has(diagnostic.code));
  if (offHistory) {
    const neverInitialised = offHistory.code === "MIGRATION.NO_MARKER";
    return {
      ok: false,
      kind: "off-history",
      summary: `${offHistory.code}: ${offHistory.message ?? envelope.result?.summary ?? "database is off the committed migration history"}`,
      pending: [],
      instructions: neverInitialised
        ? ["Initialise it with the committed migrations: `npm run db:migrate` (then optionally `npm run db:seed`)."]
        : [
            "The database was changed outside the committed migrations (e.g. a branch's draft migration was applied).",
            "Do NOT run `prisma db update` on it: it diffs tables and skips the migrations' data steps.",
            "Follow docs/development.md → \"Development database off the migration history\".",
          ],
    };
  }

  const spaces = envelope.result?.spaces ?? [];
  const pending = spaces.flatMap((space) =>
    (space.migrations ?? []).filter((migration) => migration.status === "pending").map((migration) => migration.name ?? "?"),
  );
  const drifted = spaces.some(
    (space) => space.targetContract != null && space.currentContract !== space.targetContract,
  );
  if (pending.length > 0 || drifted) {
    return {
      ok: false,
      kind: "behind",
      summary: `The development database is behind the code: ${pending.length || "unknown number of"} pending migration(s).`,
      pending: [...pending].sort(),
      instructions: ["Apply the committed migrations: `npm run db:migrate` (non-destructive to existing rows)."],
    };
  }

  return { ok: true };
}

/** `host:port/database` of a connection string — never user or password. */
export function describeDatabaseTarget(url: string | undefined): string {
  if (!url) return "(DATABASE_URL is not set)";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

/** Last `{"kind":"result"}` line of the CLI's JSON-lines output. */
export function parseMigrationStatusOutput(output: string): MigrationStatusEnvelope | null {
  let envelope: MigrationStatusEnvelope | null = null;
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.includes('"kind":"result"')) continue;
    try {
      const parsed = JSON.parse(trimmed) as { envelope?: MigrationStatusEnvelope };
      if (parsed.envelope) envelope = parsed.envelope;
    } catch {
      // Not a result line.
    }
  }
  return envelope;
}
