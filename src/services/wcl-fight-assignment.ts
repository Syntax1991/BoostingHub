import type {
  WarcraftLogsReportFight,
  WarcraftLogsReportMetadata,
} from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { identityKey } from "@/services/consumable-audit-extract";
import type { RaidDifficulty } from "@/models/enums";

/**
 * Which Warcraft Logs fights belong to which BoostingHub Run.
 *
 * One report may hold several consecutive Runs with identical RunRaidContent,
 * so raid identity alone never decides. Signals, in order:
 *   1. Time (primary): the fight's ABSOLUTE start lies in the Run's active
 *      window [RunStartSnapshot.startedAt, Run.completedAt] ± tolerance.
 *   2. RunRaidContent + difficulty (validation): the encounter must belong to
 *      the Run's content. Never replaces the time check.
 *   3. Roster overlap (disambiguation): when several Runs' windows contain the
 *      fight, the Run whose roster clearly dominates the fight's players wins.
 * Anything genuinely ambiguous becomes NEEDS_REVIEW — never a guess.
 */
export const WCL_FIGHT_ASSIGNMENT_POLICY = {
  /**
   * Allowed slack between the Run lifecycle and WCL pulls (Start clicked a bit
   * late, Complete a bit early). Kept well below the usual gap between two
   * back-to-back boost Runs so neighbours never swallow each other's fights;
   * overlapping padded windows fall to roster evidence or review.
   */
  toleranceSeconds: 300,
  /** Window length assumed for a started Run whose end is unknown (in progress, or legacy). */
  openWindowMaxHours: 8,
  /** Roster overlap needed to pick one of several time-matching Runs … */
  rosterWinMinShare: 0.5,
  /** … and its minimum lead over every other candidate. */
  rosterWinMargin: 0.3,
  /** A lone candidate whose roster barely appears in the fight is reviewed, not assigned. */
  rosterLowShare: 0.25,
  /** Roster checks need at least this many identity-bearing roster members (every compared Run). */
  rosterMinKnown: 3,
} as const;

export const WCL_RUN_MATCH_TOLERANCE_SECONDS = WCL_FIGHT_ASSIGNMENT_POLICY.toleranceSeconds;

export type WclFightStatus = "ASSIGNED" | "NEEDS_REVIEW" | "IGNORED";

/** Evidence codes, shown to managers as concrete facts — never as a score. */
export type WclFightReason =
  | "TIME_MATCH"
  | "RUN_WINDOW_UNKNOWN"
  | "RUN_END_UNKNOWN"
  | "MULTIPLE_RUN_WINDOWS"
  | "ROSTER_RESOLVED"
  | "LOW_ROSTER_OVERLAP"
  | "BELONGS_TO_OTHER_RUN"
  | "ASSIGNED_TO_OTHER_RUN"
  | "CONTENT_MATCH"
  | "ENCOUNTER_NOT_IN_CATALOG"
  | "ENCOUNTER_NOT_IN_RUN_CONTENT"
  | "DIFFICULTY_MISMATCH"
  | "MANUAL";

export type RunAssignmentCandidate = {
  runId: string;
  difficulty: RaidDifficulty;
  /** RunRaidContent rows (id = RunRaidContent.id). */
  contents: Array<{ id: string; raidId: string }>;
  /** Epoch ms from RunStartSnapshot.startedAt; null when never started / legacy. */
  startedAtMs: number | null;
  /** Epoch ms from Run.completedAt; null when running or completed before it was recorded. */
  completedAtMs: number | null;
  /** identityKey(name, realm) of roster members with a character identity. */
  rosterKeys: ReadonlySet<string>;
};

export type FightAssignment = {
  wclFightId: number;
  encounterId: number;
  encounterName: string;
  kill: boolean;
  difficulty: number | null;
  startMs: number;
  endMs: number;
  startAtMs: number;
  endAtMs: number;
  raidContentId: string | null;
  status: WclFightStatus;
  reasons: WclFightReason[];
  rosterMatched: number | null;
  rosterSize: number | null;
};

const WCL_DIFFICULTY: Record<RaidDifficulty, number> = { NORMAL: 3, HEROIC: 4, MYTHIC: 5 };

