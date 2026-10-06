import { orm } from "@/lib/prisma";
import {
  asNumber,
  asString,
  mapDifficulty,
  mapLootType,
  mapRunStatus,
  mapAttendanceStatus,
} from "@/lib/persistence";
import type { OperationalAnalyticsRunRow } from "@/services/operational-analytics";

const MAX_RANGE_DAYS = 90;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RUNS = 500;

export function resolveAnalyticsRange(input: {
  from?: string | null;
  to?: string | null;
  now?: Date;
}): { from: string; to: string; days: number } {
  const now = input.now ?? new Date();
  const to = input.to?.trim() ? new Date(input.to) : now;
  if (Number.isNaN(to.getTime())) {
    throw new Error("Invalid analytics end date.");
  }
  let from = input.from?.trim()
    ? new Date(input.from)
    : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime())) {
    throw new Error("Invalid analytics start date.");
  }
  if (from.getTime() >= to.getTime()) {
    from = new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  }
  const spanDays = Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
  if (spanDays > MAX_RANGE_DAYS) {
    from = new Date(to.getTime() - MAX_RANGE_DAYS * 24 * 60 * 60 * 1000);
  }
  const boundedDays = Math.min(
    Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))),
    MAX_RANGE_DAYS,
  );
  return { from: from.toISOString(), to: to.toISOString(), days: boundedDays };
}

/**
 * Bounded Run slice for operational analytics. Never unbounded.
 * Uses scheduledStartAt window only (durable schedule authority).
 */
export const operationalAnalyticsRepository = {
  async listRunsInRange(fromIso: string, toIso: string): Promise<OperationalAnalyticsRunRow[]> {
    const runs = (await orm.Run.where((run) => run.scheduledStartAt.gte(fromIso))
      .where((run) => run.scheduledStartAt.lt(toIso))
      .orderBy((run) => run.scheduledStartAt.desc())
      .limit(MAX_RUNS)
      .all()) as Array<Record<string, unknown>>;

    if (runs.length === 0) return [];

    const runIds = runs.map((run) => asString(run.id));
    const signups = (await orm.RunSignup.where((signup) => signup.runId.in(runIds)).all()) as Array<
      Record<string, unknown>
    >;
    const attendance = (await orm.RunAttendance.where((row) => row.runId.in(runIds)).all()) as Array<
      Record<string, unknown>
    >;
    const rosters = (await orm.RunRoster.where((roster) => roster.runId.in(runIds)).all()) as Array<
      Record<string, unknown>
    >;
    const rosterIds = rosters.map((roster) => asString(roster.id));
    const externals =
      rosterIds.length === 0
        ? []
        : ((await orm.RunExternalBooster.where((row) => row.rosterId.in(rosterIds)).all()) as Array<
            Record<string, unknown>
          >);

    const signupByRun = new Map<string, { active: number; selected: number }>();
    for (const signup of signups) {
      const runId = asString(signup.runId);
      const bucket = signupByRun.get(runId) ?? { active: 0, selected: 0 };
      const status = asString(signup.status);
      if (status !== "WITHDRAWN") {
        bucket.active += 1;
        if (status === "SELECTED") bucket.selected += 1;
      }
      signupByRun.set(runId, bucket);
    }

    const attendanceByRun = new Map<string, { noShow: number; marked: number }>();
    for (const row of attendance) {
      const runId = asString(row.runId);
      const bucket = attendanceByRun.get(runId) ?? { noShow: 0, marked: 0 };
      const status = mapAttendanceStatus(row.status);
      if (status !== "UNMARKED") {
        bucket.marked += 1;
        if (status === "NO_SHOW") bucket.noShow += 1;
      }
      attendanceByRun.set(runId, bucket);
    }

    const rosterIdByRun = new Map<string, string>();
    for (const roster of rosters) {
      rosterIdByRun.set(asString(roster.runId), asString(roster.id));
    }
    const externalByRoster = new Map<string, number>();
    for (const row of externals) {
      const rosterId = asString(row.rosterId);
      externalByRoster.set(rosterId, (externalByRoster.get(rosterId) ?? 0) + 1);
    }

    return runs.map((run) => {
      const runId = asString(run.id);
      const signup = signupByRun.get(runId) ?? { active: 0, selected: 0 };
      const att = attendanceByRun.get(runId) ?? { noShow: 0, marked: 0 };
      const rosterId = rosterIdByRun.get(runId);
      return {
        id: runId,
        status: mapRunStatus(run.status),
        difficulty: mapDifficulty(run.difficulty),
        lootType: mapLootType(run.lootType),
        scheduledStartAt: asString(run.scheduledStartAt),
        scheduleRevision: asNumber(run.scheduleRevision, 0),
        activeSignupCount: signup.active,
        selectedSignupCount: signup.selected,
        externalBoosterCount: rosterId ? (externalByRoster.get(rosterId) ?? 0) : 0,
        noShowCount: att.noShow,
        markedAttendanceCount: att.marked,
      };
    });
  },
};
