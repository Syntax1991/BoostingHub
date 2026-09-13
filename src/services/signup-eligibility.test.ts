import { describe, expect, it } from "vitest";
import type { EligibilityCharacter, EligibilityRun } from "@/services/signup-eligibility";
import { evaluateBoosterOptions } from "@/services/signup-eligibility";
import { assertSignupWindowOpen } from "@/services/signup-eligibility";
import { canSelfWithdrawSignup, canTransitionSignup, isBlockingDuplicate } from "@/services/signup-state";
import { canTransitionRun } from "@/services/run-state";
import { boosterSignupSchema, setLootbuddiesSchema, signupOptionsSchema } from "@/validators/signup";

const reset = "2026-W37";

const heroicRun: EligibilityRun = {
  id: "run-heroic",
  raidId: "raid-1",
  difficulty: "HEROIC",
  status: "OPEN",
  signupsOpen: true,
  totalBossCount: 8,
  // Monday 14 Sep 2026 02:00 Berlin — still EU reset that started Wed 09 Sep (2026-W37).
  scheduledStartAt: "2026-09-14T00:00:00.000Z",
};

const mythicRun: EligibilityRun = {
  ...heroicRun,
  id: "run-mythic",
  difficulty: "MYTHIC",
};

function shaman(overrides: Partial<EligibilityCharacter> = {}): EligibilityCharacter {
  return {
    id: "char-1",
    userId: "user-1",
    name: "Stormhowl",
    realm: "Twisting Nether",
    region: "EU",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    isActive: true,
    boosterQualifications: [{ difficulty: "HEROIC", status: "APPROVED" }],
    lockouts: [],
    reservationConflict: null,
    ...overrides,
  };
}

describe("booster eligibility", () => {
  it("exposes every role the Character's class can perform, not just the specialization-derived default", () => {
    const result = evaluateBoosterOptions([shaman()], heroicRun);
    expect(result.eligible[0]?.roles).toEqual(["DPS", "HEALER"]);
    expect(result.eligible[0]?.defaultRole).toBe("HEALER");
  });

  it("derives the correct default role for each Monk specialization (Mistweaver/Brewmaster/Windwalker), never class order", () => {
    const monk = (specialization: string) => shaman({ wowClass: "MONK", specialization });
    const mistweaver = evaluateBoosterOptions([monk("Mistweaver")], heroicRun).eligible[0];
    const brewmaster = evaluateBoosterOptions([monk("Brewmaster")], heroicRun).eligible[0];
    const windwalker = evaluateBoosterOptions([monk("Windwalker")], heroicRun).eligible[0];
    expect(mistweaver?.defaultRole).toBe("HEALER");
    expect(brewmaster?.defaultRole).toBe("TANK");
    expect(windwalker?.defaultRole).toBe("DPS");
    // Every Monk option allows all three roles regardless of which spec is imported.
    expect(mistweaver?.roles).toEqual(["TANK", "HEALER", "DPS"]);
    expect(brewmaster?.roles).toEqual(["TANK", "HEALER", "DPS"]);
    expect(windwalker?.roles).toEqual(["TANK", "HEALER", "DPS"]);
  });

  it("allows every role Holy Paladin and Restoration Shaman's classes can perform, defaulting to HEALER", () => {
    const paladin = evaluateBoosterOptions(
      [shaman({ wowClass: "PALADIN", specialization: "Holy" })],
      heroicRun,
    ).eligible[0];
    expect(paladin?.defaultRole).toBe("HEALER");
    expect(paladin?.roles).toEqual(["HEALER", "TANK", "DPS"]);

    const restoShaman = evaluateBoosterOptions([shaman()], heroicRun).eligible[0];
    expect(restoShaman?.defaultRole).toBe("HEALER");
    expect(restoShaman?.roles).toEqual(["DPS", "HEALER"]);
  });

  it("Priest and Mage: allowed roles are bounded by class, never expanded beyond it", () => {
    const priest = evaluateBoosterOptions(
      [shaman({ wowClass: "PRIEST", specialization: "Holy" })],
      heroicRun,
    ).eligible[0];
    expect(priest?.roles).toEqual(["HEALER", "DPS"]);
    expect(priest?.roles).not.toContain("TANK");

    const mage = evaluateBoosterOptions(
      [shaman({ wowClass: "MAGE", specialization: "Frost" })],
      heroicRun,
    ).eligible[0];
    expect(mage?.roles).toEqual(["DPS"]);
  });

  it("does not block eligibility for a missing or unrecognized specialization — it just leaves no default, so the User must choose explicitly", () => {
    const missing = evaluateBoosterOptions([shaman({ specialization: null })], heroicRun);
    expect(missing.eligible).toHaveLength(1);
    expect(missing.eligible[0]?.defaultRole).toBeNull();
    expect(missing.eligible[0]?.roles).toEqual(["DPS", "HEALER"]);

    const unrecognized = evaluateBoosterOptions([shaman({ specialization: "Not A Real Spec" })], heroicRun);
    expect(unrecognized.eligible).toHaveLength(1);
    expect(unrecognized.eligible[0]?.defaultRole).toBeNull();
  });

  it("does not treat heroic approval as mythic eligibility", () => {
    const result = evaluateBoosterOptions([shaman()], mythicRun);
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible[0]?.reason).toBe("DIFFICULTY_NOT_APPROVED");
  });

  it("rejects missing booster access", () => {
    const result = evaluateBoosterOptions([shaman({ boosterQualifications: [] })], heroicRun);
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible[0]?.reason).toBe("NO_BOOSTER_ACCESS");
  });

  it("rejects inactive characters", () => {
    const result = evaluateBoosterOptions([shaman({ isActive: false })], heroicRun);
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible[0]?.reason).toBe("INACTIVE");
  });

  it("can offer two eligible characters for the same run", () => {
    const second: EligibilityCharacter = shaman({
      id: "char-2",
      name: "Emberlight",
      wowClass: "PALADIN",
      specialization: "Holy",
      boosterQualifications: [{ difficulty: "HEROIC", status: "APPROVED" }],
    });
    const result = evaluateBoosterOptions([shaman(), second], heroicRun);
    expect(result.eligible.map((item) => item.characterId).includes("char-1")).toBe(true);
    expect(result.eligible.map((item) => item.characterId).includes("char-2")).toBe(true);
    expect(result.eligible.find((item) => item.characterId === "char-2")?.defaultRole).toBe("HEALER");
  });
});

