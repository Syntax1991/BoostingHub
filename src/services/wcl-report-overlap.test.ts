import { describe, expect, it } from "vitest";
import {
  effectiveRealPulls,
  groupRealPulls,
  matchReportPair,
  overlapFightKey,
  rankCopies,
  snapshotCoversRealPulls,
  type OverlapFight,
} from "@/services/wcl-report-overlap";

const S = 1_000;
const T0 = Date.parse("2026-09-28T17:43:46.550Z");
/** Production: the second logger's clock ran 10.87–10.93 s ahead; durations within 45 ms. */
const SKEW = 10_903;

let nextId = 1;
function fight(
  reportCode: string,
  input: { enc: number; at: number; dur: number; kill?: boolean; difficulty?: number | null; content?: string | null; roster?: number | null; id?: number },
): OverlapFight {
  const id = input.id ?? nextId++;
  return {
    key: overlapFightKey(reportCode, id),
    reportCode,
    encounterId: input.enc,
    difficulty: input.difficulty === undefined ? 4 : input.difficulty,
    kill: input.kill ?? true,
    raidContentId: input.content === undefined ? "va" : input.content,
    startAtMs: T0 + input.at,
    endAtMs: T0 + input.at + input.dur,
    rosterMatched: input.roster === undefined ? 14 : input.roster,
  };
}
type Pull = { enc: number; at: number; dur: number; kill?: boolean };
/** The real Run 75efe798 raid: 9 pulls (7 kills), incl. Lost Explorers + Sszorak wipe → kill. */
const RAID: Pull[] = [
  { enc: 3379, at: 0, dur: 248_228 },
  { enc: 3470, at: 714_513, dur: 293_557 },
  { enc: 3497, at: 1_374_863, dur: 30_332, kill: false },
  { enc: 3497, at: 1_486_651, dur: 222_279 },
  { enc: 3420, at: 2_074_431, dur: 141_145, kill: false },
  { enc: 3420, at: 2_271_911, dur: 293_700 },
  { enc: 3445, at: 2_847_211, dur: 262_583 },
  { enc: 3455, at: 3_371_043, dur: 263_430 },
  { enc: 3421, at: 3_813_617, dur: 398_842 },
];
const logger = (code: string, pulls: readonly Pull[], skew = 0, jitter = (i: number) => (i % 3) * 20) =>
  pulls.map((pull, i) => fight(code, { ...pull, at: pull.at + skew + jitter(i), dur: pull.dur + jitter(i + 1) - 20 }));
const reports = [
  { code: "A", attachedAt: "2026-09-28T21:39:53.000Z" },
  { code: "B", attachedAt: "2026-09-28T21:48:10.000Z" },
];
const countPulls = (fights: OverlapFight[]) => groupRealPulls(fights).length;

