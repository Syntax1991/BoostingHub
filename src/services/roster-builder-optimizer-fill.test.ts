import { describe, expect, it } from "vitest";
import {
  optimizeRosterProposal,
  type RosterBuilderCandidateInput,
  type RosterBuilderLockedPick,
} from "@/services/roster-builder-optimizer";

function booster(input: {
  signupId: string;
  userId: string;
  wowClass: RosterBuilderCandidateInput["wowClass"];
  roles: RosterBuilderCandidateInput["assignableRoles"];
  primaryRole?: RosterBuilderCandidateInput["primaryRole"];
  offspecRoles?: RosterBuilderCandidateInput["offspecRoles"];
  itemLevel?: number;
  wcl?: number | null;
}): RosterBuilderCandidateInput {
  const wclByRole: RosterBuilderCandidateInput["wclByRole"] = {};
  for (const role of input.roles) wclByRole[role] = input.wcl ?? null;
  return {
    signupId: input.signupId,
    userId: input.userId,
    userName: input.userId,
    participationType: "BOOSTER",
    assignableRoles: input.roles,
    primaryRole: input.primaryRole ?? input.roles[0] ?? null,
    offspecRoles: input.offspecRoles ?? [],
    wowClass: input.wowClass,
    characterName: input.signupId,
    itemLevel: input.itemLevel ?? 330,
    wclByRole,
    lockoutAttention: false,
    lootbuddyMode: null,
  };
}

function lootbuddy(signupId: string, userId: string): RosterBuilderCandidateInput {
  return {
    signupId,
    userId,
    userName: userId,
    participationType: "LOOTBUDDY",
    assignableRoles: [],
    primaryRole: null,
    offspecRoles: [],
    wowClass: "MAGE",
    characterName: null,
    itemLevel: null,
    wclByRole: {},
    lockoutAttention: false,
    lootbuddyMode: "LOOT_ONLY",
  };
}

function lockedPick(
  signupId: string,
  userId: string,
  role: RosterBuilderLockedPick["selectedRole"],
): RosterBuilderLockedPick {
  return {
    signupId,
    userId,
    userName: userId,
    participationType: "BOOSTER",
    selectedRole: role,
    wowClass: "WARRIOR",
    characterName: signupId,
    itemLevel: 330,
    wclPct: null,
    lockoutAttention: false,
    lootbuddyMode: null,
  };
}

const ids = (rows: { signupId: string }[]) => rows.map((row) => row.signupId).sort();
const filled = (result: ReturnType<typeof optimizeRosterProposal>) => result.proposed.filter((row) => !row.locked);
const NONE_MISSING = { tanks: 0, healers: 0, dps: 0, lootbuddies: 0 };

/**
 * Production finding (PR #298 smoke): hybrids with better soft scores took the
 * Healer slots, the healer-only players fell out and DPS stayed short — 10
 * picks where 12 were possible. The number of filled slots now comes first.
 */
