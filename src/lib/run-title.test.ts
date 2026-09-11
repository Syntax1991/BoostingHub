import { describe, expect, it } from "vitest";
import { buildRunTitle } from "@/lib/run-title";

describe("buildRunTitle", () => {
  it("formats Thu 21:00 HC VIP 7/9 Titan", () => {
    // 2026-09-10T19:00:00.000Z = Thursday 21:00 Europe/Berlin (CEST, UTC+2).
    expect(
      buildRunTitle({
        scheduledStartAt: "2026-09-10T19:00:00.000Z",
        difficulty: "HEROIC",
        lootType: "VIP",
        plannedBossCount: 7,
        totalBossCount: 9,
        raidLeadName: "Titan",
      }),
    ).toBe("Thu 21:00 HC VIP 7/9 Titan");
  });

  it("formats Fri 18:45 NM Unsaved 9/9 Titan", () => {
    // 2026-09-11T16:45:00.000Z = Friday 18:45 Europe/Berlin (CEST, UTC+2).
    expect(
      buildRunTitle({
        scheduledStartAt: "2026-09-11T16:45:00.000Z",
        difficulty: "NORMAL",
        lootType: "UNSAVED",
        plannedBossCount: 9,
        totalBossCount: 9,
        raidLeadName: "Titan",
      }),
    ).toBe("Fri 18:45 NM Unsaved 9/9 Titan");
  });

  it("formats Sat 23:00 MY VIP 9/9 Thorne", () => {
    // 2026-09-12T21:00:00.000Z = Saturday 23:00 Europe/Berlin (CEST, UTC+2).
    expect(
      buildRunTitle({
        scheduledStartAt: "2026-09-12T21:00:00.000Z",
        difficulty: "MYTHIC",
        lootType: "VIP",
        plannedBossCount: 9,
        totalBossCount: 9,
        raidLeadName: "Thorne",
      }),
    ).toBe("Sat 23:00 MY VIP 9/9 Thorne");
  });

  it("formats Sun 20:00 HC Saved 9/9 Aelira", () => {
    // 2026-09-13T18:00:00.000Z = Sunday 20:00 Europe/Berlin (CEST, UTC+2).
    expect(
      buildRunTitle({
        scheduledStartAt: "2026-09-13T18:00:00.000Z",
        difficulty: "HEROIC",
        lootType: "SAVED",
        plannedBossCount: 9,
        totalBossCount: 9,
        raidLeadName: "Aelira",
      }),
    ).toBe("Sun 20:00 HC Saved 9/9 Aelira");
  });

  it("never renders MY Saved — MYTHIC always pairs with UNSAVED or VIP", () => {
    const title = buildRunTitle({
      scheduledStartAt: "2026-09-12T21:00:00.000Z",
      difficulty: "MYTHIC",
      lootType: "UNSAVED",
      plannedBossCount: 9,
      totalBossCount: 9,
      raidLeadName: "Thorne",
    });
    expect(title).not.toContain("MY Saved");
  });

  it("uses Europe/Berlin regardless of an explicit UTC offset in the instant", () => {
    // 2026-01-15T20:00:00.000Z during CET (UTC+1) = 21:00 local, still Thursday.
    const title = buildRunTitle({
      scheduledStartAt: "2026-01-15T20:00:00.000Z",
      difficulty: "HEROIC",
      lootType: "VIP",
      plannedBossCount: 7,
      totalBossCount: 9,
      raidLeadName: "Titan",
    });
    expect(title).toBe("Thu 21:00 HC VIP 7/9 Titan");
  });

  it("is deterministic for the same input", () => {
    const input = {
      scheduledStartAt: "2026-09-10T19:00:00.000Z",
      difficulty: "HEROIC" as const,
      lootType: "VIP" as const,
      plannedBossCount: 7,
      totalBossCount: 9,
      raidLeadName: "Titan",
    };
    expect(buildRunTitle(input)).toBe(buildRunTitle(input));
  });
});
