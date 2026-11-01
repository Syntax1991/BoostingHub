import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import { assertSeedTargetAllowed, databaseNameOf } from "@/prisma/seed-guard";

const DEV_URL = "postgresql://dev:pw@127.0.0.1:5433/boostting_bot";

function outsideTestRuntime() {
  vi.stubEnv("VITEST", "");
  vi.stubEnv("NODE_ENV", "development");
}

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("seed target guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows a local database that is confirmed by its exact name", () => {
    outsideTestRuntime();
    expect(() =>
      assertSeedTargetAllowed(env({ DATABASE_URL: DEV_URL, SEED_CONFIRM_DATABASE: "boostting_bot" })),
    ).not.toThrow();
  });

  it("refuses without a confirmation", () => {
    outsideTestRuntime();
    expect(() => assertSeedTargetAllowed(env({ DATABASE_URL: DEV_URL }))).toThrow(/SEED_CONFIRM_DATABASE/);
  });

  it.each(["", "   ", "other_database", "boostting_bot_test", "BOOSTTING_BOT"])(
    "refuses the wrong confirmation %j",
    (confirmation) => {
      outsideTestRuntime();
      expect(() =>
        assertSeedTargetAllowed(env({ DATABASE_URL: DEV_URL, SEED_CONFIRM_DATABASE: confirmation })),
      ).toThrow(/Refusing/);
    },
  );

  it("refuses NODE_ENV=production even with a matching confirmation", () => {
    outsideTestRuntime();
    expect(() =>
      assertSeedTargetAllowed(
        env({ NODE_ENV: "production", DATABASE_URL: DEV_URL, SEED_CONFIRM_DATABASE: "boostting_bot" }),
      ),
    ).toThrow(/NODE_ENV is production/);
  });

  it("refuses the production database on localhost without NODE_ENV, even when confirmed", () => {
    outsideTestRuntime();
    expect(() =>
      assertSeedTargetAllowed(
        env({
          DATABASE_URL: "postgresql://app:pw@127.0.0.1:5432/boostinghub",
          SEED_CONFIRM_DATABASE: "boostinghub",
        }),
      ),
    ).toThrow(/production database/);
  });

  it("refuses a remote database even when confirmed", () => {
    outsideTestRuntime();
    expect(() =>
      assertSeedTargetAllowed(
        env({ DATABASE_URL: "postgresql://a:b@db.example.com:5432/other", SEED_CONFIRM_DATABASE: "other" }),
      ),
    ).toThrow(/not on this computer/);
  });

  it.each([undefined, "", "not a url", "postgresql://a:b@127.0.0.1:5432/"])(
    "refuses an unreadable target %j",
    (url) => {
      outsideTestRuntime();
      expect(() => assertSeedTargetAllowed(env({ DATABASE_URL: url, SEED_CONFIRM_DATABASE: "x" }))).toThrow(
        /could not be determined/,
      );
    },
  );

  it("never repeats credentials in its message", () => {
    outsideTestRuntime();
    let message = "";
    try {
      assertSeedTargetAllowed(env({ DATABASE_URL: "postgresql://someuser:s3cretvalue@127.0.0.1:5432/some_db" }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("some_db");
    expect(message).not.toMatch(/someuser|s3cretvalue/);
  });

  it("checks the test database when running under the test runtime", () => {
    vi.stubEnv("VITEST", "true");
    vi.stubEnv("DATABASE_URL", DEV_URL);
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://t:pw@127.0.0.1:5433/sample_test");
    expect(() => assertSeedTargetAllowed(env({ SEED_CONFIRM_DATABASE: "boostting_bot" }))).toThrow(/sample_test/);
    expect(() => assertSeedTargetAllowed(env({ SEED_CONFIRM_DATABASE: "sample_test" }))).not.toThrow();
  });

  it("reads database names without user or password", () => {
    expect(databaseNameOf("postgresql://u:p@h:1/my_db?sslmode=require")).toBe("my_db");
    expect(databaseNameOf("nonsense")).toBeNull();
    expect(databaseNameOf(undefined)).toBeNull();
  });

  it("guards the wipe before its first delete", () => {
    const source = readFileSync("src/prisma/seed-wipe.ts", "utf8");
    const guard = source.indexOf("assertSeedTargetAllowed();");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(source.indexOf(".delete()"));
    expect(readFileSync("src/prisma/seed.ts", "utf8")).toMatch(/async function seed\(\) \{\s+await wipeSeedDatabase\(\);/);
  });

  it("stops the real seed command before any database connection", () => {
    // Port 1 has no database. Reaching the wipe would report a connection error, not the refusal.
    const result = spawnSync("npm run db:seed", {
      shell: true,
      encoding: "utf8",
      env: {
        ...process.env,
        VITEST: "",
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://nobody:nothing@127.0.0.1:1/boostinghub",
        SEED_CONFIRM_DATABASE: "",
      },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/Refusing to run the seed.*production database/);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/ECONNREFUSED/);
  });
});