describe("optimizeRosterProposal — fills the maximum number of slots", () => {
  // Two Healer/Ranged hybrids score higher as healers than the two healer-only players.
  const hybridA = booster({
    signupId: "hybrid-a",
    userId: "u-a",
    wowClass: "DRUID",
    roles: ["HEALER", "RANGED_DPS"],
    primaryRole: "HEALER",
    offspecRoles: ["RANGED_DPS"],
    itemLevel: 345,
    wcl: 95,
  });
  const hybridB = booster({
    signupId: "hybrid-b",
    userId: "u-b",
    wowClass: "SHAMAN",
    roles: ["HEALER", "RANGED_DPS"],
    primaryRole: "HEALER",
    offspecRoles: ["RANGED_DPS"],
    itemLevel: 344,
    wcl: 90,
  });
  const healerC = booster({ signupId: "healer-c", userId: "u-c", wowClass: "PRIEST", roles: ["HEALER"], itemLevel: 320, wcl: 40 });
  const healerD = booster({ signupId: "healer-d", userId: "u-d", wowClass: "PALADIN", roles: ["HEALER"], itemLevel: 319, wcl: 35 });

  it("hybrids move to DPS so the healer-only players still fit (4/4 instead of 2/4)", () => {
    const result = optimizeRosterProposal({
      shortages: { tanks: 0, healers: 2, dps: 2, lootbuddies: 0 },
      locked: [],
      externals: [],
      candidates: [hybridA, hybridB, healerC, healerD],
    });
    expect(result.missingAfterProposal).toEqual(NONE_MISSING);
    const byId = new Map(result.proposed.map((row) => [row.signupId, row]));
    expect(byId.get("healer-c")?.selectedRole).toBe("HEALER");
    expect(byId.get("healer-d")?.selectedRole).toBe("HEALER");
    expect(byId.get("hybrid-a")?.selectedRole).toBe("RANGED_DPS");
    expect(byId.get("hybrid-b")?.selectedRole).toBe("RANGED_DPS");
  });

  it("quality still decides between equally complete rosters", () => {
    const weakHealer = booster({ signupId: "healer-e", userId: "u-e", wowClass: "PRIEST", roles: ["HEALER"], itemLevel: 300, wcl: 5 });
    const result = optimizeRosterProposal({
      shortages: { tanks: 0, healers: 2, dps: 2, lootbuddies: 0 },
      locked: [],
      externals: [],
      candidates: [hybridA, hybridB, healerC, healerD, weakHealer],
    });
    expect(result.missingAfterProposal).toEqual(NONE_MISSING);
    expect(ids(filled(result))).toEqual(["healer-c", "healer-d", "hybrid-a", "hybrid-b"]);
  });

  it("does not force single-role players first when that would not fill more slots", () => {
    // Enough DPS-only players: the better hybrid stays the healer, the weaker healer-only player stays out.
    const dps1 = booster({ signupId: "dps-1", userId: "u-1", wowClass: "MAGE", roles: ["RANGED_DPS"] });
    const dps2 = booster({ signupId: "dps-2", userId: "u-2", wowClass: "HUNTER", roles: ["RANGED_DPS"] });
    const result = optimizeRosterProposal({
      shortages: { tanks: 0, healers: 1, dps: 2, lootbuddies: 0 },
      locked: [],
      externals: [],
      candidates: [hybridA, healerC, dps1, dps2],
    });
    expect(result.missingAfterProposal).toEqual(NONE_MISSING);
    expect(result.proposed.find((row) => row.signupId === "hybrid-a")?.selectedRole).toBe("HEALER");
    expect(result.proposed.some((row) => row.signupId === "healer-c")).toBe(false);
  });

  it("one slot per User across Characters: an alt never takes a second slot", () => {
    // u-x has a Healer main and a Tank alt; u-y can only tank.
    const xHealer = booster({ signupId: "x-healer", userId: "u-x", wowClass: "PRIEST", roles: ["HEALER"], itemLevel: 340 });
    const xTank = booster({ signupId: "x-tank", userId: "u-x", wowClass: "WARRIOR", roles: ["TANK"], itemLevel: 345 });
    const yTank = booster({ signupId: "y-tank", userId: "u-y", wowClass: "PALADIN", roles: ["TANK"], itemLevel: 300 });
    const result = optimizeRosterProposal({
      shortages: { tanks: 1, healers: 1, dps: 0, lootbuddies: 0 },
      locked: [],
      externals: [],
      candidates: [xHealer, xTank, yTank],
    });
    expect(result.missingAfterProposal).toEqual(NONE_MISSING);
    expect(ids(filled(result))).toEqual(["x-healer", "y-tank"]);
  });

  it("an incomplete roster stays as full as possible and reports the true remaining gap", () => {
    const result = optimizeRosterProposal({
      shortages: { tanks: 1, healers: 2, dps: 3, lootbuddies: 0 },
      locked: [],
      externals: [],
      candidates: [hybridA, hybridB, healerC],
    });
    // Three players, no tank: all three placed, nobody can tank.
    expect(filled(result)).toHaveLength(3);
    expect(result.missingAfterProposal.tanks).toBe(1);
    expect(result.missingAfterProposal.healers + result.missingAfterProposal.dps).toBe(2);
  });

  it("Fill gaps: locked picks are never replaced and their Users are never reused", () => {
    const result = optimizeRosterProposal({
      shortages: { tanks: 0, healers: 1, dps: 2, lootbuddies: 0 },
      locked: [lockedPick("locked-heal", "u-locked", "HEALER")],
      externals: [],
      candidates: [
        hybridA,
        hybridB,
        healerC,
        booster({ signupId: "locked-user-alt", userId: "u-locked", wowClass: "MAGE", roles: ["RANGED_DPS"] }),
      ],
    });
    expect(result.proposed.find((row) => row.signupId === "locked-heal")).toMatchObject({
      locked: true,
      selectedRole: "HEALER",
    });
    expect(result.proposed.some((row) => row.signupId === "locked-user-alt")).toBe(false);
    expect(result.missingAfterProposal).toEqual(NONE_MISSING);
    expect(result.proposed.find((row) => row.signupId === "healer-c")?.selectedRole).toBe("HEALER");
  });

  it("Lootbuddies fill their own bucket and never block Booster slots", () => {
    const result = optimizeRosterProposal({
      shortages: { tanks: 0, healers: 2, dps: 2, lootbuddies: 1 },
      locked: [],
      externals: [],
      candidates: [hybridA, hybridB, healerC, healerD, lootbuddy("lb-1", "u-c")],
    });
    expect(result.missingAfterProposal).toEqual(NONE_MISSING);
    expect(result.proposed.find((row) => row.signupId === "lb-1")?.bucket).toBe("LOOTBUDDY");
  });

  it("is deterministic regardless of candidate input order", () => {
    const input = [hybridA, hybridB, healerC, healerD];
    const run = (candidates: RosterBuilderCandidateInput[]) =>
      optimizeRosterProposal({
        shortages: { tanks: 0, healers: 2, dps: 2, lootbuddies: 0 },
        locked: [],
        externals: [],
        candidates,
      }).proposed.map((row) => `${row.signupId}:${row.selectedRole}`);
    expect(run([...input].reverse())).toEqual(run(input));
  });
});

