import { describe, expect, it } from "vitest";
import type { CharacterRole } from "@/models/enums";
import {
  isLateFillWindow,
  rankReplacementCandidates,
  replacementSignupStateLabel,
  rosterReplacementReasons,
  withdrawnPickOpenRole,
  type ReplacementSignupInput,
} from "@/lib/roster-replacement";
import { CLEAN_ROSTER_SELECTION_RISK, type RosterSelectionRisk } from "@/services/roster-selection-risk";
import type { WclPerformanceRaidSegment } from "@/lib/wcl-performance-display";

const SAVED_RISK: RosterSelectionRisk = {
  level: "WARNING",
  blockers: [],
  warnings: [
    {
      type: "LOCKOUT_ATTENTION",
      fingerprint: "fp",
      contents: [
        {
          raidId: "raid-1",
          raidName: "The Venomous Abyss",
          sortOrder: 1,
          kind: "saved",
          bossesDefeated: 6,
          totalBossCount: 8,
          labelText: "HC 6/8 · Saved",
        },
      ],
    },
  ],
};

function wcl(role: CharacterRole, bestPct: number): WclPerformanceRaidSegment[] {
  return [{ raidId: "raid-1", raidName: "The Venomous Abyss", rankingKind: "zone", roles: [{ role, bestPct, avgPct: bestPct }] }] as unknown as WclPerformanceRaidSegment[];
}

function signup(id: string, overrides: Partial<ReplacementSignupInput> = {}): ReplacementSignupInput {
  return {
    id,
    userId: `user-${id}`,
    status: "PENDING",
    participationType: "BOOSTER",
    isBackup: false,
    assignableRoles: ["HEALER"],
    character: { name: id, realm: "Antonidas", primaryRole: "HEALER", offspecRoles: [], itemLevel: 330 },
    characterActive: true,
    boosterApproved: true,
    scheduleConflicts: [],
    runCommitments: [],
    selectionRisk: CLEAN_ROSTER_SELECTION_RISK,
    syncHealth: "HEALTHY",
    wclPerformance: [],
    ...overrides,
  };
}

function rank(
  signups: ReplacementSignupInput[],
  options: Partial<Parameters<typeof rankReplacementCandidates>[0]> = {},
) {
  return rankReplacementCandidates({
    signups,
    requiredRole: "HEALER",
    staged: new Map(),
    sameRoleOnly: true,
    includeBlocked: false,
    ...options,
  });
}

describe("rosterReplacementReasons — entry points from existing warnings", () => {
  it("saved selected Character offers a replacement, with the per-content label", () => {
    expect(rosterReplacementReasons(signup("Synmist", { selectionRisk: SAVED_RISK }))).toEqual([
      { kind: "SAVED", label: "Saved: The Venomous Abyss HC 6/8 · Saved" },
    ]);
  });

  it("schedule conflict, inactive Character and revoked Booster role offer a replacement", () => {
    expect(
      rosterReplacementReasons(
        signup("a", { scheduleConflicts: [{ message: "Another Run within 2 hours" }] }),
      ).map((row) => row.kind),
    ).toEqual(["SCHEDULE_CONFLICT"]);
    expect(rosterReplacementReasons(signup("b", { characterActive: false })).map((row) => row.kind)).toEqual(["INACTIVE"]);
    expect(rosterReplacementReasons(signup("c", { boosterApproved: false })).map((row) => row.kind)).toEqual([
      "BOOSTER_REVOKED",
    ]);
  });

  it("a healthy slot and a Lootbuddy never offer one", () => {
    expect(rosterReplacementReasons(signup("ok"))).toEqual([]);
    expect(
      rosterReplacementReasons(signup("lb", { participationType: "LOOTBUDDY", selectionRisk: SAVED_RISK })),
    ).toEqual([]);
  });
});

