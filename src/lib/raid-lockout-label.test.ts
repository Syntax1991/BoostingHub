import { describe, expect, it } from "vitest";
import {
  formatTargetRaidLockoutLabel,
  requiresFreshRaidLockout,
} from "@/lib/raid-lockout-label";
import { lockoutService } from "@/services/lockout.service";

describe("lockoutService.getResetIdentifierForRun", () => {
  it("EU Monday 14 Sep 2026 02:00 Berlin uses Wednesday 09 Sep reset start (2026-W37), not Monday ISO week", () => {
    // Monday ISO week alone would be 2026-W38.
    expect(lockoutService.getResetIdentifierForRun("EU", "2026-09-14T00:00:00.000Z")).toBe("2026-W37");
  });

  it("EU Tuesday 15 Sep 2026 03:00 Berlin stays on the same Wednesday reset", () => {
    expect(lockoutService.getResetIdentifierForRun("EU", "2026-09-15T01:00:00.000Z")).toBe("2026-W37");
  });

  it("EU boundary: immediately before next reset keeps prior identifier; at reset advances", () => {
    expect(lockoutService.getResetIdentifierForRun("EU", "2026-09-16T03:59:59.000Z")).toBe("2026-W37");
    expect(lockoutService.getResetIdentifierForRun("EU", "2026-09-16T04:00:00.000Z")).toBe("2026-W38");
  });

  it("US boundary: before Tuesday 15:00 UTC stays prior; at/after advances", () => {
    expect(lockoutService.getResetIdentifierForRun("US", "2026-09-15T14:59:59.000Z")).toBe("2026-W37");
    expect(lockoutService.getResetIdentifierForRun("US", "2026-09-15T15:00:00.000Z")).toBe("2026-W38");
  });
});

describe("requiresFreshRaidLockout", () => {
  it("UNSAVED and VIP share fresh-lockout attention; SAVED does not", () => {
    expect(requiresFreshRaidLockout("UNSAVED")).toBe(true);
    expect(requiresFreshRaidLockout("VIP")).toBe(true);
    expect(requiresFreshRaidLockout("SAVED")).toBe(false);
  });
});

describe("formatTargetRaidLockoutLabel", () => {
  const base = { difficulty: "HEROIC" as const, totalBossCount: 8 };

  it("formats verified 0/8 as Unsaved without attention on fresh Runs", () => {
    const label = formatTargetRaidLockoutLabel({
      ...base,
      lootType: "UNSAVED",
      raidSave: {
        raidId: "raid-1",
        difficulty: "HEROIC",
        resetIdentifier: "2026-W37",
        bossesDefeated: 0,
        totalBossCount: 8,
        isComplete: false,
      },
    });
    expect(label).toEqual({ kind: "unsaved", text: "HC 0/8 · Unsaved", attention: false });
  });

  it("formats partial and full saves with attention on UNSAVED/VIP only", () => {
    const partial = formatTargetRaidLockoutLabel({
      ...base,
      lootType: "VIP",
      raidSave: {
        raidId: "raid-1",
        difficulty: "HEROIC",
        resetIdentifier: "2026-W37",
        bossesDefeated: 2,
        totalBossCount: 8,
        isComplete: false,
      },
    });
    expect(partial).toEqual({ kind: "saved", text: "HC 2/8 · Saved", attention: true });

    const fullSave = {
      raidId: "raid-1",
      difficulty: "HEROIC" as const,
      resetIdentifier: "2026-W37",
      bossesDefeated: 8,
      totalBossCount: 8,
      isComplete: true,
    };
    expect(formatTargetRaidLockoutLabel({ ...base, lootType: "UNSAVED", raidSave: fullSave })).toEqual({
      kind: "fully_saved",
      text: "HC 8/8 · Fully saved",
      attention: true,
    });
    expect(formatTargetRaidLockoutLabel({ ...base, lootType: "SAVED", raidSave: fullSave }).attention).toBe(false);
  });

  it("formats missing verification as Unknown with attention on fresh Runs", () => {
    expect(
      formatTargetRaidLockoutLabel({ ...base, lootType: "VIP", raidSave: null }),
    ).toEqual({ kind: "unknown", text: "HC ?/8 · Unknown", attention: true });
    expect(
      formatTargetRaidLockoutLabel({ ...base, lootType: "SAVED", raidSave: null }),
    ).toEqual({ kind: "unknown", text: "HC ?/8 · Unknown", attention: false });
  });

  it("UNSAVED and VIP classify identical lockout states the same way", () => {
    const raidSave = {
      raidId: "raid-1",
      difficulty: "HEROIC" as const,
      resetIdentifier: "2026-W37",
      bossesDefeated: 7,
      totalBossCount: 8,
      isComplete: false,
    };
    expect(formatTargetRaidLockoutLabel({ ...base, lootType: "UNSAVED", raidSave })).toEqual(
      formatTargetRaidLockoutLabel({ ...base, lootType: "VIP", raidSave }),
    );
  });
});
