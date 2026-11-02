import { describe, expect, it } from "vitest";
import {
  characterSyncBackoffMs,
  formatRetryIn,
  isInSchedulerBackoff,
  resolveCharacterSyncRetryAt,
} from "@/lib/blizzard/sync-backoff";

const HOUR = 60 * 60_000;
const ATTEMPT = "2026-09-26T12:00:00.000Z";
const at = (offsetMs: number) => new Date(new Date(ATTEMPT).getTime() + offsetMs);

describe("characterSyncBackoffMs — progressive tiers (PROFILE_UNAVAILABLE)", () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, HOUR],
    [5, HOUR],
    [6, 6 * HOUR],
    [9, 6 * HOUR],
    [10, 24 * HOUR],
    [500, 24 * HOUR],
  ])("%i consecutive failures → %i ms", (count, expected) => {
    expect(characterSyncBackoffMs(count, "PROFILE_UNAVAILABLE")).toBe(expected);
  });

  it("identity and name conflicts are persistent: same progressive tiers", () => {
    for (const code of ["IDENTITY_CONFLICT", "NAME_CONFLICT"] as const) {
      expect(characterSyncBackoffMs(3, code)).toBe(HOUR);
      expect(characterSyncBackoffMs(6, code)).toBe(6 * HOUR);
      expect(characterSyncBackoffMs(10, code)).toBe(24 * HOUR);
    }
  });

  it("transient categories (UPSTREAM_UNAVAILABLE, INTERNAL) back off at most 1h", () => {
    for (const code of ["UPSTREAM_UNAVAILABLE", "INTERNAL"] as const) {
      expect(characterSyncBackoffMs(2, code)).toBe(0);
      expect(characterSyncBackoffMs(3, code)).toBe(HOUR);
      expect(characterSyncBackoffMs(10, code)).toBe(HOUR);
      expect(characterSyncBackoffMs(500, code)).toBe(HOUR);
    }
  });

  it("RATE_LIMITED (whole-run 429 stop) and AUTH_OR_CONFIG (system issue) never back off a Character", () => {
    for (const code of ["RATE_LIMITED", "AUTH_OR_CONFIG"] as const) {
      expect(characterSyncBackoffMs(500, code)).toBe(0);
    }
  });

  it("no recorded error (after a success) means no backoff, whatever the counter", () => {
    expect(characterSyncBackoffMs(50, null)).toBe(0);
  });
});

describe("resolveCharacterSyncRetryAt / isInSchedulerBackoff", () => {
  const input = (syncFailureCount: number, lastSyncAttemptAt: string | null = ATTEMPT) => ({
    lastSyncAttemptAt,
    syncFailureCount,
    lastSyncErrorCode: "PROFILE_UNAVAILABLE" as const,
  });

  it("retryAt = last attempt + tier wait: 3 → 1h, 6 → 6h, 10 → 24h", () => {
    expect(resolveCharacterSyncRetryAt(input(3))?.toISOString()).toBe(at(HOUR).toISOString());
    expect(resolveCharacterSyncRetryAt(input(6))?.toISOString()).toBe(at(6 * HOUR).toISOString());
    expect(resolveCharacterSyncRetryAt(input(10))?.toISOString()).toBe(at(24 * HOUR).toISOString());
  });

  it("exact boundary: backed off until retryAt, eligible AT retryAt", () => {
    expect(isInSchedulerBackoff(input(3), at(HOUR - 1))).toBe(true);
    expect(isInSchedulerBackoff(input(3), at(HOUR))).toBe(false);
    expect(isInSchedulerBackoff(input(10), at(24 * HOUR - 1))).toBe(true);
    expect(isInSchedulerBackoff(input(10), at(24 * HOUR))).toBe(false);
  });

  it("below the first tier, or without an attempt time, there is no backoff", () => {
    expect(resolveCharacterSyncRetryAt(input(2))).toBeNull();
    expect(resolveCharacterSyncRetryAt(input(10, null))).toBeNull();
    expect(isInSchedulerBackoff(input(2), at(1))).toBe(false);
  });
});

describe("formatRetryIn", () => {
  it.each([
    [30_000, "<1m"],
    [7 * 60_000, "7m"],
    [HOUR, "1h"],
    [2 * HOUR + 5 * 60_000, "2h 5m"],
    [18 * HOUR, "18h"],
  ])("%i ms → %s", (ms, label) => {
    expect(formatRetryIn(ms)).toBe(label);
  });
});
