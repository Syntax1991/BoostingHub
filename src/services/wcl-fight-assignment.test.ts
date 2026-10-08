import { describe, expect, it } from "vitest";
import type {
  WarcraftLogsReportActor,
  WarcraftLogsReportFight,
} from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { fixtureRaidCatalog } from "@/lib/raid-catalog";
import { identityKey } from "@/services/consumable-audit-extract";
import {
  WCL_FIGHT_ASSIGNMENT_POLICY,
  WCL_RUN_MATCH_TOLERANCE_SECONDS,
  absoluteWclTime,
  assignReportFights,
  runActiveWindow,
  type RunAssignmentCandidate,
} from "@/services/wcl-fight-assignment";
import {
  MANAFORGE_OMEGA_RAID_ID,
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
} from "@/lib/wow-raid-catalog";

const WCL_ENCOUNTERS = fixtureRaidCatalog().raidIdByWclEncounterId;

const at = (hhmm: string) => Date.parse(`2026-09-20T${hhmm}:00.000Z`);
const MIN = 60_000;
const TOL = WCL_RUN_MATCH_TOLERANCE_SECONDS * 1000;

/** Report starts 14:05; fight times below are relative to it (as WCL returns them). */
const REPORT_START = at("14:05");

const VA_ENCOUNTERS = [3470, 3445, 3497, 3455, 3420, 3421, 3429, 3492];
const NYMRISSA = 3379;

/** 16 players; A's roster is players 1–16, B's roster is players 9–24. */
const actors: WarcraftLogsReportActor[] = Array.from({ length: 24 }, (_, i) => ({
  id: i + 1,
  name: `Player${i + 1}`,
  server: "Blackhand",
  subType: "Mage",
}));
const keys = (from: number, to: number) =>
  new Set(Array.from({ length: to - from + 1 }, (_, i) => identityKey(`Player${from + i}`, "Blackhand")));
const players = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function fight(
  id: number,
  startClock: string,
  overrides: Partial<WarcraftLogsReportFight> = {},
): WarcraftLogsReportFight {
  const startTime = at(startClock) - REPORT_START;
  return {
    id,
    encounterId: VA_ENCOUNTERS[(id - 1) % 8]!,
    name: `Boss ${((id - 1) % 8) + 1}`,
    startTime,
    endTime: startTime + 5 * MIN,
    kill: true,
    difficulty: 4,
    friendlyPlayers: players(1, 16),
    ...overrides,
  };
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

/** Two consecutive Venomous 8/8 Runs, identical RunRaidContent, one report. */
const runA = run({ runId: "A", startedAtMs: at("14:00"), completedAtMs: at("15:20"), rosterKeys: keys(1, 16) });
const runB = run({ runId: "B", startedAtMs: at("15:30"), completedAtMs: at("16:50"), rosterKeys: keys(9, 24) });
const clocksA = ["14:08", "14:16", "14:24", "14:33", "14:42", "14:51", "15:01", "15:11"];
const clocksB = ["15:42", "15:51", "15:59", "16:08", "16:17", "16:27", "16:38", "16:44"];
const sameReport = {
  startTime: REPORT_START,
  actors,
  fights: [
    ...clocksA.map((clock, i) => fight(i + 1, clock)),
    ...clocksB.map((clock, i) => fight(i + 9, clock, { friendlyPlayers: players(9, 24) })),
  ],
};

describe("absolute WCL time", () => {
  it("converts report-relative milliseconds using the report start", () => {
    expect(absoluteWclTime(REPORT_START, 3 * MIN)).toBe(at("14:08"));
    const [first] = assignReportFights({ raidIdByWclEncounter: WCL_ENCOUNTERS, report: sameReport, target: runA, others: [runB] });
    expect(first!.startMs).toBe(3 * MIN);
    expect(first!.startAtMs).toBe(at("14:08"));
    expect(first!.endAtMs).toBe(at("14:13"));
  });

  it("never compares relative milliseconds against Run timestamps", () => {
    // Relative 3 min would be 1970 if misused as absolute: nothing would match.
    const assigned = assignReportFights({ raidIdByWclEncounter: WCL_ENCOUNTERS, report: sameReport, target: runA, others: [runB] });
    expect(assigned.filter((row) => row.status === "ASSIGNED")).toHaveLength(8);
  });
});

describe("same report, two consecutive identical Runs", () => {
  it("gives Run A fights 1–8 only and Run B fights 9–16 only", () => {
    const a = assignReportFights({ raidIdByWclEncounter: WCL_ENCOUNTERS, report: sameReport, target: runA, others: [runB] });
    const b = assignReportFights({ raidIdByWclEncounter: WCL_ENCOUNTERS, report: sameReport, target: runB, others: [runA] });
    expect(a.map((row) => [row.wclFightId, row.status])).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((id) => [id, "ASSIGNED"]),
    );
    expect(b.map((row) => [row.wclFightId, row.status])).toEqual(
      [9, 10, 11, 12, 13, 14, 15, 16].map((id) => [id, "ASSIGNED"]),
    );
    expect(a[0]!.reasons).toEqual(["TIME_MATCH", "CONTENT_MATCH"]);
  });
});