describe("raid lockouts are informational, never a Booster eligibility blocker", () => {
  it("A: HC 8/8 (isComplete) on the target raid/difficulty/reset — eligible, with save info", () => {
    const result = evaluateBoosterOptions(
      [
        shaman({
          lockouts: [{ raidId: "raid-1", difficulty: "HEROIC", resetIdentifier: reset, isComplete: true, bossesDefeated: 8 }],
        }),
      ],
      heroicRun,
    );
    expect(result.eligible).toHaveLength(1);
    expect(result.ineligible).toHaveLength(0);
    expect(result.eligible[0]?.raidSave).toEqual({
      raidId: "raid-1",
      difficulty: "HEROIC",
      resetIdentifier: reset,
      bossesDefeated: 8,
      totalBossCount: 8,
      isComplete: true,
    });
  });

  it("B: HC 1/8 (partial progress, not complete) on the target raid/difficulty/reset — eligible, with save info", () => {
    const result = evaluateBoosterOptions(
      [
        shaman({
          lockouts: [{ raidId: "raid-1", difficulty: "HEROIC", resetIdentifier: reset, isComplete: false, bossesDefeated: 1 }],
        }),
      ],
      heroicRun,
    );
    expect(result.eligible).toHaveLength(1);
    expect(result.eligible[0]?.raidSave).toEqual({
      raidId: "raid-1",
      difficulty: "HEROIC",
      resetIdentifier: reset,
      bossesDefeated: 1,
      totalBossCount: 8,
      isComplete: false,
    });
  });

  it("C: verified HC 0/8 is surfaced as known Unsaved, not Unknown", () => {
    const result = evaluateBoosterOptions(
      [
        shaman({
          lockouts: [{ raidId: "raid-1", difficulty: "HEROIC", resetIdentifier: reset, isComplete: false, bossesDefeated: 0 }],
        }),
      ],
      heroicRun,
    );
    expect(result.eligible[0]?.raidSave).toEqual({
      raidId: "raid-1",
      difficulty: "HEROIC",
      resetIdentifier: reset,
      bossesDefeated: 0,
      totalBossCount: 8,
      isComplete: false,
    });
  });

  it("D: no lockout row — eligible, raidSave null (Unknown)", () => {
    const result = evaluateBoosterOptions([shaman()], heroicRun);
    expect(result.eligible).toHaveLength(1);
    expect(result.eligible[0]?.raidSave).toBeNull();
  });

  it("EU Monday Run matches lockout under previous Wednesday reset identifier, not Monday ISO week", () => {
    // Monday ISO week would be 2026-W38; Blizzard sync stores 2026-W37 from Wed reset start.
    const result = evaluateBoosterOptions(
      [
        shaman({
          lockouts: [{ raidId: "raid-1", difficulty: "HEROIC", resetIdentifier: "2026-W37", isComplete: false, bossesDefeated: 7 }],
        }),
      ],
      heroicRun,
    );
    expect(result.eligible[0]?.raidSave?.resetIdentifier).toBe("2026-W37");
    expect(result.eligible[0]?.raidSave?.bossesDefeated).toBe(7);
  });

  it("EU Tuesday pre-reset Run still matches Wednesday reset lockout", () => {
    const tuesdayRun: EligibilityRun = {
      ...heroicRun,
      // Tue 15 Sep 2026 03:00 Europe/Berlin
      scheduledStartAt: "2026-09-15T01:00:00.000Z",
    };
    const result = evaluateBoosterOptions(
      [
        shaman({
          lockouts: [{ raidId: "raid-1", difficulty: "HEROIC", resetIdentifier: "2026-W37", isComplete: false, bossesDefeated: 2 }],
        }),
      ],
      tuesdayRun,
    );
    expect(result.eligible[0]?.raidSave?.resetIdentifier).toBe("2026-W37");
    expect(result.eligible[0]?.raidSave?.bossesDefeated).toBe(2);
  });

  it("EU post-reset Run uses the new reset identifier", () => {
    const postResetRun: EligibilityRun = {
      ...heroicRun,
      scheduledStartAt: "2026-09-16T04:00:00.000Z",
    };
    const result = evaluateBoosterOptions(
      [
        shaman({
          lockouts: [
            { raidId: "raid-1", difficulty: "HEROIC", resetIdentifier: "2026-W37", isComplete: true, bossesDefeated: 8 },
            { raidId: "raid-1", difficulty: "HEROIC", resetIdentifier: "2026-W38", isComplete: false, bossesDefeated: 1 },
          ],
        }),
      ],
      postResetRun,
    );
    expect(result.eligible[0]?.raidSave?.resetIdentifier).toBe("2026-W38");
    expect(result.eligible[0]?.raidSave?.bossesDefeated).toBe(1);
  });

  it("US Character uses US regional reset, not EU", () => {
    // Before US Tuesday reset: still W37. EU Monday would still be W37 too, but after US reset
    // at 15:00 UTC the US window advances while EU Monday schedule stays on W37 until Wed.
    const runDuringUsResetGap: EligibilityRun = {
      ...heroicRun,
      scheduledStartAt: "2026-09-15T16:00:00.000Z", // after US reset, before EU reset
    };
    const usChar = shaman({
      region: "US",
      lockouts: [
        { raidId: "raid-1", difficulty: "HEROIC", resetIdentifier: "2026-W37", isComplete: true, bossesDefeated: 8 },
        { raidId: "raid-1", difficulty: "HEROIC", resetIdentifier: "2026-W38", isComplete: false, bossesDefeated: 3 },
      ],
    });
    const euChar = shaman({
      id: "char-eu",
      region: "EU",
      lockouts: usChar.lockouts,
    });
    expect(evaluateBoosterOptions([usChar], runDuringUsResetGap).eligible[0]?.raidSave?.resetIdentifier).toBe("2026-W38");
    expect(evaluateBoosterOptions([euChar], runDuringUsResetGap).eligible[0]?.raidSave?.resetIdentifier).toBe("2026-W37");
  });

  it("F: a lockout for a different difficulty never appears as the target Run's save info", () => {
    const result = evaluateBoosterOptions(
      [
        shaman({
          boosterQualifications: [{ difficulty: "HEROIC", status: "APPROVED" }],
          lockouts: [{ raidId: "raid-1", difficulty: "MYTHIC", resetIdentifier: reset, isComplete: true, bossesDefeated: 8 }],
        }),
      ],
      heroicRun,
    );
    expect(result.eligible[0]?.raidSave).toBeNull();
  });

  it("G: a lockout for a different raid never appears as the target Run's save info", () => {
    const result = evaluateBoosterOptions(
      [
        shaman({
          lockouts: [{ raidId: "raid-other", difficulty: "HEROIC", resetIdentifier: reset, isComplete: true, bossesDefeated: 8 }],
        }),
      ],
      heroicRun,
    );
    expect(result.eligible[0]?.raidSave).toBeNull();
  });

  it("H: an old reset's lockout never appears as the current target Run's save info", () => {
    const result = evaluateBoosterOptions(
      [
        shaman({
          lockouts: [{ raidId: "raid-1", difficulty: "HEROIC", resetIdentifier: "2026-W30", isComplete: true, bossesDefeated: 8 }],
        }),
      ],
      heroicRun,
    );
    expect(result.eligible[0]?.raidSave).toBeNull();
  });

  it("hard rule priority: a raid save never masks another real ineligibility reason", () => {
    const saved = (overrides: Partial<EligibilityCharacter>) =>
      shaman({
        lockouts: [{ raidId: "raid-1", difficulty: "HEROIC", resetIdentifier: reset, isComplete: true, bossesDefeated: 8 }],
        ...overrides,
      });

    expect(evaluateBoosterOptions([saved({ boosterQualifications: [] })], heroicRun).ineligible[0]?.reason).toBe(
      "NO_BOOSTER_ACCESS",
    );
    expect(
      evaluateBoosterOptions(
        [saved({ boosterQualifications: [{ difficulty: "MYTHIC", status: "APPROVED" }] })],
        heroicRun,
      ).ineligible[0]?.reason,
    ).toBe("DIFFICULTY_NOT_APPROVED");
    expect(
      evaluateBoosterOptions(
        [
          saved({
            reservationConflict: { runId: "run-other", runTitle: "Other Run", scheduledStartAt: "2026-01-01T00:00:00.000Z" },
          }),
        ],
        heroicRun,
      ).ineligible[0]?.reason,
    ).toBe("ALREADY_SELECTED_OTHER_RUN");
    // And with no other issue, the saved Character is simply eligible.
    expect(evaluateBoosterOptions([saved({})], heroicRun).eligible).toHaveLength(1);
  });
});

