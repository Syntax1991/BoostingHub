import { describe, expect, it } from "vitest";
import { deriveBlizzardSyncState, needsBattleNetIdentityRepair } from "@/lib/blizzard/sync-state";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const options = { now: NOW, staleMinutes: 120 };

describe("deriveBlizzardSyncState", () => {
  it("no attempt yet is awaiting, never unavailable (manual characters before their first public sync)", () => {
    expect(deriveBlizzardSyncState({ isActive: true, lastSyncedAt: null, lastSyncAttemptAt: null, createdAt: minutesAgo(999) }, options)).toEqual({
      kind: "AWAITING_FIRST_SYNC",
    });
  });

  it("never synced: waiting at first, then profile unavailable once retries had time to run", () => {
    expect(deriveBlizzardSyncState({ lastSyncAttemptAt: minutesAgo(1), isActive: true, lastSyncedAt: null, createdAt: minutesAgo(5) }, options)).toEqual({
      kind: "AWAITING_FIRST_SYNC",
    });
    expect(deriveBlizzardSyncState({ lastSyncAttemptAt: minutesAgo(1), isActive: true, lastSyncedAt: null, createdAt: minutesAgo(60) }, options)).toEqual({
      kind: "PROFILE_UNAVAILABLE",
    });
    // Inactive characters are not scheduled — no failed retries to report.
    expect(deriveBlizzardSyncState({ lastSyncAttemptAt: minutesAgo(1), isActive: false, lastSyncedAt: null, createdAt: minutesAgo(60) }, options)).toEqual({
      kind: "AWAITING_FIRST_SYNC",
    });
  });

  it("previously synced: fine within the stale window + grace, failing (last good data) after", () => {
    expect(deriveBlizzardSyncState({ lastSyncAttemptAt: minutesAgo(1), isActive: true, lastSyncedAt: minutesAgo(130), createdAt: minutesAgo(999) }, options)).toEqual({
      kind: "SYNCED",
      lastSyncedAt: minutesAgo(130),
    });
    expect(deriveBlizzardSyncState({ lastSyncAttemptAt: minutesAgo(1), isActive: true, lastSyncedAt: minutesAgo(200), createdAt: minutesAgo(999) }, options)).toEqual({
      kind: "STALE",
      lastSyncedAt: minutesAgo(200),
    });
  });
});

describe("needsBattleNetIdentityRepair", () => {
  const failing = {
    isActive: true,
    blizzardCharacterId: "183112661",
    lastSyncedAt: minutesAgo(3000),
    lastSyncErrorAt: minutesAgo(5),
    lastSyncErrorCode: "IDENTITY_CONFLICT" as const,
    syncFailureCount: 1,
  };

  it("an identity conflict on a linked, active Character asks for a Battle.net reconnect", () => {
    expect(needsBattleNetIdentityRepair(failing)).toBe(true);
  });

  it("a profile 404 only after repeated failures (one-off 404s are Blizzard propagation lag)", () => {
    const unavailable = { ...failing, lastSyncErrorCode: "PROFILE_UNAVAILABLE" as const };
    expect(needsBattleNetIdentityRepair({ ...unavailable, syncFailureCount: 2 })).toBe(false);
    expect(needsBattleNetIdentityRepair({ ...unavailable, syncFailureCount: 3 })).toBe(true);
  });

  it("never for manual, retired, recovered or otherwise failing Characters", () => {
    expect(needsBattleNetIdentityRepair({ ...failing, blizzardCharacterId: null })).toBe(false);
    expect(needsBattleNetIdentityRepair({ ...failing, isActive: false })).toBe(false);
    expect(needsBattleNetIdentityRepair({ ...failing, lastSyncedAt: minutesAgo(1) })).toBe(false);
    expect(needsBattleNetIdentityRepair({ ...failing, lastSyncErrorCode: "RATE_LIMITED" })).toBe(false);
  });
});