describe("unique real pulls across reports linked to one Run", () => {
  it("1. two loggers of the same raid (clock offset ~10.9 s): 9 + 9 → 9, each pull pairs with its twin", () => {
    const a = logger("A", RAID);
    const b = logger("B", RAID, SKEW);
    const groups = groupRealPulls([...a, ...b]);
    expect(groups).toHaveLength(9);
    expect(groups.every((group) => group.length === 2)).toBe(true);
    expect(groups.map((group) => group.map((f) => f.key).sort())).toEqual(a.map((f, i) => [f.key, b[i]!.key].sort()));
  });

  it("2. partial overlap: bosses 1–4 + bosses 3–6 → 6", () => {
    const a = logger("A", RAID.slice(0, 4));
    const b = logger("B", RAID.slice(2, 6), SKEW);
    expect(countPulls([...a, ...b])).toBe(6);
  });

  it("3. no overlap / 15. complementary coverage: bosses 1–4 + bosses 5–8 → 8, nothing discarded", () => {
    const a = logger("A", RAID.slice(0, 4));
    const b = logger("B", RAID.slice(4, 8), SKEW);
    expect(countPulls([...a, ...b])).toBe(8);
  });

  it("4. the same boss pulled three times, two loggers → 3 (not 1, not 6)", () => {
    const pulls = [
      { enc: 3420, at: 0, dur: 45_000, kill: false },
      { enc: 3420, at: 120_000, dur: 61_000, kill: false },
      { enc: 3420, at: 260_000, dur: 293_700 },
    ];
    expect(countPulls([...logger("A", pulls), ...logger("B", pulls, SKEW)])).toBe(3);
  });

  it("5. two genuinely different close wipes of one boss are both kept (same report, or one per report)", () => {
    const wipes = [
      { enc: 3420, at: 0, dur: 20_000, kill: false },
      { enc: 3420, at: 45_000, dur: 20_500, kill: false },
    ];
    expect(countPulls(logger("A", wipes))).toBe(2);
    // Each logger saw a different wipe; the pair's clock offset comes from the shared boss before.
    const shared = { enc: 3379, at: -600_000, dur: 248_228 };
    const a = logger("A", [shared, wipes[0]!]);
    const b = logger("B", [shared, wipes[1]!], SKEW);
    expect(countPulls([...a, ...b])).toBe(3);
  });

  it("6. a wipe and a kill are never one pull, even at the same moment", () => {
    const a = [fight("A", { enc: 3420, at: 0, dur: 60_000, kill: false })];
    const b = [fight("B", { enc: 3420, at: 500, dur: 60_000, kill: true })];
    expect(countPulls([...a, ...b])).toBe(2);
  });

  it("7. / 8. different difficulty or different raid content are never one pull", () => {
    const base = { enc: 3420, at: 0, dur: 60_000 };
    expect(countPulls([fight("A", { ...base, difficulty: 4 }), fight("B", { ...base, at: SKEW, difficulty: 5 })])).toBe(2);
    expect(countPulls([fight("A", { ...base, content: "va" }), fight("B", { ...base, at: SKEW, content: "tide" })])).toBe(2);
    // Unknown content on one side does not block the match.
    expect(countPulls([fight("A", { ...base, content: null }), fight("B", { ...base, at: SKEW, content: "va" })])).toBe(1);
  });

  it("does not match when durations differ, or when the start disagrees with the pair's clock offset", () => {
    const a = logger("A", RAID.slice(0, 3));
    const b = logger("B", RAID.slice(0, 3), SKEW);
    b[1] = { ...b[1]!, endAtMs: b[1]!.endAtMs + 5 * S }; // 5 s longer: another pull
    b[2] = { ...b[2]!, startAtMs: b[2]!.startAtMs + 8 * S, endAtMs: b[2]!.endAtMs + 8 * S }; // offset 18.9 s ≠ 10.9 s
    expect(matchReportPair(a, b).map(([x]) => x)).toEqual([a[0]!.key]);
  });

  it("a single shared pull only matches when the two copies overlap in time (distinct pulls of one raid never overlap)", () => {
    const pull = { enc: 3455, at: 0, dur: 263_430 };
    expect(matchReportPair(logger("A", [pull]), logger("B", [pull], SKEW))).toHaveLength(1);
    const shortWipe = { enc: 3420, at: 0, dur: 20_000, kill: false };
    expect(matchReportPair(logger("A", [shortWipe]), logger("B", [shortWipe], 45_000))).toEqual([]);
  });

  it("large clock offsets are fine when several pulls agree on them", () => {
    expect(countPulls([...logger("A", RAID), ...logger("B", RAID, 7 * 60_000)])).toBe(9);
  });

  it("three loggers of one raid → each pull once", () => {
    expect(countPulls([...logger("A", RAID), ...logger("B", RAID, SKEW), ...logger("C", RAID, -4_000)])).toBe(9);
  });
});

describe("canonical copy", () => {
  it("prefers more identified roster players, then the report covering more of the Run, then the earlier link, then the code", () => {
    const a = fight("A", { enc: 1, at: 0, dur: 60_000, roster: 12 });
    const b = fight("B", { enc: 1, at: SKEW, dur: 60_000, roster: 14 });
    expect(rankCopies([a, b], reports, [a, b])[0]!.key).toBe(b.key);
    const a2 = { ...a, rosterMatched: 14 };
    const extraB = fight("B", { enc: 2, at: 900_000, dur: 60_000 });
    expect(rankCopies([a2, b], reports, [a2, b, extraB])[0]!.key).toBe(b.key); // B covers more
    expect(rankCopies([a2, b], reports, [a2, b])[0]!.key).toBe(a2.key); // A linked earlier
    const late = [{ code: "A", attachedAt: "2026-09-28T22:00:00.000Z" }, reports[1]!];
    expect(rankCopies([b, a2], late, [a2, b])[0]!.key).toBe(b.key);
  });

  it("identical reports: every pull's canonical copy comes from ONE report (one events request)", () => {
    const pulls = effectiveRealPulls([...logger("A", RAID), ...logger("B", RAID, SKEW)], reports);
    expect(new Set(pulls.map((pull) => pull.copies[0]!.reportCode))).toEqual(new Set(["A"]));
  });
});

describe("staleness uses the same projection", () => {
  const pulls = effectiveRealPulls([...logger("A", RAID.slice(0, 3)), ...logger("B", RAID.slice(0, 3), SKEW)], reports);
  const canonical = pulls.map((pull) => pull.copies[0]!.key);

  it("13. a snapshot of the unique pulls is fresh — whichever copy it holds", () => {
    expect(snapshotCoversRealPulls(canonical, pulls)).toBe(true);
    expect(snapshotCoversRealPulls([pulls[0]!.copies[1]!.key, ...canonical.slice(1)], pulls)).toBe(true);
  });

  it("stale when a pull is missing, doubled, or unknown", () => {
    expect(snapshotCoversRealPulls(canonical.slice(1), pulls)).toBe(false);
    expect(snapshotCoversRealPulls([...canonical, pulls[0]!.copies[1]!.key], pulls)).toBe(false);
    expect(snapshotCoversRealPulls([...canonical, "Z#1"], pulls)).toBe(false);
  });
});
