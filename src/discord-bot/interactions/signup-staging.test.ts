import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllSessionsForTests,
  discardSession,
  getSession,
  setStagedRoles,
  startSession,
} from "@/discord-bot/interactions/signup-staging";

beforeEach(() => {
  clearAllSessionsForTests();
});

describe("signup-staging", () => {
  it("starts a session seeded with the given offers", () => {
    const session = startSession({
      discordUserId: "user-a",
      runId: "run-1",
      isExistingSignup: false,
      offers: [
        { characterId: "c1", offeredRoles: ["TANK"] },
        { characterId: "c2", offeredRoles: [] },
      ],
    });
    expect(session.offers.get("c1")).toEqual(["TANK"]);
    expect(session.offers.get("c2")).toEqual([]);
    expect(getSession("user-a", "run-1")).toBe(session);
  });

  it("isolates sessions by both discordUserId and runId — no cross-User or cross-Run leakage", () => {
    startSession({
      discordUserId: "user-a",
      runId: "run-1",
      isExistingSignup: false,
      offers: [{ characterId: "c1", offeredRoles: ["TANK"] }],
    });
    startSession({
      discordUserId: "user-b",
      runId: "run-1",
      isExistingSignup: false,
      offers: [{ characterId: "c1", offeredRoles: ["HEALER"] }],
    });
    startSession({
      discordUserId: "user-a",
      runId: "run-2",
      isExistingSignup: false,
      offers: [{ characterId: "c1", offeredRoles: ["DPS"] }],
    });

    expect(getSession("user-a", "run-1")?.offers.get("c1")).toEqual(["TANK"]);
    expect(getSession("user-b", "run-1")?.offers.get("c1")).toEqual(["HEALER"]);
    expect(getSession("user-a", "run-2")?.offers.get("c1")).toEqual(["DPS"]);
    expect(getSession("user-b", "run-2")).toBeUndefined();
  });

  it("setStagedRoles updates only the named Character, leaving the rest of the session untouched", () => {
    startSession({
      discordUserId: "user-a",
      runId: "run-1",
      isExistingSignup: false,
      offers: [
        { characterId: "c1", offeredRoles: ["TANK"] },
        { characterId: "c2", offeredRoles: ["HEALER"] },
      ],
    });
    expect(setStagedRoles("user-a", "run-1", "c2", ["DPS"])).toBe(true);
    const session = getSession("user-a", "run-1")!;
    expect(session.offers.get("c1")).toEqual(["TANK"]);
    expect(session.offers.get("c2")).toEqual(["DPS"]);
  });

  it("setStagedRoles on a missing session returns false and creates nothing", () => {
    expect(setStagedRoles("ghost", "run-1", "c1", ["TANK"])).toBe(false);
    expect(getSession("ghost", "run-1")).toBeUndefined();
  });

  it("discardSession removes the session without affecting other Users or Runs", () => {
    startSession({ discordUserId: "user-a", runId: "run-1", isExistingSignup: false, offers: [] });
    startSession({ discordUserId: "user-b", runId: "run-1", isExistingSignup: false, offers: [] });
    discardSession("user-a", "run-1");
    expect(getSession("user-a", "run-1")).toBeUndefined();
    expect(getSession("user-b", "run-1")).not.toBeUndefined();
  });

  it("expires a session after the TTL — a stale session reads as missing", () => {
    vi.useFakeTimers();
    try {
      startSession({
        discordUserId: "user-a",
        runId: "run-1",
        isExistingSignup: false,
        offers: [{ characterId: "c1", offeredRoles: ["TANK"] }],
      });
      expect(getSession("user-a", "run-1")).not.toBeUndefined();

      vi.advanceTimersByTime(16 * 60 * 1000);
      expect(getSession("user-a", "run-1")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renews the TTL on a role change so an active editor never expires mid-use", () => {
    vi.useFakeTimers();
    try {
      startSession({
        discordUserId: "user-a",
        runId: "run-1",
        isExistingSignup: false,
        offers: [{ characterId: "c1", offeredRoles: ["TANK"] }],
      });
      vi.advanceTimersByTime(14 * 60 * 1000);
      expect(setStagedRoles("user-a", "run-1", "c1", ["HEALER"])).toBe(true);
      vi.advanceTimersByTime(14 * 60 * 1000);
      expect(getSession("user-a", "run-1")?.offers.get("c1")).toEqual(["HEALER"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => {
  clearAllSessionsForTests();
});
