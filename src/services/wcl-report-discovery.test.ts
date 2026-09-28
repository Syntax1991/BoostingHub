import { describe, expect, it } from "vitest";
import type {
  WarcraftLogsReportActor,
  WarcraftLogsReportFight,
} from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { identityKey } from "@/services/consumable-audit-extract";
import type { RunAssignmentCandidate } from "@/services/wcl-fight-assignment";
import { WCL_DISCOVERY_POLICY, evaluateReportDiscovery } from "@/services/wcl-report-discovery";

const at = (hhmm: string, day = 20) => Date.parse(`2026-09-${day}T${hhmm}:00.000Z`);
const MIN = 60_000;
const HOUR = 60 * MIN;
const REPORT_START = at("14:05");
const VA_ENCOUNTERS = [3470, 3445, 3497, 3455, 3420, 3421, 3429, 3492];

const actors: WarcraftLogsReportActor[] = Array.from({ length: 24 }, (_, i) => ({
  id: i + 1,
  name: `Player${i + 1}`,
  server: "Blackhand",
  subType: "Mage",
}));
const keys = (from: number, to: number) =>
  new Set(Array.from({ length: to - from + 1 }, (_, i) => identityKey(`Player${from + i}`, "Blackhand")));
const players = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function fight(id: number, clock: string, friendly = players(1, 16)): WarcraftLogsReportFight {
  const startTime = at(clock) - REPORT_START;
  return { id, encounterId: VA_ENCOUNTERS[(id - 1) % 8]!, name: `Boss ${id}`, startTime, endTime: startTime + 5 * MIN, kill: true, difficulty: 4, friendlyPlayers: friendly };
}
function run(overrides: Partial<RunAssignmentCandidate> & { runId: string }): RunAssignmentCandidate {
  return {
    difficulty: "HEROIC",
    contents: [{ id: `${overrides.runId}-va`, raidId: VENOMOUS_ABYSS_RAID_ID }],
    startedAtMs: null,
    completedAtMs: null,
    rosterKeys: new Set(),
    ...overrides,
  };
}
function report(fights: WarcraftLogsReportFight[], endClock = "16:55") {
  return { startTime: REPORT_START, endTime: at(endClock), actors, fights };
}

const runA = run({ runId: "A", startedAtMs: at("14:00"), completedAtMs: at("15:20"), rosterKeys: keys(1, 16) });
const runB = run({ runId: "B", startedAtMs: at("15:30"), completedAtMs: at("16:50"), rosterKeys: keys(9, 24) });
const fightsA = ["14:08", "14:16", "14:24"].map((clock, i) => fight(i + 1, clock));
const fightsB = ["15:42", "15:51"].map((clock, i) => fight(i + 4, clock, players(9, 24)));
const base = { postedAtMs: at("14:05"), attempts: 0 };

