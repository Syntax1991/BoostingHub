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
  difficulty: "HEROIC",
  status: "OPEN",
  signupsOpen: true,
  lootType: "UNSAVED",
  // Monday 14 Sep 2026 02:00 Berlin — still EU reset that started Wed 09 Sep (2026-W37).
  scheduledStartAt: "2026-09-14T00:00:00.000Z",
  contents: [
    {
      raidId: "raid-1",
      raidName: "The Venomous Abyss",
      sortOrder: 1,
      plannedBossCount: 8,
      totalBossCount: 8,
      bosses: [],
    },
  ],
};

const normalRun: EligibilityRun = {
  ...heroicRun,
  id: "run-normal",
  difficulty: "NORMAL",
};

const mythicRun: EligibilityRun = {
  ...heroicRun,
  id: "run-mythic",
  difficulty: "MYTHIC",
};

const RUNS_BY_DIFFICULTY = [normalRun, heroicRun, mythicRun] as const;

function shaman(overrides: Partial<EligibilityCharacter> = {}): EligibilityCharacter {
  return {
    id: "char-1",
    userId: "user-1",
    name: "Stormhowl",
    realm: "Twisting Nether",
    region: "EU",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    playableSpecs: [],
    isActive: true,
    warcraftLogsId: null,
    ownerIsBooster: true,
    lockouts: [],
    reservationConflict: null,
    weeklyUnavailable: false,
    ...overrides,
  };
}