/** WCL fight times are relative to the report start; BoostingHub times are absolute. */
export function absoluteWclTime(reportStartMs: number, relativeMs: number): number {
  return reportStartMs + relativeMs;
}

type Window = { fromMs: number; toMs: number; endKnown: boolean };

/** The Run's active window padded by the tolerance; null when it never started. */
export function runActiveWindow(
  run: Pick<RunAssignmentCandidate, "startedAtMs" | "completedAtMs">,
  policy: { toleranceSeconds: number; openWindowMaxHours: number } = WCL_FIGHT_ASSIGNMENT_POLICY,
): Window | null {
  if (run.startedAtMs == null) return null;
  const tolerance = policy.toleranceSeconds * 1000;
  const endKnown = run.completedAtMs != null;
  const end = run.completedAtMs ?? run.startedAtMs + policy.openWindowMaxHours * 3_600_000;
  return { fromMs: run.startedAtMs - tolerance, toMs: end + tolerance, endKnown };
}

function inWindow(window: Window | null, atMs: number): boolean {
  return window != null && atMs >= window.fromMs && atMs <= window.toMs;
}

type ContentCheck = { ok: boolean; raidContentId: string | null; reason: WclFightReason };

function contentCheck(
  fight: WarcraftLogsReportFight,
  run: RunAssignmentCandidate,
  raidIdByWclEncounter: ReadonlyMap<number, string>,
): ContentCheck {
  if (fight.difficulty != null && fight.difficulty !== WCL_DIFFICULTY[run.difficulty]) {
    return { ok: false, raidContentId: null, reason: "DIFFICULTY_MISMATCH" };
  }
  const raidId = raidIdByWclEncounter.get(fight.encounterId);
  if (!raidId) return { ok: true, raidContentId: null, reason: "ENCOUNTER_NOT_IN_CATALOG" };
  const content = run.contents.find((row) => row.raidId === raidId);
  return content
    ? { ok: true, raidContentId: content.id, reason: "CONTENT_MATCH" }
    : { ok: false, raidContentId: null, reason: "ENCOUNTER_NOT_IN_RUN_CONTENT" };
}

function fightPlayerKeys(
  fight: WarcraftLogsReportFight,
  actorKeyById: Map<number, string>,
): Set<string> | null {
  if (!fight.friendlyPlayers) return null;
  const keys = new Set<string>();
  for (const id of fight.friendlyPlayers) {
    const key = actorKeyById.get(id);
    if (key) keys.add(key);
  }
  return keys;
}

function overlap(run: RunAssignmentCandidate, players: Set<string> | null) {
  if (!players || run.rosterKeys.size === 0) return null;
  let matched = 0;
  for (const key of run.rosterKeys) if (players.has(key)) matched += 1;
  return { matched, size: run.rosterKeys.size, share: matched / run.rosterKeys.size };
}

/**
 * Assign every boss fight of one report for `target`, given every other Run
 * whose active window may overlap the report. Pure: persistence applies the
 * result and keeps MANUAL decisions. Only fights relevant to the target are
 * returned — time candidates, or (for a Run with no recorded window) every
 * boss fight as NEEDS_REVIEW.
 */
