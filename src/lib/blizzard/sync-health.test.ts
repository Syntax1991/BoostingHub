import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BLIZZARD_SYNC_RETRY_GRACE_MINUTES,
  deriveCharacterLinkage,
  deriveCharacterSyncHealth,
  deriveCharacterSyncStatus,
  isSuccessfulSyncStale,
  resolveSyncHealthStaleMinutes,
} from "@/lib/blizzard/sync-health";
import { deriveBlizzardSyncState } from "@/lib/blizzard/sync-state";

const NOW = new Date("2026-09-26T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const policy = { now: NOW, staleMinutes: 120 };

describe("deriveCharacterLinkage", () => {
  it("LINKED / NOT_LINKED / NO_CONNECTION", () => {
    expect(deriveCharacterLinkage({ blizzardCharacterId: "1", blizzardRealmId: "2", ownerHasRegionConnection: true })).toBe("LINKED");
    expect(deriveCharacterLinkage({ blizzardCharacterId: null, blizzardRealmId: null, ownerHasRegionConnection: true })).toBe("NOT_LINKED");
    expect(deriveCharacterLinkage({ blizzardCharacterId: "1", blizzardRealmId: null, ownerHasRegionConnection: true })).toBe("NOT_LINKED");
    expect(deriveCharacterLinkage({ blizzardCharacterId: "1", blizzardRealmId: "2", ownerHasRegionConnection: false })).toBe("NO_CONNECTION");
  });
});

describe("deriveCharacterSyncHealth — precedence ERROR > NEVER_SYNCED > STALE > HEALTHY", () => {
  it("HEALTHY: recent success, no newer failure", () => {
    expect(deriveCharacterSyncHealth({ lastSyncedAt: minutesAgo(5), lastSyncErrorAt: null }, policy)).toBe("HEALTHY");
  });

  it("ERROR: a failure 1 minute ago beats a success 5 minutes ago", () => {
    expect(deriveCharacterSyncHealth({ lastSyncedAt: minutesAgo(5), lastSyncErrorAt: minutesAgo(1) }, policy)).toBe("ERROR");
  });

  it("ERROR: failure and never a success", () => {
    expect(deriveCharacterSyncHealth({ lastSyncedAt: null, lastSyncErrorAt: minutesAgo(1) }, policy)).toBe("ERROR");
  });

  it("an older failure followed by a success is not an error", () => {
    expect(deriveCharacterSyncHealth({ lastSyncedAt: minutesAgo(1), lastSyncErrorAt: minutesAgo(5) }, policy)).toBe("HEALTHY");
  });

  it("NEVER_SYNCED: no success and no failure", () => {
    expect(deriveCharacterSyncHealth({ lastSyncedAt: null, lastSyncErrorAt: null }, policy)).toBe("NEVER_SYNCED");
  });

  it("STALE only after threshold + grace; the boundary itself is still HEALTHY", () => {
    const boundary = 120 + BLIZZARD_SYNC_RETRY_GRACE_MINUTES;
    expect(deriveCharacterSyncHealth({ lastSyncedAt: minutesAgo(boundary), lastSyncErrorAt: null }, policy)).toBe("HEALTHY");
    expect(deriveCharacterSyncHealth({ lastSyncedAt: minutesAgo(boundary + 1), lastSyncErrorAt: null }, policy)).toBe("STALE");
    expect(deriveCharacterSyncHealth({ lastSyncedAt: minutesAgo(130), lastSyncErrorAt: null }, policy)).toBe("HEALTHY");
  });

  it("ERROR still wins over a stale success", () => {
    expect(deriveCharacterSyncHealth({ lastSyncedAt: minutesAgo(500), lastSyncErrorAt: minutesAgo(1) }, policy)).toBe("ERROR");
  });
});

describe("deriveCharacterSyncStatus — linkage, health and retirement stay separate", () => {
  const linked = { blizzardCharacterId: "1", blizzardRealmId: "2" };

  it("health only for LINKED Characters", () => {
    const base = { isActive: true, lastSyncedAt: null, lastSyncErrorAt: null };
    expect(deriveCharacterSyncStatus({ ...base, blizzardCharacterId: null, blizzardRealmId: null }, { ...policy, ownerHasRegionConnection: true })).toEqual({
      retired: false,
      linkage: "NOT_LINKED",
      health: null,
    });
    expect(deriveCharacterSyncStatus({ ...base, ...linked }, { ...policy, ownerHasRegionConnection: false })).toEqual({
      retired: false,
      linkage: "NO_CONNECTION",
      health: null,
    });
    expect(deriveCharacterSyncStatus({ ...base, ...linked }, { ...policy, ownerHasRegionConnection: true }).health).toBe("NEVER_SYNCED");
  });

  it("retirement is reported separately (views render Retired, summaries skip it)", () => {
    const status = deriveCharacterSyncStatus(
      { isActive: false, ...linked, lastSyncedAt: minutesAgo(10_000), lastSyncErrorAt: null },
      { ...policy, ownerHasRegionConnection: true },
    );
    expect(status.retired).toBe(true);
    expect(status.linkage).toBe("LINKED");
  });
});

describe("one stale definition", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("the owner-facing sync state uses the same primitive and boundary", () => {
    const boundary = 120 + BLIZZARD_SYNC_RETRY_GRACE_MINUTES;
    const owner = (lastSyncedAt: string) =>
      deriveBlizzardSyncState({ blizzardLinked: true, isActive: true, lastSyncedAt, createdAt: minutesAgo(100_000) }, policy).kind;
    expect(owner(minutesAgo(boundary))).toBe("SYNCED");
    expect(owner(minutesAgo(boundary + 1))).toBe("STALE");
    expect(isSuccessfulSyncStale(minutesAgo(boundary), policy)).toBe(false);
    expect(isSuccessfulSyncStale(minutesAgo(boundary + 1), policy)).toBe(true);
  });

  it("views read BLIZZARD_SYNC_STALE_MINUTES and fall back to 120 when it is misconfigured", () => {
    vi.stubEnv("BLIZZARD_SYNC_STALE_MINUTES", "45");
    expect(resolveSyncHealthStaleMinutes()).toBe(45);
    vi.stubEnv("BLIZZARD_SYNC_STALE_MINUTES", "0");
    expect(resolveSyncHealthStaleMinutes()).toBe(120);
    vi.stubEnv("BLIZZARD_SYNC_STALE_MINUTES", "");
    expect(resolveSyncHealthStaleMinutes()).toBe(120);
  });
});
