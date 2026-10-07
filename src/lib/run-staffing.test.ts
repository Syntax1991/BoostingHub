import { describe, expect, it } from "vitest";
import type { CompositionMember } from "@/services/roster-composition";
import {
  formatCompositionCounts,
  formatMissingCounts,
  projectRunStaffing,
  selectedRosterMembersForStaffing,
  type RosterPickSource,
} from "@/lib/run-staffing";

function booster(role: CompositionMember["selectedRole"]): CompositionMember {
  return { participationType: "BOOSTER", selectedRole: role };
}

function lootbuddy(): CompositionMember {
  return { participationType: "LOOTBUDDY", selectedRole: null };
}

function roster(melee: number, ranged: number, extras: CompositionMember[] = []): CompositionMember[] {
  return [
    ...extras,
    ...Array.from({ length: melee }, () => booster("MELEE_DPS")),
    ...Array.from({ length: ranged }, () => booster("RANGED_DPS")),
  ];
}

const desired14 = { tanks: 2, healers: 4, dps: 14, lootbuddies: 2 };

describe("projectRunStaffing — aggregate DPS (no Melee/Ranged quotas)", () => {
  it.each([
    ["A: 3M+11R", 3, 11],
    ["B: 10M+4R", 10, 4],
    ["C: 14M+0R", 14, 0],
    ["D: 0M+14R", 0, 14],
  ] as const)("%s is FULLY STAFFED at 14 DPS", (_label, melee, ranged) => {
    const projection = projectRunStaffing({
      desired: desired14,
      selectedRoster: [
        booster("TANK"),
        booster("TANK"),
        booster("HEALER"),
        booster("HEALER"),
        booster("HEALER"),
        booster("HEALER"),
        ...roster(melee, ranged),
        lootbuddy(),
        lootbuddy(),
      ],
    });
    expect(projection.staffed.dps).toBe(14);
    expect(projection.staffed.meleeDps).toBe(melee);
    expect(projection.staffed.rangedDps).toBe(ranged);
    expect(projection.missing.dps).toBe(0);
    expect(projection.status).toBe("FULLY_STAFFED");
    expect(projection).not.toHaveProperty("missingMeleeDps");
    expect(projection).not.toHaveProperty("missingRangedDps");
  });

  it("Case E: 5M+8R = 13 DPS → Missing 1D (not Missing Ranged)", () => {
    const projection = projectRunStaffing({
      desired: desired14,
      selectedRoster: [
        booster("TANK"),
        booster("TANK"),
        booster("HEALER"),
        booster("HEALER"),
        booster("HEALER"),
        booster("HEALER"),
        ...roster(5, 8),
        lootbuddy(),
        lootbuddy(),
      ],
    });
    expect(projection.staffed.dps).toBe(13);
    expect(projection.missing).toEqual({ tanks: 0, healers: 0, dps: 1, lootbuddies: 0 });
    expect(projection.status).toBe("NEEDS_STAFFING");
    expect(formatMissingCounts(projection.missing)).toBe("1D");
    expect(formatMissingCounts(projection.missing)).not.toMatch(/Melee|Ranged/i);
  });

  it("covers independent Tank / Healer / Lootbuddy shortages and multiples", () => {
    const projection = projectRunStaffing({
      desired: { tanks: 2, healers: 4, dps: 14, lootbuddies: 3 },
      selectedRoster: [
        booster("TANK"),
        booster("HEALER"),
        booster("HEALER"),
        ...roster(5, 5),
        lootbuddy(),
      ],
    });
    expect(projection.missing).toEqual({ tanks: 1, healers: 2, dps: 4, lootbuddies: 2 });
    expect(projection.status).toBe("NEEDS_STAFFING");
  });

  it("never returns negative missing on overstaffing; still FULLY_STAFFED", () => {
    const projection = projectRunStaffing({
      desired: { tanks: 2, healers: 4, dps: 14, lootbuddies: 1 },
      selectedRoster: [
        booster("TANK"),
        booster("TANK"),
        booster("TANK"),
        booster("HEALER"),
        booster("HEALER"),
        booster("HEALER"),
        booster("HEALER"),
        booster("HEALER"),
        ...roster(10, 5),
        lootbuddy(),
        lootbuddy(),
      ],
    });
    expect(projection.missing).toEqual({ tanks: 0, healers: 0, dps: 0, lootbuddies: 0 });
    expect(projection.overstaffed).toEqual({ tanks: 1, healers: 1, dps: 1, lootbuddies: 1 });
    expect(projection.status).toBe("FULLY_STAFFED");
  });

  it("generic DPS assignment does not fill the aggregate DPS target", () => {
    const projection = projectRunStaffing({
      desired: { tanks: 0, healers: 0, dps: 2, lootbuddies: 0 },
      selectedRoster: [booster("DPS"), booster("MELEE_DPS")],
    });
    expect(projection.staffed.dps).toBe(1);
    expect(projection.missing.dps).toBe(1);
  });

  it("zero desired values are fully staffed with an empty roster", () => {
    const projection = projectRunStaffing({
      desired: { tanks: 0, healers: 0, dps: 0, lootbuddies: 0 },
      selectedRoster: [],
    });
    expect(projection.status).toBe("FULLY_STAFFED");
  });
});