describe("rankReplacementCandidates", () => {
  it("best eligible current signup ranks first: clean, fresh, primary-role fit, higher WCL", () => {
    const ranked = rank([
      signup("Saved", { selectionRisk: SAVED_RISK, wclPerformance: wcl("HEALER", 99) }),
      signup("Stale", { syncHealth: "STALE", wclPerformance: wcl("HEALER", 95) }),
      signup("Offspec", {
        assignableRoles: ["HEALER", "RANGED_DPS"],
        character: { name: "Offspec", realm: "Antonidas", primaryRole: "RANGED_DPS", offspecRoles: ["HEALER"], itemLevel: 340 },
        wclPerformance: wcl("HEALER", 98),
      }),
      signup("LowWcl", { wclPerformance: wcl("HEALER", 40) }),
      signup("TopWcl", { wclPerformance: wcl("HEALER", 90) }),
      signup("NoWcl"),
    ]);
    expect(ranked.map((row) => row.signup.id)).toEqual(["TopWcl", "LowWcl", "NoWcl", "Offspec", "Stale", "Saved"]);
    expect(ranked[0]).toMatchObject({ role: "HEALER", playsRequiredRole: true, saved: false, blocked: false, wclBest: 90 });
  });

  it("WCL orders but never excludes; missing WCL is listed", () => {
    expect(rank([signup("NoWcl")]).map((row) => row.signup.id)).toEqual(["NoWcl"]);
  });

  it("saved candidates stay selectable (marked saved) and rank below clean ones", () => {
    const ranked = rank([signup("Saved", { selectionRisk: SAVED_RISK }), signup("Clean")]);
    expect(ranked.map((row) => [row.signup.id, row.saved])).toEqual([
      ["Clean", false],
      ["Saved", true],
    ]);
  });

  it("schedule conflicts are hidden by default and listed last (blocked) with Show conflicted", () => {
    const conflicted = signup("Conflicted", { scheduleConflicts: [{ message: "Weekly unavailable" }] });
    expect(rank([conflicted, signup("Clean")]).map((row) => row.signup.id)).toEqual(["Clean"]);
    const withRisky = rank([conflicted, signup("Clean")], { includeBlocked: true });
    expect(withRisky.map((row) => [row.signup.id, row.blocked])).toEqual([
      ["Clean", false],
      ["Conflicted", true],
    ]);
  });

  it("planned on another Run ranks below available candidates", () => {
    const ranked = rank([signup("Planned", { runCommitments: [{}] }), signup("Free")]);
    expect(ranked.map((row) => row.signup.id)).toEqual(["Free", "Planned"]);
    expect(ranked[1]!.plannedElsewhere).toBe(true);
  });

  it("same role only (default) drops candidates that cannot play the required role; off lists them after", () => {
    const dps = signup("Mage", {
      assignableRoles: ["RANGED_DPS"],
      character: { name: "Mage", realm: "Antonidas", primaryRole: "RANGED_DPS", offspecRoles: [], itemLevel: 345 },
    });
    expect(rank([dps, signup("Priest")]).map((row) => row.signup.id)).toEqual(["Priest"]);
    const any = rank([dps, signup("Priest")], { sameRoleOnly: false });
    expect(any.map((row) => [row.signup.id, row.role, row.playsRequiredRole])).toEqual([
      ["Priest", "HEALER", true],
      ["Mage", "RANGED_DPS", false],
    ]);
  });

  it("never offers the slot itself, draft picks, withdrawn / inactive / revoked rows or Lootbuddies", () => {
    const ranked = rank(
      [
        signup("Target"),
        signup("InDraft"),
        signup("Withdrawn", { status: "WITHDRAWN" }),
        signup("Inactive", { characterActive: false }),
        signup("Revoked", { boosterApproved: false }),
        signup("Lootbuddy", { participationType: "LOOTBUDDY" }),
        signup("Ok"),
      ],
      {
        staged: new Map<string, CharacterRole | null>([
          ["Target", "HEALER"],
          ["InDraft", "HEALER"],
        ]),
        target: { signupId: "Target", userId: "user-Target" },
      },
    );
    expect(ranked.map((row) => row.signup.id)).toEqual(["Ok"]);
  });

  it("the target's own other Character is offered (swap); a User holding another draft slot is not", () => {
    const ranked = rank(
      [
        signup("Synmist", { userId: "syn" }),
        signup("Synlight", { userId: "syn" }),
        signup("OtherMain", { userId: "other", assignableRoles: ["TANK"] }),
        signup("OtherAlt", { userId: "other" }),
      ],
      {
        staged: new Map<string, CharacterRole | null>([
          ["Synmist", "HEALER"],
          ["OtherMain", "TANK"],
        ]),
        target: { signupId: "Synmist", userId: "syn" },
      },
    );
    expect(ranked.map((row) => row.signup.id)).toEqual(["Synlight"]);
  });

  it("fill-slot mode (no target) works on the same rules", () => {
    expect(rank([signup("A"), signup("B")], { target: null }).map((row) => row.signup.id)).toEqual(["A", "B"]);
  });

  it("is deterministic: equal candidates fall back to name, realm and id", () => {
    const input = [signup("Bravo"), signup("Alpha"), signup("Charlie")];
    const first = rank(input).map((row) => row.signup.id);
    const second = rank([...input].reverse()).map((row) => row.signup.id);
    expect(first).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(second).toEqual(first);
  });
});

describe("withdrawnPickOpenRole", () => {
  it("takes the first offered role whose bucket is still short", () => {
    expect(withdrawnPickOpenRole(["HEALER", "RANGED_DPS"], { tanks: 0, healers: 1, dps: 1 })).toBe("HEALER");
    expect(withdrawnPickOpenRole(["HEALER", "RANGED_DPS"], { tanks: 0, healers: 0, dps: 1 })).toBe("RANGED_DPS");
  });

  it("null once the slot was refilled", () => {
    expect(withdrawnPickOpenRole(["HEALER"], { tanks: 1, healers: 0, dps: 2 })).toBeNull();
  });
});

describe("Late Fill window", () => {
  const now = new Date("2026-10-28T12:00:00.000Z");
  it("is a presentation window before the start, not a Run state", () => {
    expect(isLateFillWindow("2026-10-28T20:00:00.000Z", now)).toBe(true);
    expect(isLateFillWindow("2026-10-29T11:59:00.000Z", now)).toBe(true);
    expect(isLateFillWindow("2026-10-30T12:00:00.000Z", now)).toBe(false);
    expect(isLateFillWindow("2026-10-28T11:00:00.000Z", now)).toBe(true);
  });
});

describe("replacementSignupStateLabel", () => {
  it("shows the signup state", () => {
    expect(replacementSignupStateLabel({ status: "PENDING", isBackup: false })).toBe("Signed up");
    expect(replacementSignupStateLabel({ status: "NOT_SELECTED", isBackup: true })).toBe("Not selected · Backup");
    expect(replacementSignupStateLabel({ status: "SELECTED", isBackup: false })).toBe("Published");
  });
});