describe("booster eligibility", () => {
  it("exposes only roles from the Character's configured specializations", () => {
    const result = evaluateBoosterOptions([shaman()], heroicRun);
    expect(result.eligible[0]?.roles).toEqual(["HEALER"]);
    expect(result.eligible[0]?.defaultRole).toBe("HEALER");
  });

  it("adds concrete DPS/tank roles only when matching playable specs are configured", () => {
    const withElemental = evaluateBoosterOptions(
      [shaman({ playableSpecs: ["Elemental"] })],
      heroicRun,
    ).eligible[0];
    expect(withElemental?.roles).toEqual(["HEALER", "RANGED_DPS"]);

    const withEnhancement = evaluateBoosterOptions(
      [shaman({ playableSpecs: ["Enhancement"] })],
      heroicRun,
    ).eligible[0];
    expect(withEnhancement?.roles).toEqual(["HEALER", "MELEE_DPS"]);
  });

  it("derives the correct default role for each Monk specialization (Mistweaver/Brewmaster/Windwalker)", () => {
    const monk = (specialization: string) => shaman({ wowClass: "MONK", specialization, playableSpecs: [] });
    const mistweaver = evaluateBoosterOptions([monk("Mistweaver")], heroicRun).eligible[0];
    const brewmaster = evaluateBoosterOptions([monk("Brewmaster")], heroicRun).eligible[0];
    const windwalker = evaluateBoosterOptions([monk("Windwalker")], heroicRun).eligible[0];
    expect(mistweaver?.defaultRole).toBe("HEALER");
    expect(brewmaster?.defaultRole).toBe("TANK");
    expect(windwalker?.defaultRole).toBe("MELEE_DPS");
    expect(mistweaver?.roles).toEqual(["HEALER"]);
    expect(brewmaster?.roles).toEqual(["TANK"]);
    expect(windwalker?.roles).toEqual(["MELEE_DPS"]);
  });

  it("allows every configured role for Holy Paladin and Restoration Shaman, defaulting to HEALER", () => {
    const paladin = evaluateBoosterOptions(
      [shaman({ wowClass: "PALADIN", specialization: "Holy", playableSpecs: ["Protection", "Retribution"] })],
      heroicRun,
    ).eligible[0];
    expect(paladin?.defaultRole).toBe("HEALER");
    expect(paladin?.roles).toEqual(["TANK", "HEALER", "MELEE_DPS"]);

    const restoShaman = evaluateBoosterOptions([shaman()], heroicRun).eligible[0];
    expect(restoShaman?.defaultRole).toBe("HEALER");
    expect(restoShaman?.roles).toEqual(["HEALER"]);
  });

  it("Priest and Mage: allowed roles are bounded by configured specs, never expanded beyond them", () => {
    const priest = evaluateBoosterOptions(
      [shaman({ wowClass: "PRIEST", specialization: "Discipline", playableSpecs: ["Shadow"] })],
      heroicRun,
    ).eligible[0];
    expect(priest?.roles).toEqual(["HEALER", "RANGED_DPS"]);
    expect(priest?.roles).not.toContain("TANK");

    const mage = evaluateBoosterOptions(
      [shaman({ wowClass: "MAGE", specialization: "Frost", playableSpecs: [] })],
      heroicRun,
    ).eligible[0];
    expect(mage?.roles).toEqual(["RANGED_DPS"]);
  });

  it("missing or unrecognized specialization yields no roles and no default", () => {
    const missing = evaluateBoosterOptions([shaman({ specialization: null })], heroicRun);
    expect(missing.eligible).toHaveLength(1);
    expect(missing.eligible[0]?.defaultRole).toBeNull();
    expect(missing.eligible[0]?.roles).toEqual([]);

    const unrecognized = evaluateBoosterOptions([shaman({ specialization: "Not A Real Spec" })], heroicRun);
    expect(unrecognized.eligible[0]?.defaultRole).toBeNull();
    expect(unrecognized.eligible[0]?.roles).toEqual([]);
  });

  it.each(RUNS_BY_DIFFICULTY)("a Booster qualifies for a $difficulty run (account-level, not difficulty-scoped)", (run) => {
    const result = evaluateBoosterOptions([shaman()], run);
    expect(result.ineligible).toHaveLength(0);
    expect(result.eligible.map((option) => option.characterId)).toEqual(["char-1"]);
  });

  it.each(RUNS_BY_DIFFICULTY)("a non-Booster (never granted or revoked) does not qualify for a $difficulty run", (run) => {
    const result = evaluateBoosterOptions([shaman({ ownerIsBooster: false })], run);
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible[0]?.reason).toBe("NO_BOOSTER_ACCESS");
  });

  it("never reports a difficulty-specific booster rejection", () => {
    for (const run of RUNS_BY_DIFFICULTY) {
      const result = evaluateBoosterOptions([shaman({ ownerIsBooster: false })], run);
      expect(result.ineligible.map((row) => row.reason)).toEqual(["NO_BOOSTER_ACCESS"]);
      expect(result.ineligible[0]?.message).not.toMatch(/difficulty/i);
    }
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
      ownerIsBooster: true,
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
    expect(result.eligible[0]?.contentSaves[0]?.raidSave).toEqual({
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
    expect(result.eligible[0]?.contentSaves[0]?.raidSave).toEqual({
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
    expect(result.eligible[0]?.contentSaves[0]?.raidSave).toEqual({
      raidId: "raid-1",
      difficulty: "HEROIC",
      resetIdentifier: reset,
      bossesDefeated: 0,
      totalBossCount: 8,
      isComplete: false,
    });
  });

  it("D: no lockout row — eligible, content save null (Unknown)", () => {
    const result = evaluateBoosterOptions([shaman()], heroicRun);
    expect(result.eligible).toHaveLength(1);
    expect(result.eligible[0]?.contentSaves[0]?.raidSave).toBeNull();
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
    expect(result.eligible[0]?.contentSaves[0]?.raidSave?.resetIdentifier).toBe("2026-W37");
    expect(result.eligible[0]?.contentSaves[0]?.raidSave?.bossesDefeated).toBe(7);
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
    expect(result.eligible[0]?.contentSaves[0]?.raidSave?.resetIdentifier).toBe("2026-W37");
    expect(result.eligible[0]?.contentSaves[0]?.raidSave?.bossesDefeated).toBe(2);
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
    expect(result.eligible[0]?.contentSaves[0]?.raidSave?.resetIdentifier).toBe("2026-W38");
    expect(result.eligible[0]?.contentSaves[0]?.raidSave?.bossesDefeated).toBe(1);
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
    expect(evaluateBoosterOptions([usChar], runDuringUsResetGap).eligible[0]?.contentSaves[0]?.raidSave?.resetIdentifier).toBe("2026-W38");
    expect(evaluateBoosterOptions([euChar], runDuringUsResetGap).eligible[0]?.contentSaves[0]?.raidSave?.resetIdentifier).toBe("2026-W37");
  });

  it("F: a lockout for a different difficulty never appears as the target Run's save info", () => {
    const result = evaluateBoosterOptions(
      [
        shaman({
          ownerIsBooster: true,
          lockouts: [{ raidId: "raid-1", difficulty: "MYTHIC", resetIdentifier: reset, isComplete: true, bossesDefeated: 8 }],
        }),
      ],
      heroicRun,
    );
    expect(result.eligible[0]?.contentSaves[0]?.raidSave).toBeNull();
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
    expect(result.eligible[0]?.contentSaves[0]?.raidSave).toBeNull();
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
    expect(result.eligible[0]?.contentSaves[0]?.raidSave).toBeNull();
  });

  it("hard rule priority: a raid save never masks another real ineligibility reason", () => {
    const saved = (overrides: Partial<EligibilityCharacter>) =>
      shaman({
        lockouts: [{ raidId: "raid-1", difficulty: "HEROIC", resetIdentifier: reset, isComplete: true, bossesDefeated: 8 }],
        ...overrides,
      });

    expect(evaluateBoosterOptions([saved({ ownerIsBooster: false })], heroicRun).ineligible[0]?.reason).toBe(
      "NO_BOOSTER_ACCESS",
    );
    expect(
      evaluateBoosterOptions([saved({ ownerIsBooster: false })], heroicRun).ineligible[0]
        ?.reason,
    ).toBe("NO_BOOSTER_ACCESS");
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

  it("projects warcraftLogsId for eligible and ineligible Booster Characters without affecting eligibility", () => {
    const eligible = evaluateBoosterOptions([shaman({ warcraftLogsId: "11112222" })], heroicRun);
    expect(eligible.eligible[0]?.warcraftLogsId).toBe("11112222");
    expect(eligible.ineligible).toHaveLength(0);

    const withoutId = evaluateBoosterOptions([shaman({ warcraftLogsId: null })], heroicRun);
    expect(withoutId.eligible[0]?.warcraftLogsId).toBeNull();

    const blocked = evaluateBoosterOptions(
      [
        shaman({
          warcraftLogsId: "33334444",
          reservationConflict: {
            runId: "run-other",
            runTitle: "Other Run",
            scheduledStartAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ],
      heroicRun,
    );
    expect(blocked.eligible).toHaveLength(0);
    expect(blocked.ineligible[0]?.reason).toBe("ALREADY_SELECTED_OTHER_RUN");
    expect(blocked.ineligible[0]?.warcraftLogsId).toBe("33334444");

    const inactive = evaluateBoosterOptions(
      [shaman({ isActive: false, warcraftLogsId: "55556666" })],
      heroicRun,
    );
    expect(inactive.ineligible[0]?.reason).toBe("INACTIVE");
    expect(inactive.ineligible[0]?.warcraftLogsId).toBe("55556666");
  });

  it("does not block Characters for deprecated manual availability blocks", () => {
    const result = evaluateBoosterOptions([shaman({ warcraftLogsId: "77778888" })], heroicRun);
    expect(result.eligible).toHaveLength(1);
    expect(result.ineligible).toHaveLength(0);
  });

  it("uses stable precedence: inactive > reservation > access", () => {
    const inactiveWins = evaluateBoosterOptions(
      [
        shaman({
          isActive: false,
          reservationConflict: {
            runId: "run-other",
            runTitle: "Other Run",
            scheduledStartAt: "2026-01-01T00:00:00.000Z",
          },
          ownerIsBooster: false,
        }),
      ],
      heroicRun,
    );
    expect(inactiveWins.ineligible[0]?.reason).toBe("INACTIVE");

    const reservationWins = evaluateBoosterOptions(
      [
        shaman({
          reservationConflict: {
            runId: "run-other",
            runTitle: "Other Run",
            scheduledStartAt: "2026-01-01T00:00:00.000Z",
          },
          ownerIsBooster: false,
        }),
      ],
      heroicRun,
    );
    expect(reservationWins.ineligible[0]?.reason).toBe("ALREADY_SELECTED_OTHER_RUN");

    const accessOnly = evaluateBoosterOptions([shaman({ ownerIsBooster: false })], heroicRun);
    expect(accessOnly.ineligible[0]?.reason).toBe("NO_BOOSTER_ACCESS");
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
    expect(assertSignupWindowOpen({ status: "PUBLISHED", signupsOpen: false })).toBe(false);
    expect(assertSignupWindowOpen({ status: "IN_PROGRESS", signupsOpen: true })).toBe(false);
    expect(assertSignupWindowOpen({ status: "OPEN", signupsOpen: true })).toBe(true);
    expect(assertSignupWindowOpen({ status: "ROSTERING", signupsOpen: true })).toBe(true);
    expect(assertSignupWindowOpen({ status: "PUBLISHED", signupsOpen: true })).toBe(true);
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
