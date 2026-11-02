import { describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/errors";
import { classifySyncError, isRetryableSyncError, logCharacterSyncFailure } from "@/lib/blizzard/sync-error";
import { CHARACTER_SYNC_ERROR_CODES } from "@/models/enums";

const domain = (code: ConstructorParameters<typeof DomainError>[0], cause?: unknown) =>
  new DomainError(code, "message", 400, cause === undefined ? undefined : { cause });

describe("classifySyncError", () => {
  it.each([
    ["BLIZZARD_PROFILE_UNAVAILABLE", "PROFILE_UNAVAILABLE"],
    ["BLIZZARD_CHARACTER_NOT_FOUND", "PROFILE_UNAVAILABLE"],
    ["BLIZZARD_IDENTITY_CONFLICT", "IDENTITY_CONFLICT"],
    ["CHARACTER_ALREADY_EXISTS", "NAME_CONFLICT"],
    ["INVALID_CHARACTER_NAME", "NAME_CONFLICT"],
    ["BATTLENET_RATE_LIMITED", "RATE_LIMITED"],
    ["BATTLENET_API_UNAVAILABLE", "UPSTREAM_UNAVAILABLE"],
    ["BATTLENET_AUTH_FAILED", "AUTH_OR_CONFIG"],
    ["BATTLENET_NOT_CONFIGURED", "AUTH_OR_CONFIG"],
  ] as const)("%s → %s", (code, category) => {
    expect(classifySyncError(domain(code))).toBe(category);
  });

  it("recovers the original category from a generic BLIZZARD_SYNC_FAILED wrapper", () => {
    expect(classifySyncError(domain("BLIZZARD_SYNC_FAILED", domain("BATTLENET_API_UNAVAILABLE")))).toBe("UPSTREAM_UNAVAILABLE");
    expect(classifySyncError(domain("BLIZZARD_SYNC_FAILED", domain("BATTLENET_AUTH_FAILED")))).toBe("AUTH_OR_CONFIG");
  });

  it("a generic wrapper around nothing specific, plain errors and non-errors are INTERNAL", () => {
    expect(classifySyncError(domain("BLIZZARD_SYNC_FAILED"))).toBe("INTERNAL");
    expect(classifySyncError(domain("BLIZZARD_SYNC_FAILED", new Error("socket")))).toBe("INTERNAL");
    expect(classifySyncError(new Error("database is down"))).toBe("INTERNAL");
    expect(classifySyncError("weird")).toBe("INTERNAL");
    expect(classifySyncError(null)).toBe("INTERNAL");
  });

  it("only ever returns a fixed category", () => {
    for (const input of [domain("BATTLENET_RATE_LIMITED"), new Error("token=abc"), { message: "Bearer xyz" }]) {
      expect(CHARACTER_SYNC_ERROR_CODES as readonly string[]).toContain(classifySyncError(input));
    }
  });

  it("retryable classification", () => {
    expect(isRetryableSyncError("RATE_LIMITED")).toBe(true);
    expect(isRetryableSyncError("UPSTREAM_UNAVAILABLE")).toBe(true);
    expect(isRetryableSyncError("PROFILE_UNAVAILABLE")).toBe(true);
    expect(isRetryableSyncError("IDENTITY_CONFLICT")).toBe(false);
    expect(isRetryableSyncError("AUTH_OR_CONFIG")).toBe(false);
  });
});

describe("logCharacterSyncFailure", () => {
  it("writes exactly the safe fields", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logCharacterSyncFailure({ category: "UPSTREAM_UNAVAILABLE", trigger: "SCHEDULED", region: "EU" });
    logCharacterSyncFailure({ category: "RATE_LIMITED", trigger: "SCHEDULED", region: "US" });
    expect(warn.mock.calls.map((call) => JSON.parse(String(call[0])))).toEqual([
      { event: "character_sync_failed", errorCategory: "UPSTREAM_UNAVAILABLE", trigger: "SCHEDULED", region: "EU", rateLimited: false, retryable: true },
      { event: "character_sync_rate_limited", errorCategory: "RATE_LIMITED", trigger: "SCHEDULED", region: "US", rateLimited: true, retryable: true },
    ]);
    warn.mockRestore();
  });
});
