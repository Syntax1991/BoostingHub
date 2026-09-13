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

  it("blocks withdrawn, inactive, missing access, duplicates, and illegal run status", () => {
    const result = validateRosterDraft({
      runStatus: "DRAFT",
      selected: [
        member({ signupId: "w", status: "WITHDRAWN" }),
        member({ signupId: "i", userId: "u2", characterName: "Inactive", characterActive: false }),
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
        "SIGNUP_WITHDRAWN",
      ].sort(),
    );
  });

  it("allows the same user as one BOOSTER plus multiple LOOTBUDDY selections", () => {
    const result = validateRosterDraft({
      runStatus: "ROSTERING",
      selected: [
        member({ signupId: "b1", userId: "u1", participationType: "BOOSTER", role: "HEALER" }),
        member({
          signupId: "l1",
          userId: "u1",
          characterName: "Mage",
          participationType: "LOOTBUDDY",
          role: null,
          boosterApproved: true,
        }),
        member({
          signupId: "l2",
          userId: "u1",
          characterName: "Priest",
          participationType: "LOOTBUDDY",
          role: null,
          boosterApproved: true,
        }),
      ],
      targets: { tanks: 2, healers: 4, dps: 14 },
    });
    expect(result.canPublish).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("characterless lootbuddy with characterActive true is not blocked as inactive", () => {
    const result = validateRosterDraft({
      runStatus: "ROSTERING",
      selected: [
        member({
          signupId: "l1",
          characterName: "Mage",
          participationType: "LOOTBUDDY",
          role: null,
          characterActive: true,
          boosterApproved: true,
        }),
      ],
      targets: { tanks: 2, healers: 4, dps: 14 },
    });
    expect(result.canPublish).toBe(true);
  });
  it("raid lockouts are informational only — a locked/saved character never blocks publish", () => {
    // RosterValidationMember carries no lockout field at all anymore; this
    // documents the invariant that validateRosterDraft has nothing left that
    // could reject a member for being raid-saved.
    const result = validateRosterDraft({
      runStatus: "ROSTERING",
      selected: [member({ characterName: "Saved Character" })],
      targets: { tanks: 2, healers: 4, dps: 14 },
    });
    expect(result.canPublish).toBe(true);
    expect(result.blockers).toEqual([]);
  });
});
