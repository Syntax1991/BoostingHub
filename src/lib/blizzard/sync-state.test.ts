import { describe, expect, it } from "vitest";
import { deriveBlizzardSyncState } from "@/lib/blizzard/sync-state";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const options = { now: NOW, staleMinutes: 120 };

describe("deriveBlizzardSyncState", () => {
  it("not linked", () => {
    expect(deriveBlizzardSyncState({ blizzardLinked: false, isActive: true, lastSyncedAt: null, createdAt: minutesAgo(999) }, options)).toEqual({
      kind: "NOT_LINKED",
    });
  });

  it("never synced: waiting at first, then profile unavailable once retries had time to run", () => {
    expect(deriveBlizzardSyncState({ blizzardLinked: true, isActive: true, lastSyncedAt: null, createdAt: minutesAgo(5) }, options)).toEqual({
      kind: "AWAITING_FIRST_SYNC",
    });
    expect(deriveBlizzardSyncState({ blizzardLinked: true, isActive: true, lastSyncedAt: null, createdAt: minutesAgo(60) }, options)).toEqual({
      kind: "PROFILE_UNAVAILABLE",
    });
    // Inactive characters are not scheduled — no failed retries to report.
    expect(deriveBlizzardSyncState({ blizzardLinked: true, isActive: false, lastSyncedAt: null, createdAt: minutesAgo(60) }, options)).toEqual({
      kind: "AWAITING_FIRST_SYNC",
    });
  });

  it("previously synced: fine within the stale window + grace, failing (last good data) after", () => {
    expect(deriveBlizzardSyncState({ blizzardLinked: true, isActive: true, lastSyncedAt: minutesAgo(130), createdAt: minutesAgo(999) }, options)).toEqual({
      kind: "SYNCED",
      lastSyncedAt: minutesAgo(130),
    });
    expect(deriveBlizzardSyncState({ blizzardLinked: true, isActive: true, lastSyncedAt: minutesAgo(200), createdAt: minutesAgo(999) }, options)).toEqual({
      kind: "STALE",
      lastSyncedAt: minutesAgo(200),
    });
  });
});
