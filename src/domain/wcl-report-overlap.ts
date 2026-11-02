/**
 * Several Warcraft Logs reports may be linked to one Run — covering different
 * parts of it, overlapping, or (two people logging) the very same pulls. The
 * Consumables Audit must see every real pull exactly ONCE: the union of unique
 * pulls, never "one report only". Pure.
 *
 * Identity of a real pull across two reports: same encounter, difficulty,
 * kill/wipe and (when both known) raid content, near-equal duration, and start
 * times that differ by the report pair's CLOCK OFFSET. Each logger stamps
 * absolute times with its own computer clock (production: two loggers of one
 * raid were 10.87–10.93 s apart on every pull, durations within 45 ms), so the
 * offset is estimated per report pair from the pulls themselves instead of
 * assuming equal timestamps. Fights of the same report are never merged.
 */

import type { RunWarcraftLogsFightRecord } from "@/repositories/run-warcraft-logs.repository";

export const WCL_REPORT_OVERLAP_POLICY = {
  /** Max difference of durations, and of offset-corrected starts, for one real pull. */
  toleranceMs: 2_000,
  /** Largest plausible clock offset between two loggers of one Run. */
  maxClockOffsetMs: 30 * 60_000,
} as const;

export type OverlapFight = {
  /** Stable id of the report fight, e.g. `${reportCode}#${wclFightId}`. */
  key: string;
  reportCode: string;
  encounterId: number;
  difficulty: number | null;
  kill: boolean;
  raidContentId: string | null;
  startAtMs: number;
  endAtMs: number;
  rosterMatched: number | null;
};

export type OverlapReport = { code: string; attachedAt: string };

export function overlapFightKey(reportCode: string, wclFightId: number): string {
  return `${reportCode}#${wclFightId}`;
}

const duration = (fight: OverlapFight) => fight.endAtMs - fight.startAtMs;

/** Could these two report fights be the same pull (ignoring when they happened)? */
export function sameFightShape(a: OverlapFight, b: OverlapFight, toleranceMs = WCL_REPORT_OVERLAP_POLICY.toleranceMs): boolean {
  return (
    a.encounterId === b.encounterId &&
    a.difficulty === b.difficulty &&
    a.kill === b.kill &&
    (a.raidContentId == null || b.raidContentId == null || a.raidContentId === b.raidContentId) &&
    Math.abs(duration(a) - duration(b)) <= toleranceMs
  );
}

/**
 * Pairs of the same real pull between two reports (one-to-one). The clock
 * offset is the start delta most same-shaped pairs agree on (ties: smallest);
 * a single agreeing pair only counts when the two fights overlap in absolute
 * time anyway — two distinct pulls of one raid can never overlap.
 */
export function matchReportPair(
  a: readonly OverlapFight[],
  b: readonly OverlapFight[],
  policy: typeof WCL_REPORT_OVERLAP_POLICY = WCL_REPORT_OVERLAP_POLICY,
): Array<[string, string]> {
  const candidates = a.flatMap((x) =>
    b.filter((y) => sameFightShape(x, y, policy.toleranceMs)).map((y) => ({ x, y, delta: y.startAtMs - x.startAtMs })),
  ).filter((pair) => Math.abs(pair.delta) <= policy.maxClockOffsetMs);
  if (candidates.length === 0) return [];

  let best: { offset: number; support: number } | null = null;
  for (const { delta } of candidates) {
    const agreeing = candidates.filter((pair) => Math.abs(pair.delta - delta) <= policy.toleranceMs);
    const support = Math.min(new Set(agreeing.map((pair) => pair.x.key)).size, new Set(agreeing.map((pair) => pair.y.key)).size);
    if (!best || support > best.support || (support === best.support && Math.abs(delta) < Math.abs(best.offset))) {
      best = { offset: delta, support };
    }
  }
  if (!best) return [];
  const chosen = best;
  if (chosen.support < 2) {
    const single = candidates.find((pair) => pair.delta === chosen.offset)!;
    if (Math.abs(chosen.offset) >= Math.min(duration(single.x), duration(single.y))) return [];
  }

  const usedA = new Set<string>();
  const usedB = new Set<string>();
  const matches: Array<[string, string]> = [];
  for (const pair of [...candidates].sort((p, q) => Math.abs(p.delta - chosen.offset) - Math.abs(q.delta - chosen.offset))) {
    if (Math.abs(pair.delta - chosen.offset) > policy.toleranceMs) break;
    if (usedA.has(pair.x.key) || usedB.has(pair.y.key)) continue;
    usedA.add(pair.x.key);
    usedB.add(pair.y.key);
    matches.push([pair.x.key, pair.y.key]);
  }
  return matches;
}