describe("optimizeRosterProposal — fill count matches a brute-force optimum", () => {
  type Bucket = "TANK" | "HEALER" | "DPS";
  const ROLE_FOR: Record<Bucket, RosterBuilderCandidateInput["assignableRoles"][number]> = {
    TANK: "TANK",
    HEALER: "HEALER",
    DPS: "RANGED_DPS",
  };
  const CLASSES = ["DRUID", "PALADIN", "PRIEST", "SHAMAN", "MONK", "WARRIOR", "MAGE"] as const;

  /** Deterministic LCG — the same 300 constellations on every run. */
  function random(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  }

  function bruteForceMaxFill(users: Bucket[][][], need: Record<Bucket, number>): number {
    // users[u] = list of Characters, each a list of buckets it can fill; one slot per User.
    const options = users.map((characters) => [...new Set(characters.flat())]);
    let best = 0;
    const walk = (index: number, left: Record<Bucket, number>, count: number) => {
      if (index === options.length) {
        best = Math.max(best, count);
        return;
      }
      walk(index + 1, left, count);
      for (const bucket of options[index]!) {
        if (left[bucket] === 0) continue;
        walk(index + 1, { ...left, [bucket]: left[bucket] - 1 }, count + 1);
      }
    };
    walk(0, need, 0);
    return best;
  }

  it("fills exactly as many slots as the best possible assignment (300 random constellations)", () => {
    const next = random(298);
    const buckets: Bucket[] = ["TANK", "HEALER", "DPS"];
    for (let round = 0; round < 300; round += 1) {
      const need: Record<Bucket, number> = {
        TANK: Math.floor(next() * 3),
        HEALER: Math.floor(next() * 4),
        DPS: Math.floor(next() * 4),
      };
      const userCount = 2 + Math.floor(next() * 6);
      const users: Bucket[][][] = [];
      const candidates: RosterBuilderCandidateInput[] = [];
      for (let user = 0; user < userCount; user += 1) {
        const characterCount = 1 + Math.floor(next() * 2);
        const characters: Bucket[][] = [];
        for (let character = 0; character < characterCount; character += 1) {
          const roles = buckets.filter(() => next() < 0.45);
          if (roles.length === 0) roles.push(buckets[Math.floor(next() * 3)]!);
          characters.push(roles);
          candidates.push(
            booster({
              signupId: `r${round}-u${user}-c${character}`,
              userId: `r${round}-u${user}`,
              wowClass: CLASSES[Math.floor(next() * CLASSES.length)]!,
              roles: roles.map((bucket) => ROLE_FOR[bucket]),
              itemLevel: 300 + Math.floor(next() * 50),
              wcl: Math.floor(next() * 100),
            }),
          );
        }
        users.push(characters);
      }
      const result = optimizeRosterProposal({
        shortages: { tanks: need.TANK, healers: need.HEALER, dps: need.DPS, lootbuddies: 0 },
        locked: [],
        externals: [],
        candidates,
      });
      const picks = filled(result);
      expect(picks.length, `round ${round}`).toBe(bruteForceMaxFill(users, need));
      // One slot per User, never above the requested count per bucket.
      expect(new Set(picks.map((row) => row.userId)).size).toBe(picks.length);
      for (const bucket of buckets) {
        expect(picks.filter((row) => row.bucket === bucket).length).toBeLessThanOrEqual(need[bucket]);
      }
    }
  });
});