describe("selectedRosterMembersForStaffing — roster authority", () => {
  function source(partial: Partial<RosterPickSource> & Pick<RosterPickSource, "status">): RosterPickSource {
    return {
      signups: [],
      roster: null,
      ...partial,
    };
  }

  it("DRAFT uses selected draft picks, not unselected/rejected offers", () => {
    const members = selectedRosterMembersForStaffing(
      source({
        status: "DRAFT",
        signups: [
          {
            id: "s1",
            status: "PENDING",
            participationType: "BOOSTER",
            publishedRole: null,
          },
          {
            id: "s2",
            status: "PENDING",
            participationType: "BOOSTER",
            publishedRole: null,
          },
          {
            id: "s3",
            status: "NOT_SELECTED",
            participationType: "BOOSTER",
            publishedRole: null,
          },
        ],
        roster: {
          selections: [
            { signupId: "s1", selected: true, selectedRole: "HEALER" },
            { signupId: "s2", selected: false, selectedRole: "TANK" },
            { signupId: "s3", selected: true, selectedRole: "TANK" },
          ],
          externalBoosters: [],
        },
      }),
    );
    expect(members).toEqual([{ participationType: "BOOSTER", selectedRole: "HEALER" }]);
  });

  it("PUBLISHED uses SELECTED + publishedRole; MELEE and RANGED both count toward DPS", () => {
    const members = selectedRosterMembersForStaffing(
      source({
        status: "PUBLISHED",
        signups: [
          {
            id: "s1",
            status: "SELECTED",
            participationType: "BOOSTER",
            publishedRole: "MELEE_DPS",
          },
          {
            id: "s2",
            status: "SELECTED",
            participationType: "BOOSTER",
            publishedRole: "RANGED_DPS",
          },
          {
            id: "s3",
            status: "PENDING",
            participationType: "BOOSTER",
            publishedRole: null,
          },
          {
            id: "s4",
            status: "SELECTED",
            participationType: "LOOTBUDDY",
            publishedRole: null,
          },
        ],
        roster: {
          selections: [
            // Draft replacement picks must not leak into published staffing.
            { signupId: "s3", selected: true, selectedRole: "TANK" },
          ],
          externalBoosters: [
            { participationType: "BOOSTER", role: "TANK" },
          ],
        },
      }),
    );
    const projection = projectRunStaffing({
      desired: { tanks: 1, healers: 0, dps: 2, lootbuddies: 1 },
      selectedRoster: members,
    });
    expect(projection.staffed).toMatchObject({
      tanks: 1,
      dps: 2,
      meleeDps: 1,
      rangedDps: 1,
      lootbuddies: 1,
    });
    expect(projection.status).toBe("FULLY_STAFFED");
  });

  it("IN_PROGRESS and COMPLETED use the same published SELECTED authority", () => {
    for (const status of ["IN_PROGRESS", "COMPLETED"] as const) {
      const members = selectedRosterMembersForStaffing(
        source({
          status,
          signups: [
            {
              id: "s1",
              status: "SELECTED",
              participationType: "BOOSTER",
              publishedRole: "TANK",
            },
          ],
          roster: null,
        }),
      );
      expect(members).toEqual([{ participationType: "BOOSTER", selectedRole: "TANK" }]);
    }
  });
});

describe("staffing format helpers", () => {
  it("formats compact composition and shortage lines", () => {
    expect(formatCompositionCounts({ tanks: 2, healers: 4, dps: 14, lootbuddies: 3 })).toBe(
      "2T · 4H · 14D · 3LB",
    );
    expect(formatMissingCounts({ tanks: 0, healers: 1, dps: 2, lootbuddies: 1 })).toBe(
      "1H · 2D · 1LB",
    );
  });
});