describe("signup creation rules", () => {
  it("accepts valid booster and lootbuddy payloads", () => {
    expect(
      boosterSignupSchema.parse({
        runId: "11111111-1111-4111-8111-111111111111",
        characterId: "c1111111-1111-4111-8111-111111111111",
        role: "HEALER",
        isBackup: true,
      }).isBackup,
    ).toBe(true);
    expect(
      setLootbuddiesSchema.parse({
        runId: "11111111-1111-4111-8111-111111111111",
        lootbuddies: [{ wowClass: "MAGE", mode: "LOOT_ONLY", verification: "ACCESS" }],
      }).lootbuddies[0]?.mode,
    ).toBe("LOOT_ONLY");
    expect(
      setLootbuddiesSchema.parse({
        runId: "11111111-1111-4111-8111-111111111111",
        lootbuddies: [
          { wowClass: "PRIEST", mode: "PLAYING", verification: "TRIAL" },
          { signupId: "c1111111-1111-4111-8111-111111111111", wowClass: "WARLOCK", mode: "LOOT_ONLY" },
        ],
      }).lootbuddies[0]?.verification,
    ).toBe("TRIAL");
  });

  it("rejects closed runs before a signup is created", () => {
    expect(assertSignupWindowOpen({ status: "OPEN", signupsOpen: false })).toBe(false);
    expect(assertSignupWindowOpen({ status: "PUBLISHED", signupsOpen: true })).toBe(false);
    expect(assertSignupWindowOpen({ status: "OPEN", signupsOpen: true })).toBe(true);
  });

  it("treats a non-withdrawn matching combination as an active duplicate", () => {
    expect(isBlockingDuplicate("PENDING")).toBe(true);
    expect(isBlockingDuplicate("SELECTED")).toBe(true);
    expect(isBlockingDuplicate("NOT_SELECTED")).toBe(true);
    expect(isBlockingDuplicate("WITHDRAWN")).toBe(false);
  });

  it("accepts prefixed seed run ids that are not strict RFC UUIDs", () => {
    expect(
      signupOptionsSchema.parse({ runId: "r7777777-7777-4777-8777-777777777777" }).runId,
    ).toBe("r7777777-7777-4777-8777-777777777777");
  });
});