describe("evaluateReportDiscovery — which Runs a centrally posted report belongs to", () => {
  it("one clear completed Run → MATCHED, linked to that Run only; settled once the report is idle", () => {
    const decision = evaluateReportDiscovery({ ...base, report: report(fightsA, "14:30"), candidates: [runA], nowMs: at("17:00") });
    expect(decision).toMatchObject({ status: "MATCHED", outcome: "LINKED", linkRunIds: ["A"], nextAttemptInMs: null });
    expect(decision.perRun).toEqual([{ runId: "A", assigned: 3, needsReview: 0 }]);
  });

  it("the Run is still in progress → PENDING, nothing linked, re-checked in 15 min", () => {
    const running = { ...runA, completedAtMs: null };
    const decision = evaluateReportDiscovery({ ...base, report: report(fightsA, "14:30"), candidates: [running], nowMs: at("14:40") });
    expect(decision).toEqual({ status: "PENDING", outcome: "RUN_IN_PROGRESS", linkRunIds: [], nextAttemptInMs: 15 * MIN, perRun: [] });
  });

  it("later, once the Run is completed, the same report is MATCHED", () => {
    expect(
      evaluateReportDiscovery({ ...base, attempts: 3, report: report(fightsA, "14:30"), candidates: [runA], nowMs: at("15:35") }),
    ).toMatchObject({ status: "MATCHED", linkRunIds: ["A"] });
  });

  it("a freshly started report without boss fights waits; a report that never gets any is ignored after the age limit", () => {
    expect(evaluateReportDiscovery({ ...base, report: report([], "14:06"), candidates: [runA], nowMs: at("14:10") })).toMatchObject({
      status: "PENDING",
      outcome: "NO_BOSS_FIGHTS_YET",
    });
    const late = at("14:06") + (WCL_DISCOVERY_POLICY.maxAgeDays * 24 + 1) * HOUR;
    expect(evaluateReportDiscovery({ ...base, report: report([], "14:06"), candidates: [], nowMs: late })).toMatchObject({
      status: "IGNORED",
      outcome: "NO_BOSS_FIGHTS",
      nextAttemptInMs: null,
    });
  });

  it("one report holding two Runs links both — each keeps only its own fights (existing fight isolation)", () => {
    const decision = evaluateReportDiscovery({ ...base, report: report([...fightsA, ...fightsB]), candidates: [runA, runB], nowMs: at("19:00") });
    expect(decision.status).toBe("MATCHED");
    expect(decision.linkRunIds.sort()).toEqual(["A", "B"]);
    expect(decision.perRun).toEqual([
      { runId: "A", assigned: 3, needsReview: 0 },
      { runId: "B", assigned: 2, needsReview: 0 },
    ]);
  });

  it("two plausible overlapping Runs that the roster cannot separate → NEEDS_REVIEW (both linked for a manager, none chosen)", () => {
    const twin = run({ runId: "T", startedAtMs: at("14:00"), completedAtMs: at("15:20"), rosterKeys: keys(1, 16) });
    const decision = evaluateReportDiscovery({ ...base, report: report(fightsA, "14:30"), candidates: [runA, twin], nowMs: at("17:00") });
    expect(decision.status).toBe("NEEDS_REVIEW");
    expect(decision.perRun.every((row) => row.assigned === 0 && row.needsReview === 3)).toBe(true);
  });

  it("a fight a manager already assigned to another Run is not claimed again", () => {
    const decision = evaluateReportDiscovery({
      ...base,
      report: report(fightsA, "14:30"),
      candidates: [runA],
      assignedFights: new Map([[1, "OTHER"]]),
      nowMs: at("17:00"),
    });
    expect(decision.perRun).toEqual([{ runId: "A", assigned: 2, needsReview: 1 }]);
  });

  it("no Run's window covers the fights → keeps waiting, then IGNORED at the age limit", () => {
    const elsewhere = run({ runId: "X", startedAtMs: at("20:00"), completedAtMs: at("21:00") });
    expect(evaluateReportDiscovery({ ...base, report: report(fightsA, "14:30"), candidates: [elsewhere], nowMs: at("17:00") })).toMatchObject({
      status: "PENDING",
      outcome: "NO_MATCHING_RUN_YET",
    });
    const late = base.postedAtMs + (WCL_DISCOVERY_POLICY.maxAgeDays * 24 + 1) * HOUR;
    expect(evaluateReportDiscovery({ ...base, report: report(fightsA, "14:30"), candidates: [elsewhere], nowMs: late })).toMatchObject({
      status: "IGNORED",
      outcome: "NO_MATCHING_RUN",
      nextAttemptInMs: null,
    });
  });

  it("keeps re-checking a MATCHED report while it still grows (a later Run in the same report must be found)", () => {
    const decision = evaluateReportDiscovery({ ...base, report: report(fightsA, "15:25"), candidates: [runA], nowMs: at("15:40") });
    expect(decision).toMatchObject({ status: "MATCHED", nextAttemptInMs: 15 * MIN });
  });

  it("backs off (bounded) when nothing moves", () => {
    const quiet = (attempts: number) =>
      evaluateReportDiscovery({ ...base, attempts, report: report(fightsA, "14:30"), candidates: [], nowMs: at("20:00") }).nextAttemptInMs;
    expect(quiet(0)).toBe(15 * MIN);
    expect(quiet(2)).toBe(60 * MIN);
    expect(quiet(9)).toBe(WCL_DISCOVERY_POLICY.maxBackoffHours * HOUR);
  });

  it("once linked it stays MATCHED / NEEDS_REVIEW — never back to PENDING, never expired into IGNORED", () => {
    const late = at("14:05") + (WCL_DISCOVERY_POLICY.maxAgeDays * 24 + 1) * HOUR;
    // e.g. a manager moved every fight to a Run outside this report's candidates: nothing to link any more.
    for (const previousStatus of ["MATCHED", "NEEDS_REVIEW"] as const) {
      expect(
        evaluateReportDiscovery({ ...base, previousStatus, report: report(fightsA, "14:30"), candidates: [], nowMs: late }),
      ).toMatchObject({ status: previousStatus, linkRunIds: [], nextAttemptInMs: null });
    }
    expect(
      evaluateReportDiscovery({ ...base, previousStatus: "PENDING", report: report(fightsA, "14:30"), candidates: [], nowMs: late }),
    ).toMatchObject({ status: "IGNORED", outcome: "NO_MATCHING_RUN" });
  });
});