/**
 * Real pulls: groups of report fights that are the same pull, earliest first.
 * A group never holds two fights of one report (such a chain is left split).
 */
export function groupRealPulls(fights: readonly OverlapFight[]): OverlapFight[][] {
  const byReport = new Map<string, OverlapFight[]>();
  for (const fight of fights) byReport.set(fight.reportCode, [...(byReport.get(fight.reportCode) ?? []), fight]);
  const codes = [...byReport.keys()].sort();

  const parent = new Map(fights.map((fight) => [fight.key, fight.key]));
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  for (let i = 0; i < codes.length; i += 1) {
    for (let j = i + 1; j < codes.length; j += 1) {
      for (const [x, y] of matchReportPair(byReport.get(codes[i]!)!, byReport.get(codes[j]!)!)) {
        parent.set(find(x), find(y));
      }
    }
  }

  const groups = new Map<string, OverlapFight[]>();
  for (const fight of fights) groups.set(find(fight.key), [...(groups.get(find(fight.key)) ?? []), fight]);
  const result: OverlapFight[][] = [];
  for (const group of groups.values()) {
    const reports = new Set(group.map((fight) => fight.reportCode));
    if (reports.size === group.length) result.push(group);
    else result.push(...group.map((fight) => [fight]));
  }
  return result.sort((g, h) => Math.min(...g.map((f) => f.startAtMs)) - Math.min(...h.map((f) => f.startAtMs)));
}

/**
 * Canonical copy of each real pull, best usable data first: more roster
 * players identified in the fight; then the report covering more of the Run
 * (identical reports then need one report's events, not two); then the
 * earlier-linked report; then the report code. Never array or database order.
 */
export function rankCopies(group: readonly OverlapFight[], reports: readonly OverlapReport[], allFights: readonly OverlapFight[]): OverlapFight[] {
  const coverage = new Map<string, number>();
  for (const fight of allFights) coverage.set(fight.reportCode, (coverage.get(fight.reportCode) ?? 0) + 1);
  const attachedAt = new Map(reports.map((report) => [report.code, Date.parse(report.attachedAt)]));
  return [...group].sort(
    (a, b) =>
      (b.rosterMatched ?? -1) - (a.rosterMatched ?? -1) ||
      (coverage.get(b.reportCode) ?? 0) - (coverage.get(a.reportCode) ?? 0) ||
      (attachedAt.get(a.reportCode) ?? Infinity) - (attachedAt.get(b.reportCode) ?? Infinity) ||
      a.reportCode.localeCompare(b.reportCode),
  );
}

export type EffectiveRealPull = {
  /** Copies of this pull, best first (canonical = copies[0]). */
  copies: OverlapFight[];
};

/** The Run's unique real pulls with their ranked copies, earliest first. */
export function effectiveRealPulls(fights: readonly OverlapFight[], reports: readonly OverlapReport[]): EffectiveRealPull[] {
  return groupRealPulls(fights).map((group) => ({ copies: rankCopies(group, reports, fights) }));
}

/**
 * Does a snapshot (its fight keys) represent every real pull exactly once?
 * False = stale. Any copy of a pull counts (the analysis may have taken a
 * duplicate that carried better data).
 */
export function snapshotCoversRealPulls(snapshotKeys: readonly string[], pulls: readonly EffectiveRealPull[]): boolean {
  const pullOf = new Map<string, number>();
  pulls.forEach((pull, index) => pull.copies.forEach((copy) => pullOf.set(copy.key, index)));
  const seen = new Set<number>();
  for (const key of snapshotKeys) {
    const index = pullOf.get(key);
    if (index === undefined || seen.has(index)) return false;
    seen.add(index);
  }
  return seen.size === pulls.length;
}

/** An assigned fight row as input for cross-report pull identity. */
export function toOverlapFight(row: RunWarcraftLogsFightRecord): OverlapFight {
  return {
    key: overlapFightKey(row.reportCode, row.wclFightId),
    reportCode: row.reportCode,
    encounterId: row.encounterId,
    difficulty: row.difficulty,
    kill: row.kill,
    raidContentId: row.raidContentId,
    startAtMs: Date.parse(row.startAt),
    endAtMs: Date.parse(row.endAt),
    rosterMatched: row.rosterMatched,
  };
}

/**
 * The Run's unique real pulls from its ASSIGNED fights across all linked
 * reports (two loggers of one raid → each pull once). The one rule shared by
 * analysis (manual and automatic) and the staleness check.
 */
export function realPullsOfRun(
  assigned: RunWarcraftLogsFightRecord[],
  reports: Array<{ code: string; attachedAt: string }>,
): EffectiveRealPull[] {
  return effectiveRealPulls(assigned.map(toOverlapFight), reports);
}