describe("time tolerance", () => {
  const window = runActiveWindow(runA)!;

  it("pads the active window by the central tolerance", () => {
    expect(window.fromMs).toBe(at("14:00") - TOL);
    expect(window.toMs).toBe(at("15:20") + TOL);
    expect(WCL_FIGHT_ASSIGNMENT_POLICY.toleranceSeconds).toBe(300);
  });

  it("includes fights exactly at each padded boundary and excludes one millisecond beyond", () => {
    const edge = (id: number, absMs: number) => ({
      ...fight(id, "14:08"),
      startTime: absMs - REPORT_START,
      endTime: absMs - REPORT_START + MIN,
    });
    const report = {
      startTime: REPORT_START,
      actors,
      fights: [
        edge(1, window.fromMs - 1),
        edge(2, window.fromMs),
        edge(3, window.toMs),
        edge(4, window.toMs + 1),
      ],
    };
    const result = assignReportFights({ raidIdByWclEncounter: WCL_ENCOUNTERS, report: { ...report, startTime: REPORT_START }, target: runA, others: [] });
    expect(result.map((row) => row.wclFightId)).toEqual([2, 3]);
  });
});

describe("RunRaidContent validation", () => {
  const bundle = run({
    runId: "bundle",
    startedAtMs: at("14:00"),
    completedAtMs: at("15:20"),
    rosterKeys: keys(1, 16),
    contents: [
      { id: "bundle-tide", raidId: TIDEBOUND_GROTTO_RAID_ID },
      { id: "bundle-va", raidId: VENOMOUS_ABYSS_RAID_ID },
    ],
  });
  const report = {
    startTime: REPORT_START,
    actors,
    fights: [
      fight(1, "14:08", { encounterId: NYMRISSA, name: "Nymrissa Wavecaller" }),
      fight(2, "14:16"),
      fight(3, "15:42", { encounterId: NYMRISSA, name: "Nymrissa Wavecaller" }),
    ],
  };

  it("assigns Bundle content (Tidebound + Venomous) to their RunRaidContent, still time-bounded", () => {
    const result = assignReportFights({ raidIdByWclEncounter: WCL_ENCOUNTERS, report, target: bundle, others: [] });
    expect(result.map((row) => [row.wclFightId, row.status, row.raidContentId])).toEqual([
      [1, "ASSIGNED", "bundle-tide"],
      [2, "ASSIGNED", "bundle-va"],
    ]);
  });

  it("ignores in-window encounters outside the Run's content and other difficulties", () => {
    const result = assignReportFights({
      raidIdByWclEncounter: WCL_ENCOUNTERS,
      report: {
        ...report,
        fights: [...report.fights, fight(4, "14:24", { difficulty: 5 })],
      },
      target: runA,
      others: [],
    });
    expect(result.map((row) => [row.wclFightId, row.status, row.reasons.at(-1)])).toEqual([
      [1, "IGNORED", "ENCOUNTER_NOT_IN_RUN_CONTENT"],
      [2, "ASSIGNED", "CONTENT_MATCH"],
      [4, "IGNORED", "DIFFICULTY_MISMATCH"],
    ]);
  });

  it("keeps an encounter unknown to the catalog when time matches", () => {
    const result = assignReportFights({
      raidIdByWclEncounter: WCL_ENCOUNTERS,
      report: { ...report, fights: [fight(1, "14:08", { encounterId: 3513, name: "Kith'ix" })] },
      target: run({ ...runA, contents: [{ id: "mfo", raidId: MANAFORGE_OMEGA_RAID_ID }] }),
      others: [],
    });
    expect(result[0]).toMatchObject({ status: "ASSIGNED", raidContentId: null });
    expect(result[0]!.reasons).toContain("ENCOUNTER_NOT_IN_CATALOG");
  });
});

