import { describe, expect, it } from "vitest";
import type { EligibilityCharacter, EligibilityRun } from "@/services/signup-eligibility";
import {
  evaluateBoosterOptions,
  evaluateLootbuddyOptions,
} from "@/services/signup-eligibility";
import { assertSignupWindowOpen } from "@/services/signup-eligibility";
import { canSelfWithdrawSignup, canTransitionSignup, isBlockingDuplicate } from "@/services/signup-state";
import { canTransitionRun } from "@/services/run-state";
import { boosterSignupSchema, lootbuddySignupSchema, signupOptionsSchema } from "@/validators/signup";

const reset = "2026-W37";

const heroicRun: EligibilityRun = {
  id: "run-heroic",
  raidId: "raid-1",
  difficulty: "HEROIC",
  status: "OPEN",
  signupsOpen: true,
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
    wowClass: "SHAMAN",
    specialization: "Restoration",
    isActive: true,
    boosterQualifications: [{ difficulty: "HEROIC", status: "APPROVED" }],
    lockouts: [],
    ...overrides,
  };
}

describe("booster eligibility", () => {
  it("allows all valid roles when heroic-qualified", () => {
    const result = evaluateBoosterOptions([shaman()], heroicRun, reset);
    expect(result.eligible.map((item) => item.role).sort()).toEqual(["DPS", "HEALER"]);
  });

  it("does not treat heroic approval as mythic eligibility", () => {
    const result = evaluateBoosterOptions([shaman()], mythicRun, reset);
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible[0]?.reason).toBe("DIFFICULTY_NOT_APPROVED");
  });

  it("rejects missing booster access", () => {
    const result = evaluateBoosterOptions([shaman({ boosterQualifications: [] })], heroicRun, reset);
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible[0]?.reason).toBe("NO_BOOSTER_ACCESS");
  });

  it("rejects inactive characters", () => {
    const result = evaluateBoosterOptions([shaman({ isActive: false })], heroicRun, reset);
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible[0]?.reason).toBe("INACTIVE");
  });

  it("rejects a matching raid/difficulty/reset lockout", () => {
    const result = evaluateBoosterOptions(
      [
        shaman({
          lockouts: [
            {
              raidId: "raid-1",
              difficulty: "HEROIC",
              resetIdentifier: reset,
              isComplete: false,
              bossesDefeated: 3,
            },
          ],
        }),
      ],
      heroicRun,
      reset,
    );
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible[0]?.reason).toBe("LOCKOUT_CONFLICT");
  });

  it("can offer two eligible characters for the same run", () => {
    const second: EligibilityCharacter = {
      ...shaman({
        id: "char-2",
        name: "Emberlight",
        wowClass: "PALADIN",
        boosterQualifications: [{ difficulty: "HEROIC", status: "APPROVED" }],
      }),
    };
    const result = evaluateBoosterOptions([shaman(), second], heroicRun, reset);
    expect(result.eligible.map((item) => item.characterId).includes("char-1")).toBe(true);
    expect(result.eligible.map((item) => item.characterId).includes("char-2")).toBe(true);
  });
});

describe("lootbuddy eligibility", () => {
  it("does not require booster access for loot-only or playing", () => {
    const character = shaman({ boosterQualifications: [] });
    const result = evaluateLootbuddyOptions([character], heroicRun, reset);
    expect(result.eligible).toHaveLength(1);
  });

  it("rejects lootbuddy characters with a conflicting lockout", () => {
    const result = evaluateLootbuddyOptions(
      [
        shaman({
          lockouts: [
            {
              raidId: "raid-1",
              difficulty: "HEROIC",
              resetIdentifier: reset,
              isComplete: true,
              bossesDefeated: 8,
            },
          ],
        }),
      ],
      heroicRun,
      reset,
    );
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible[0]?.reason).toBe("LOCKOUT_CONFLICT");
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
      lootbuddySignupSchema.parse({
        runId: "11111111-1111-4111-8111-111111111111",
        characterId: "c1111111-1111-4111-8111-111111111111",
        mode: "LOOT_ONLY",
        verification: "ACCESS",
      }).mode,
    ).toBe("LOOT_ONLY");
    expect(
      lootbuddySignupSchema.parse({
        runId: "11111111-1111-4111-8111-111111111111",
        characterId: "c1111111-1111-4111-8111-111111111111",
        mode: "PLAYING",
        verification: "TRIAL",
      }).verification,
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