export function assignReportFights(input: {
  report: Pick<WarcraftLogsReportMetadata, "startTime" | "fights" | "actors">;
  target: RunAssignmentCandidate;
  others: RunAssignmentCandidate[];
  /** wclFightId → runId for fights already ASSIGNED to another Run. */
  assignedElsewhere?: ReadonlyMap<number, string>;
  /** DB catalog WCL encounter id → raid id (`RaidCatalog.raidIdByWclEncounterId`). */
  raidIdByWclEncounter: ReadonlyMap<number, string>;
  policy?: typeof WCL_FIGHT_ASSIGNMENT_POLICY;
}): FightAssignment[] {
  const policy = input.policy ?? WCL_FIGHT_ASSIGNMENT_POLICY;
  const { report, target } = input;
  const others = input.others.filter((run) => run.runId !== target.runId);
  const actorKeyById = new Map(
    report.actors.filter((actor) => actor.server).map((actor) => [actor.id, identityKey(actor.name, actor.server!)]),
  );
  const targetWindow = runActiveWindow(target, policy);
  const otherWindows = others.map((run) => ({ run, window: runActiveWindow(run, policy) }));

  const results: FightAssignment[] = [];
  for (const fight of [...report.fights].sort((a, b) => a.startTime - b.startTime)) {
    if (fight.encounterId <= 0) continue;
    const startAtMs = absoluteWclTime(report.startTime, fight.startTime);
    const endAtMs = absoluteWclTime(report.startTime, fight.endTime);
    const content = contentCheck(fight, target, input.raidIdByWclEncounter);
    const players = fightPlayerKeys(fight, actorKeyById);
    const targetOverlap = overlap(target, players);
    const base = {
      wclFightId: fight.id,
      encounterId: fight.encounterId,
      encounterName: fight.name,
      kill: fight.kill,
      difficulty: fight.difficulty,
      startMs: fight.startTime,
      endMs: fight.endTime,
      startAtMs,
      endAtMs,
      raidContentId: content.raidContentId,
      rosterMatched: targetOverlap?.matched ?? null,
      rosterSize: targetOverlap?.size ?? null,
    };
    const push = (status: WclFightStatus, reasons: WclFightReason[]) => results.push({ ...base, status, reasons });

    if (!targetWindow) {
      // No lifecycle window recorded (e.g. completed before start snapshots
      // existed): time cannot prove anything, so a manager decides.
      if (content.ok) push("NEEDS_REVIEW", ["RUN_WINDOW_UNKNOWN", content.reason]);
      continue;
    }
    if (!inWindow(targetWindow, startAtMs)) continue;
    if (!content.ok) {
      push("IGNORED", ["TIME_MATCH", content.reason]);
      continue;
    }

    const rivals = otherWindows
      .filter(({ run, window }) => inWindow(window, startAtMs) && contentCheck(fight, run, input.raidIdByWclEncounter).ok)
      .map(({ run }) => ({ run, overlap: overlap(run, players) }));
    const ownerElsewhere = input.assignedElsewhere?.get(fight.id);

    let status: WclFightStatus;
    const reasons: WclFightReason[] = ["TIME_MATCH", content.reason];
    if (rivals.length > 0) {
      reasons.push("MULTIPLE_RUN_WINDOWS");
      const rosterKnown =
        targetOverlap != null &&
        target.rosterKeys.size >= policy.rosterMinKnown &&
        // Every compared Run needs enough identity-bearing roster members for
        // its share to mean anything; tiny rosters never decide a fight.
        rivals.every((rival) => rival.overlap != null && rival.run.rosterKeys.size >= policy.rosterMinKnown);
      const best = Math.max(...rivals.map((rival) => rival.overlap?.share ?? 0));
      if (
        rosterKnown &&
        targetOverlap.share >= policy.rosterWinMinShare &&
        targetOverlap.share - best >= policy.rosterWinMargin
      ) {
        status = "ASSIGNED";
        reasons.push("ROSTER_RESOLVED");
      } else if (
        rosterKnown &&
        rivals.some(
          (rival) =>
            rival.overlap!.share >= policy.rosterWinMinShare &&
            rival.overlap!.share - targetOverlap.share >= policy.rosterWinMargin,
        )
      ) {
        status = "IGNORED";
        reasons.push("BELONGS_TO_OTHER_RUN");
      } else {
        status = "NEEDS_REVIEW";
      }
    } else if (!targetWindow.endKnown) {
      status = "NEEDS_REVIEW";
      reasons.push("RUN_END_UNKNOWN");
    } else if (
      targetOverlap != null &&
      target.rosterKeys.size >= policy.rosterMinKnown &&
      targetOverlap.share < policy.rosterLowShare
    ) {
      status = "NEEDS_REVIEW";
      reasons.push("LOW_ROSTER_OVERLAP");
    } else {
      status = "ASSIGNED";
    }

    if (status === "ASSIGNED" && ownerElsewhere && ownerElsewhere !== target.runId) {
      status = "NEEDS_REVIEW";
      reasons.push("ASSIGNED_TO_OTHER_RUN");
    }
    push(status, reasons);
  }
  return results;
}
