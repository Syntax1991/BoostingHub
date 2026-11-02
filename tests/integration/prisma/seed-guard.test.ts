import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ConnectionParameters from "pg/lib/connection-parameters";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertConnectedDatabaseMatches, assertSeedTargetAllowed, databaseNameOf } from "@/prisma/seed-guard";

const DEV_URL = "postgresql://dev:pw@127.0.0.1:5433/boostting_bot";
function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

const CONFIRMED = env({ SEED_CONFIRM_DATABASE: "boostting_bot" });

describe("seed target guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows a local database that is confirmed by its exact name, and returns it", () => {
    expect(assertSeedTargetAllowed(DEV_URL, CONFIRMED)).toBe("boostting_bot");
  });

  it.each([
    "postgres://dev:pw@localhost:5432/boostting_bot?sslmode=require",
    "postgresql://dev:pw@127.0.0.1/boostting_bot",
    "postgresql://dev:pw@[::1]:5433/boostting_bot",
    "postgresql://dev:pw@127.0.0.1:5433/boostting_bot?application_name=seed",
  ])("keeps the normal local form %s working", (url) => {
    expect(assertSeedTargetAllowed(url, CONFIRMED)).toBe("boostting_bot");
  });

  it("refuses without a confirmation", () => {
    expect(() => assertSeedTargetAllowed(DEV_URL, env({}))).toThrow(/SEED_CONFIRM_DATABASE/);
  });

  it.each(["", "   ", "other_database", "boostting_bot_test", "BOOSTTING_BOT"])(
    "refuses the wrong confirmation %j",
    (confirmation) => {
      expect(() => assertSeedTargetAllowed(DEV_URL, env({ SEED_CONFIRM_DATABASE: confirmation }))).toThrow(/Refusing/);
    },
  );

  it("refuses NODE_ENV=production even with a matching confirmation", () => {
    expect(() =>
      assertSeedTargetAllowed(DEV_URL, env({ NODE_ENV: "production", SEED_CONFIRM_DATABASE: "boostting_bot" })),
    ).toThrow(/NODE_ENV is production/);
  });

  it.each(["boostinghub", "BOOSTINGHUB", "BoostingHub", "%62oostinghub"])(
    "refuses the production database as %s on localhost, even when confirmed",
    (name) => {
      expect(() =>
        assertSeedTargetAllowed(
          `postgresql://app:pw@127.0.0.1:5432/${name}`,
          env({ SEED_CONFIRM_DATABASE: decodeURIComponent(name) }),
        ),
      ).toThrow(/production database/);
    },
  );

  it.each(["host", "hostaddr", "port", "database", "dbname", "db", "user", "password", "options", "service", "servicefile", "passfile", "target_session_attrs", "replication", "client_encoding", "ssl", "HOST", "h%6Fst", "Port"])(
    "refuses the connection parameter %s",
    (key) => {
      expect(() => assertSeedTargetAllowed(`${DEV_URL}?${key}=db.example.com`, CONFIRMED)).toThrow(
        /Unsupported connection parameters/,
      );
    },
  );

  it("refuses an override placed after an allowed parameter", () => {
    expect(() => assertSeedTargetAllowed(`${DEV_URL}?sslmode=require&host=db.example.com`, CONFIRMED)).toThrow(
      /Unsupported connection parameters: host/,
    );
  });

  it.each([
    ["remote host", "postgresql://a:b@db.example.com:5432/boostting_bot"],
    ["other loopback address", "postgresql://a:b@127.0.0.2:5432/boostting_bot"],
    ["several hosts", "postgresql://a:b@127.0.0.1,db.example.com:5432/boostting_bot"],
    ["user part that looks like a host", "postgresql://127.0.0.1@db.example.com/boostting_bot"],
    ["backslash trick", "postgresql://127.0.0.1\\@db.example.com/boostting_bot"],
    ["encoded socket host", "postgresql://a:b@%2Fvar%2Frun%2Fpostgresql/boostting_bot"],
    ["socket form", "socket:/var/run/postgresql?db=boostting_bot"],
    ["other protocol", "mysql://a:b@127.0.0.1/boostting_bot"],
    ["no host", "postgresql:///boostting_bot"],
  ])("refuses %s", (_name, url) => {
    expect(() => assertSeedTargetAllowed(url, CONFIRMED)).toThrow(/Refusing/);
  });

  it.each([undefined, "", "not a url", "postgresql://a:b@127.0.0.1:5432/", "postgresql://a:b@127.0.0.1:5432"])(
    "refuses an unreadable target %j",
    (url) => {
      expect(() => assertSeedTargetAllowed(url, CONFIRMED)).toThrow(/Refusing/);
    },
  );

  it.each(["two/parts", "with%20space", "with%2Fslash", "semi%3Bcolon", "quote%27"])(
    "refuses the unusual database name %s",
    (name) => {
      expect(() =>
        assertSeedTargetAllowed(
          `postgresql://a:b@127.0.0.1:5432/${name}`,
          env({ SEED_CONFIRM_DATABASE: decodeURIComponent(name) }),
        ),
      ).toThrow(/unsupported characters/);
    },
  );

  it("refuses an empty database even when PGDATABASE names one", () => {
    vi.stubEnv("PGDATABASE", "boostting_bot");
    expect(() => assertSeedTargetAllowed("postgresql://a:b@127.0.0.1:5432/", CONFIRMED)).toThrow(/Refusing/);
  });

  it("refuses a missing host even when PGHOST is local", () => {
    vi.stubEnv("PGHOST", "127.0.0.1");
    expect(() => assertSeedTargetAllowed("postgresql:///boostting_bot", CONFIRMED)).toThrow(/Refusing/);
  });

  it("refuses connection options that come from the environment", () => {
    vi.stubEnv("PGOPTIONS", "-c search_path=other");
    expect(() => assertSeedTargetAllowed(DEV_URL, CONFIRMED)).toThrow(/options from the environment/);
  });

  it("ignores PGHOST and PGPORT only because the driver ignores them when the URL sets the target", () => {
    vi.stubEnv("PGHOST", "db.example.com");
    vi.stubEnv("PGPORT", "6000");
    expect(assertSeedTargetAllowed(DEV_URL, CONFIRMED)).toBe("boostting_bot");
    const driver = new ConnectionParameters(DEV_URL);
    expect([driver.host, driver.port, driver.database]).toEqual(["127.0.0.1", 5433, "boostting_bot"]);
  });

  it("refuses when PGPORT would redirect a URL without a port", () => {
    vi.stubEnv("PGPORT", "6000");
    expect(() => assertSeedTargetAllowed("postgresql://a:b@127.0.0.1/boostting_bot", CONFIRMED)).toThrow(
      /different target/,
    );
  });

  it("agrees with the driver on every target it allows", () => {
    for (const url of [DEV_URL, "postgres://a:b@localhost/boostting_bot?sslmode=require", "postgresql://a:b@[::1]:5433/boostting_bot"]) {
      expect(assertSeedTargetAllowed(url, CONFIRMED)).toBe(new ConnectionParameters(url).database);
    }
  });

  it("refuses when the open connection reports another database", () => {
    expect(() => assertConnectedDatabaseMatches("boostting_bot", "boostinghub")).toThrow(/open connection/);
    expect(() => assertConnectedDatabaseMatches("boostting_bot", null)).toThrow(/open connection/);
    expect(() => assertConnectedDatabaseMatches("boostting_bot", "boostting_bot")).not.toThrow();
  });

  it("never repeats credentials in its messages", () => {
    const urls = [
      "postgresql://someuser:s3cretvalue@127.0.0.1:5432/some_db",
      "postgresql://someuser:s3cretvalue@db.example.com:5432/some_db",
      "postgresql://someuser:s3cretvalue@127.0.0.1:5432/some_db?host=x",
      "postgresql://someuser:s3cretvalue@bad host/some_db",
    ];
    for (const url of urls) {
      let message = "";
      try {
        assertSeedTargetAllowed(url, env({}));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/Refusing/);
      expect(message).not.toMatch(/someuser|s3cretvalue/);
    }
  });

  it("reads database names without user or password", () => {
    expect(databaseNameOf("postgresql://u:p@h:1/my_db?sslmode=require")).toBe("my_db");
    expect(databaseNameOf("nonsense")).toBeNull();
    expect(databaseNameOf(undefined)).toBeNull();
  });

  it("checks the real connection string, and the open connection, before the first delete", () => {
    const source = readFileSync("src/prisma/seed-wipe.ts", "utf8");
    const guard = source.indexOf("assertSeedTargetAllowed(pgConnectionConfig.connectionString)");
    const connected = source.indexOf("assertConnectedDatabaseMatches(");
    const firstDelete = source.indexOf(".delete()");
    expect(guard).toBeGreaterThan(-1);
    expect(connected).toBeGreaterThan(guard);
    expect(firstDelete).toBeGreaterThan(connected);
    expect(readFileSync("src/prisma/seed.ts", "utf8")).toMatch(/async function seed\(\) \{\s+await wipeSeedDatabase\(\);/);
  });

  it.each([
    ["the production name", "postgresql://nobody:nothing@127.0.0.1:1/boostinghub", /production database/],
    ["a host override", "postgresql://nobody:nothing@127.0.0.1:1/boostting_bot?host=db.example.com", /Unsupported connection parameters: host/],
  ])("stops the real seed command on %s before any connection", (_name, url, reason) => {
    // Port 1 has no database. Reaching the wipe would report a connection error, not the refusal.
    const result = spawnSync("npm run db:seed", {
      shell: true,
      encoding: "utf8",
      env: { ...process.env, VITEST: "", NODE_ENV: "development", DATABASE_URL: url, SEED_CONFIRM_DATABASE: "boostting_bot" },
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toMatch(reason);
    expect(output).not.toMatch(/ECONNREFUSED|ENOTFOUND/);
    expect(output).not.toMatch(/nothing@/);
  });
});