describe("withdrawal", () => {
  it("allows withdrawing an own pending signup", () => {
    expect(canSelfWithdrawSignup("PENDING", "OPEN")).toBe(true);
  });

  it("rejects withdrawing a selected signup after roster publication", () => {
    expect(canSelfWithdrawSignup("SELECTED", "PUBLISHED")).toBe(false);
    expect(canSelfWithdrawSignup("SELECTED", "IN_PROGRESS")).toBe(false);
  });

  it("allows withdrawing selected only before publication", () => {
    expect(canSelfWithdrawSignup("SELECTED", "ROSTERING")).toBe(true);
  });

  it("keeps withdrawn as a terminal persisted state", () => {
    expect(canTransitionSignup("PENDING", "WITHDRAWN")).toBe(true);
    expect(canTransitionSignup("WITHDRAWN", "PENDING")).toBe(false);
    expect(canSelfWithdrawSignup("WITHDRAWN", "OPEN")).toBe(false);
  });
});

describe("run and signup state machines stay independent", () => {
  it("does not couple run OPEN to signup SELECTED", () => {
    expect(canTransitionRun("OPEN", "ROSTERING")).toBe(true);
    expect(canTransitionSignup("PENDING", "SELECTED")).toBe(true);
    expect(canTransitionRun("OPEN", "SELECTED" as never)).toBe(false);
  });
});