describe("wipes", () => {
  it("assigns every wipe inside the Run interval, not only kills", () => {
    const report = {
      startTime: REPORT_START,
      actors,
      fights: [
        fight(6, "14:30", { encounterId: 3492, kill: false }),
        fight(7, "14:40", { encounterId: 3492, kill: false }),
        fight(8, "14:50", { encounterId: 3492, kill: false }),
        fight(9, "15:00", { encounterId: 3492, kill: true }),
      ],
    };
    const result = assignReportFights({ raidIdByWclEncounter: WCL_ENCOUNTERS, report, target: runA, others: [runB] });
    expect(result.map((row) => [row.wclFightId, row.kill, row.status])).toEqual([
      [6, false, "ASSIGNED"],
      [7, false, "ASSIGNED"],
      [8, false, "ASSIGNED"],
      [9, true, "ASSIGNED"],
    ]);
  });
});

describe("ambiguity", () => {
  const overlapA = run({ runId: "A", startedAtMs: at("14:00"), completedAtMs: at("15:40"), rosterKeys: keys(1, 16) });
  const overlapB = run({ runId: "B", startedAtMs: at("15:30"), completedAtMs: at("16:50"), rosterKeys: keys(9, 24) });

  it("resolves an overlapping-window fight by clear roster overlap (15/16 vs 7/16)", () => {
    // Players 1–15 plus 24: A has 15/16, B has 7/16 (9–15) + 24 = 8/16.
    const boundary = fight(8, "15:35", { friendlyPlayers: [...players(1, 15), 24] });
    const report = { startTime: REPORT_START, actors, fights: [boundary] };
    const forA = assignReportFights({ raidIdByWclEncounter: WCL_ENCOUNTERS, report, target: overlapA, others: [overlapB] });
    const forB = assignReportFights({ raidIdByWclEncounter: WCL_ENCOUNTERS, report, target: overlapB, others: [overlapA] });
    expect(forA[0]).toMatchObject({ status: "ASSIGNED", rosterMatched: 15, rosterSize: 16 });
    expect(forA[0]!.reasons).toEqual(expect.arrayContaining(["MULTIPLE_RUN_WINDOWS", "ROSTER_RESOLVED"]));
    expect(forB[0]).toMatchObject({ status: "IGNORED", rosterMatched: 8 });
    expect(forB[0]!.reasons).toContain("BELONGS_TO_OTHER_RUN");
  });

  it("keeps overlapping windows reviewable when the roster does not clearly decide", () => {
    const boundary = fight(8, "15:35", { friendlyPlayers: players(5, 20) }); // A 12/16, B 12/16
    const report = { startTime: REPORT_START, actors, fights: [boundary] };
    for (const [target, other] of [
      [overlapA, overlapB],
      [overlapB, overlapA],
    ] as const) {
      const [result] = assignReportFights({ raidIdByWclEncounter: WCL_ENCOUNTERS, report, target, others: [other] });
      expect(result).toMatchObject({ status: "NEEDS_REVIEW" });
      expect(result!.reasons).toContain("MULTIPLE_RUN_WINDOWS");
    }
  });

  it("does not use roster evidence it cannot compute (no fight participants)", () => {
    const boundary = fight(8, "15:35", { friendlyPlayers: null });
    const [result] = assignReportFights({
      raidIdByWclEncounter: WCL_ENCOUNTERS,
      report: { startTime: REPORT_START, actors, fights: [boundary] },
      target: overlapA,
      others: [overlapB],
    });
    expect(result!.status).toBe("NEEDS_REVIEW");
  });

  it("reviews fights of a Run whose completion time was never recorded", () => {
    const open = run({ runId: "legacy", startedAtMs: at("14:00"), completedAtMs: null, rosterKeys: keys(1, 16) });
    const result = assignReportFights({ raidIdByWclEncounter: WCL_ENCOUNTERS, report: sameReport, target: open, others: [] });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((row) => row.status === "NEEDS_REVIEW" && row.reasons.includes("RUN_END_UNKNOWN"))).toBe(
      true,
    );
  });

  it("reviews every content fight of a Run with no recorded window at all", () => {
    const unknown = run({ runId: "old", rosterKeys: keys(1, 16) });
    const result = assignReportFights({ raidIdByWclEncounter: WCL_ENCOUNTERS, report: sameReport, target: unknown, others: [runB] });
    expect(result).toHaveLength(16);
    expect(result.every((row) => row.status === "NEEDS_REVIEW" && row.reasons[0] === "RUN_WINDOW_UNKNOWN")).toBe(
      true,
    );
  });

  it("reviews a lone time match when the Run's roster is barely in the fight", () => {
    const foreign = fight(1, "14:08", { friendlyPlayers: players(17, 24) });
    const [result] = assignReportFights({
      raidIdByWclEncounter: WCL_ENCOUNTERS,
      report: { startTime: REPORT_START, actors, fights: [foreign] },
      target: runA,
      others: [],
    });
    expect(result).toMatchObject({ status: "NEEDS_REVIEW", rosterMatched: 0, rosterSize: 16 });
    expect(result!.reasons).toContain("LOW_ROSTER_OVERLAP");
  });

  it("never auto-assigns a fight another Run already holds", () => {
    const [result] = assignReportFights({
      raidIdByWclEncounter: WCL_ENCOUNTERS,
      report: { startTime: REPORT_START, actors, fights: [fight(1, "14:08")] },
      target: runA,
      others: [],
      assignedElsewhere: new Map([[1, "B"]]),
    });
    expect(result!.status).toBe("NEEDS_REVIEW");
    expect(result!.reasons).toContain("ASSIGNED_TO_OTHER_RUN");
  });
});

describe("roster evidence needs enough known members on every side", () => {
  it("does not let a tiny rival roster (or a tiny target roster) decide", () => {
    const big = run({ runId: "A", startedAtMs: at("14:00"), completedAtMs: at("15:40"), rosterKeys: keys(1, 16) });
    const tiny = run({ runId: "B", startedAtMs: at("15:30"), completedAtMs: at("16:50"), rosterKeys: keys(24, 24) });
    const boundary = fight(8, "15:35", { friendlyPlayers: players(1, 16) });
    const report = { startTime: REPORT_START, actors, fights: [boundary] };
    expect(assignReportFights({ raidIdByWclEncounter: WCL_ENCOUNTERS, report, target: big, others: [tiny] })[0]!.status).toBe("NEEDS_REVIEW");
    expect(assignReportFights({ raidIdByWclEncounter: WCL_ENCOUNTERS, report, target: tiny, others: [big] })[0]!.status).toBe("NEEDS_REVIEW");
  });
});
