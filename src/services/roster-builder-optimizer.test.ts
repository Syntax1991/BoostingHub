import { describe, expect, it } from "vitest";
import {
  optimizeRosterProposal,
  type RosterBuilderCandidateInput,
} from "@/services/roster-builder-optimizer";

function booster(input: {
  signupId: string;
  userId: string;
  userName: string;
  wowClass: RosterBuilderCandidateInput["wowClass"];
  roles: RosterBuilderCandidateInput["assignableRoles"];
  itemLevel?: number;
  wcl?: number | null;
  characterName?: string;
}): RosterBuilderCandidateInput {
  const wclByRole: RosterBuilderCandidateInput["wclByRole"] = {};
  for (const role of input.roles) {
    wclByRole[role] = input.wcl ?? null;
  }
  return {
    signupId: input.signupId,
    userId: input.userId,
    userName: input.userName,
    participationType: "BOOSTER",
    assignableRoles: input.roles,
    wowClass: input.wowClass,
    characterName: input.characterName ?? input.userName,
    itemLevel: input.itemLevel ?? 330,
    wclByRole,
    lockoutAttention: false,
    lootbuddyMode: null,
  };
}

describe("optimizeRosterProposal", () => {
  it("prefers missing utility over slightly higher WCL duplicate", () => {
    const mageA = booster({
      signupId: "s-mage-a",
      userId: "u-mage-a",
      userName: "MageA",
      wowClass: "MAGE",
      roles: ["RANGED_DPS"],
      wcl: 95,
      itemLevel: 340,
    });
    const mageB = booster({
      signupId: "s-mage-b",
      userId: "u-mage-b",
      userName: "MageB",
      wowClass: "MAGE",
      roles: ["RANGED_DPS"],
      wcl: 94,
      itemLevel: 339,
    });
    const shaman = booster({
      signupId: "s-shaman",
      userId: "u-shaman",
      userName: "Shaman",
      wowClass: "SHAMAN",
      roles: ["RANGED_DPS"],
      wcl: 88,
      itemLevel: 335,
    });

    // Locked already has a Mage (AI covered). Need 1 more DPS.
    const result = optimizeRosterProposal({
      shortages: { tanks: 0, healers: 0, dps: 1, lootbuddies: 0 },
      locked: [
        {
          signupId: "s-locked-mage",
          userId: "u-locked",
          userName: "LockedMage",
          participationType: "BOOSTER",
          selectedRole: "RANGED_DPS",
          wowClass: "MAGE",
          characterName: "LockedMage",
          itemLevel: 330,
          wclPct: 90,
          lockoutAttention: false,
          lootbuddyMode: null,
        },
      ],
      externals: [],
      candidates: [mageA, mageB, shaman],
    });

    const newly = result.proposed.filter((row) => !row.locked);
    expect(newly).toHaveLength(1);
    expect(newly[0]?.signupId).toBe("s-shaman");
    expect(newly[0]?.utilitiesProvided).toContain("SKYFURY");
  });

  it("allows any Melee/Ranged mix for aggregate DPS (no quotas)", () => {
    const melee = Array.from({ length: 7 }, (_, index) =>
      booster({
        signupId: `s-melee-${index}`,
        userId: `u-melee-${index}`,
        userName: `Melee${index}`,
        wowClass: "WARRIOR",
        roles: ["MELEE_DPS"],
        wcl: 80 + index,
      }),
    );
    const ranged = Array.from({ length: 7 }, (_, index) =>
      booster({
        signupId: `s-ranged-${index}`,
        userId: `u-ranged-${index}`,
        userName: `Ranged${index}`,
        wowClass: "MAGE",
        roles: ["RANGED_DPS"],
        wcl: 70 + index,
      }),
    );

    const result = optimizeRosterProposal({
      shortages: { tanks: 0, healers: 0, dps: 8, lootbuddies: 0 },
      locked: [],
      externals: [],
      candidates: [...melee, ...ranged],
    });

    const newly = result.proposed.filter((row) => !row.locked);
    expect(newly).toHaveLength(8);
    const meleeCount = newly.filter((row) => row.selectedRole === "MELEE_DPS").length;
    const rangedCount = newly.filter((row) => row.selectedRole === "RANGED_DPS").length;
    expect(meleeCount + rangedCount).toBe(8);
    // Highest WCL warriors dominate — may be all melee; that is intentional (no split quota).
    expect(meleeCount).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic across repeated runs", () => {
    const candidates = [
      booster({
        signupId: "s-b",
        userId: "u-b",
        userName: "Bravo",
        wowClass: "PRIEST",
        roles: ["HEALER"],
        wcl: 80,
      }),
      booster({
        signupId: "s-a",
        userId: "u-a",
        userName: "Alpha",
        wowClass: "PRIEST",
        roles: ["HEALER"],
        wcl: 80,
      }),
      booster({
        signupId: "s-c",
        userId: "u-c",
        userName: "Charlie",
        wowClass: "MONK",
        roles: ["HEALER"],
        wcl: 80,
      }),
    ];
    const input = {
      shortages: { tanks: 0, healers: 2, dps: 0, lootbuddies: 0 },
      locked: [],
      externals: [],
      candidates,
    };
    const first = optimizeRosterProposal(input);
    for (let i = 0; i < 9; i += 1) {
      const next = optimizeRosterProposal(input);
      expect(next.proposed.map((row) => `${row.signupId}:${row.selectedRole}`)).toEqual(
        first.proposed.map((row) => `${row.signupId}:${row.selectedRole}`),
      );
    }
  });

  it("keeps locked picks and only fills remaining shortages", () => {
    const result = optimizeRosterProposal({
      shortages: { tanks: 1, healers: 0, dps: 0, lootbuddies: 0 },
      locked: [
        {
          signupId: "s-locked-healer",
          userId: "u-locked",
          userName: "LockedHealer",
          participationType: "BOOSTER",
          selectedRole: "HEALER",
          wowClass: "PRIEST",
          characterName: "LockedHealer",
          itemLevel: 330,
          wclPct: 70,
          lockoutAttention: false,
          lootbuddyMode: null,
        },
      ],
      externals: [],
      candidates: [
        booster({
          signupId: "s-tank",
          userId: "u-tank",
          userName: "Tank",
          wowClass: "WARRIOR",
          roles: ["TANK"],
          wcl: 60,
        }),
        booster({
          signupId: "s-healer2",
          userId: "u-healer2",
          userName: "Healer2",
          wowClass: "MONK",
          roles: ["HEALER"],
          wcl: 99,
        }),
      ],
    });

    expect(result.proposed.some((row) => row.signupId === "s-locked-healer" && row.locked)).toBe(
      true,
    );
    expect(result.proposed.some((row) => row.signupId === "s-tank" && !row.locked)).toBe(true);
    expect(result.proposed.some((row) => row.signupId === "s-healer2")).toBe(false);
  });

  it("still selects candidates with no WCL data", () => {
    const result = optimizeRosterProposal({
      shortages: { tanks: 0, healers: 0, dps: 1, lootbuddies: 0 },
      locked: [],
      externals: [],
      candidates: [
        booster({
          signupId: "s-no-wcl",
          userId: "u-no-wcl",
          userName: "NoLogs",
          wowClass: "HUNTER",
          roles: ["RANGED_DPS"],
          wcl: null,
        }),
      ],
    });
    expect(result.proposed.map((row) => row.signupId)).toEqual(["s-no-wcl"]);
  });

  it("does not award full coverage value for duplicate utilities", () => {
    const first = optimizeRosterProposal({
      shortages: { tanks: 0, healers: 0, dps: 2, lootbuddies: 0 },
      locked: [],
      externals: [],
      candidates: [
        booster({
          signupId: "s-mage-1",
          userId: "u1",
          userName: "M1",
          wowClass: "MAGE",
          roles: ["RANGED_DPS"],
          wcl: 50,
        }),
        booster({
          signupId: "s-mage-2",
          userId: "u2",
          userName: "M2",
          wowClass: "MAGE",
          roles: ["RANGED_DPS"],
          wcl: 99,
        }),
        booster({
          signupId: "s-priest",
          userId: "u3",
          userName: "P1",
          wowClass: "PRIEST",
          roles: ["RANGED_DPS"],
          wcl: 60,
        }),
      ],
    });
    const ids = first.proposed.filter((row) => !row.locked).map((row) => row.signupId);
    // First Mage covers AI (highest WCL Mage wins); second slot prefers Priest Fortitude over duplicate Mage.
    expect(ids).toContain("s-mage-2");
    expect(ids).toContain("s-priest");
    expect(ids).not.toContain("s-mage-1");
  });
});
