import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTestDatabaseUrl } from "@/lib/test-database-guard";

const DEV_URL = "postgresql://user:pw@127.0.0.1:5433/boostting_bot";
const TEST_URL = "postgresql://user:pw@127.0.0.1:5433/boostting_bot_test_s3";

function configure(env: { test?: string; dev?: string; expected?: string }) {
  vi.stubEnv("TEST_DATABASE_URL", env.test ?? "");
  vi.stubEnv("DATABASE_URL", env.dev ?? DEV_URL);
  vi.stubEnv("TEST_DATABASE_EXPECTED_NAME", env.expected ?? "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveTestDatabaseUrl", () => {
  it("returns a dedicated test database URL", () => {
    configure({ test: TEST_URL });
    expect(resolveTestDatabaseUrl()).toBe(TEST_URL);
  });

  it("refuses a missing URL, the development URL, and a name without \"test\"", () => {
    configure({});
    expect(() => resolveTestDatabaseUrl()).toThrow(/TEST_DATABASE_URL is not set/);
    configure({ test: DEV_URL });
    expect(() => resolveTestDatabaseUrl()).toThrow(/identical to DATABASE_URL/);
    configure({ test: "postgresql://user:pw@127.0.0.1:5433/boostting_bot_copy" });
    expect(() => resolveTestDatabaseUrl()).toThrow(/does not look like a test database/);
  });

  it("with TEST_DATABASE_EXPECTED_NAME, accepts only that database", () => {
    configure({ test: TEST_URL, expected: "boostting_bot_test_s3" });
    expect(resolveTestDatabaseUrl()).toBe(TEST_URL);

    configure({ test: "postgresql://user:pw@127.0.0.1:5433/boostting_bot_test", expected: "boostting_bot_test_s3" });
    expect(() => resolveTestDatabaseUrl()).toThrow(/requires "boostting_bot_test_s3"/);
  });
});
