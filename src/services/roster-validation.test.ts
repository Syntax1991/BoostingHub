import { describe, expect, it } from "vitest";
import { validateRosterDraft, type RosterValidationMember } from "@/services/roster-validation";

function member(overrides: Partial<RosterValidationMember>): RosterValidationMember {
  return {
    signupId: "s1",
    userId: "u1",
    userName: "Kael",
    characterName: "Stormhowl",
    participationType: "BOOSTER",
    role: "HEALER",
    status: "PENDING",
    characterActive: true,
    boosterApproved: true,
    lockoutConflict: false,
    ...overrides,
  };
}

describe("validateRosterDraft", () => {
  it("treats composition mismatch as warnings, not blockers", () => {
    const result = validateRosterDraft({
      runStatus: "ROSTERING",
      selected: [member({})],
      targets: { tanks: 2, healers: 4, dps: 14 },
    });
    expect(result.canPublish).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("blocks withdrawn, inactive, lockout, missing access, duplicates, and illegal run status", () => {
    const result = validateRosterDraft({
      runStatus: "DRAFT",
      selected: [
        member({ signupId: "w", status: "WITHDRAWN" }),
        member({ signupId: "i", userId: "u2", characterName: "Inactive", characterActive: false }),
        member({ signupId: "l", userId: "u3", characterName: "Locked", lockoutConflict: true }),
        member({ signupId: "a", userId: "u4", characterName: "Windchaser", boosterApproved: false }),
        member({ signupId: "d1", userId: "dup", userName: "Brann", characterName: "Emberforge" }),
        member({ signupId: "d2", userId: "dup", userName: "Brann", characterName: "Emberlight" }),
      ],
      targets: { tanks: 2, healers: 4, dps: 14 },
    });

    expect(result.canPublish).toBe(false);
    expect(result.blockers.map((item) => item.code).sort()).toEqual(
      [
        "BOOSTER_ACCESS_INVALID",
        "CHARACTER_INACTIVE",
        "INVALID_ROSTER_SELECTION",
        "INVALID_STATE_TRANSITION",
        "LOCKOUT_CONFLICT",
        "SIGNUP_WITHDRAWN",
      ].sort(),
    );
  });
});
