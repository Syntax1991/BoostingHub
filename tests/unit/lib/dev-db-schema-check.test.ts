import { describe, expect, it } from "vitest";
import {
  describeDatabaseTarget,
  evaluateMigrationStatus,
  parseMigrationStatusOutput,
  type MigrationStatusEnvelope,
} from "@/lib/dev-db-schema-check";

/** Envelopes shaped like real `prisma migration status --json` results (captured 2026-09-29). */
const HEAD = "4d4ce8b1eda059f6bcc34ae981987dc111d1f3ab69fd262ce0343b9b8130d144";

function space(current: string | null, statuses: Array<[string, "applied" | "pending"]>) {
  return {
    space: "app",
    currentContract: current,
    targetContract: HEAD,
    migrations: statuses.map(([name, status]) => ({ name, status })),
  };
}

const upToDate: MigrationStatusEnvelope = {
  ok: true,
  diagnostics: [],
  result: { summary: "Up to date", diagnostics: [], spaces: [space(HEAD, [["20260929T1329_add_run_lootbuddy_target", "applied"]])] },
};

const behind: MigrationStatusEnvelope = {
  ok: true,
  diagnostics: [],
  result: {
    summary: "1 pending — run `{bin} db migrate --to 4d4ce8b1eda0`",
    diagnostics: [],
    spaces: [
      space("e6e069169ebaa1f098a957c97a4912fab9e330a3d208587e250b8ea3f3a5a99e", [
        ["20260929T1329_add_run_lootbuddy_target", "pending"],
        ["20260928T2148_add_consumable_played_spec", "applied"],
      ]),
    ],
  },
};

const offHistory: MigrationStatusEnvelope = {
  ok: true,
  diagnostics: [
    {
      code: "MIGRATION.MARKER_NOT_IN_HISTORY",
      severity: "warn",
      message: 'Database was updated outside the migration system (marker for space "app" does not match any migration)',
    },
  ],
  result: { summary: "Database marker 01d44eac8cc7 is not in the on-disk migration graph", spaces: [] },
};

describe("evaluateMigrationStatus", () => {
  it("passes an up-to-date database", () => {
    expect(evaluateMigrationStatus(upToDate)).toEqual({ ok: true });
  });

  it("stops a database with pending migrations and says to run db:migrate", () => {
    const verdict = evaluateMigrationStatus(behind);
    expect(verdict).toMatchObject({ ok: false, kind: "behind", pending: ["20260929T1329_add_run_lootbuddy_target"] });
    expect(verdict.ok === false && verdict.instructions.join(" ")).toContain("npm run db:migrate");
  });

  it("treats a brand-new database (every migration pending) as behind", () => {
    const fresh = { ...behind, result: { ...behind.result, spaces: [space(null, [["20260908T1300_foundation", "pending"]])] } };
    expect(evaluateMigrationStatus(fresh)).toMatchObject({ ok: false, kind: "behind", pending: ["20260908T1300_foundation"] });
  });

  it("stops a database that is off the committed history — the incident — and warns against db update", () => {
    const verdict = evaluateMigrationStatus(offHistory);
    expect(verdict).toMatchObject({ ok: false, kind: "off-history" });
    const text = verdict.ok === false ? [verdict.summary, ...verdict.instructions].join(" ") : "";
    expect(text).toContain("MIGRATION.MARKER_NOT_IN_HISTORY");
    expect(text).toContain("Do NOT run `prisma db update`");
    expect(text).not.toContain("npm run db:migrate"); // migrate would refuse / is not the fix here
  });

  it("points an uninitialised database (no marker) at db:migrate", () => {
    const verdict = evaluateMigrationStatus({
      ok: true,
      diagnostics: [{ code: "MIGRATION.NO_MARKER", severity: "warn", message: "no marker" }],
      result: { spaces: [] },
    });
    expect(verdict).toMatchObject({ ok: false, kind: "off-history" });
    expect(verdict.ok === false && verdict.instructions.join(" ")).toContain("npm run db:migrate");
  });

  it("reports an unreachable database separately", () => {
    expect(evaluateMigrationStatus({ ok: false, error: { code: "DRIVER.CONNECTION_FAILED" } })).toMatchObject({
      ok: false,
      kind: "unreachable",
    });
  });

  it("never passes on missing or unexpected output", () => {
    expect(evaluateMigrationStatus(null)).toMatchObject({ ok: false, kind: "unknown" });
    expect(evaluateMigrationStatus({ ok: false, error: { code: "PN-MIG-9999" } })).toMatchObject({ ok: false, kind: "unknown" });
  });
});

describe("parseMigrationStatusOutput", () => {
  it("takes the result envelope from the CLI's JSON lines, ignoring progress lines and noise", () => {
    const output = [
      "Prisma agent skills are out of date",
      JSON.stringify({ kind: "step-started", step: "status" }),
      JSON.stringify({ kind: "result", envelope: upToDate }),
      "",
    ].join("\n");
    expect(parseMigrationStatusOutput(output)).toEqual(upToDate);
    expect(parseMigrationStatusOutput("not json at all")).toBeNull();
  });
});

describe("describeDatabaseTarget", () => {
  it("shows host, port and database name — never credentials", () => {
    const target = describeDatabaseTarget("postgresql://dev_user:s3cret@127.0.0.1:5433/boostting_bot?sslmode=disable");
    expect(target).toBe("127.0.0.1:5433/boostting_bot");
    expect(target).not.toContain("s3cret");
    expect(target).not.toContain("dev_user");
    expect(describeDatabaseTarget(undefined)).toBe("(DATABASE_URL is not set)");
  });
});
