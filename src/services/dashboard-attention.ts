import { UPCOMING_RUN_STATUSES, type CharacterRole, type ParticipationType, type RaidDifficulty, type RunStatus, type WowClass } from "@/models/enums";
import type { CharacterScheduleConflict } from "@/services/character-schedule-conflict";
import type { RunOperationalAction, RunOperationalAttention } from "@/services/run-operational-handoff";
import type { signupService } from "@/services/signup.service";

export type MyRunsProjection = Awaited<ReturnType<typeof signupService.getMyRuns>>;
export type MyRunSignupItem = MyRunsProjection["selected"][number];

export type DashboardPersonalCommitment = {
  signupId: string;
  participationType: ParticipationType;
  characterId: string | null;
  characterName: string | null;
  publishedRole: CharacterRole | null;
  isBackup: boolean;
  lootbuddyClass: WowClass | null;
  lootbuddyMode: MyRunSignupItem["lootbuddyMode"];
  scheduleConflicts: CharacterScheduleConflict[];
};

export type DashboardNextSelectedRun = {
  runId: string;
  runTitle: string;
  productLabel: string;
  contentSummary: string;
  difficulty: RaidDifficulty;
  scheduledStartAt: string;
  runStatus: RunStatus;
  commitments: DashboardPersonalCommitment[];
  hasScheduleConflict: boolean;
};

export type DashboardPersonalConflictItem = {
  signupId: string;
  runId: string;
  runTitle: string;
  scheduledStartAt: string;
  characterName: string | null;
  publishedRole: CharacterRole | null;
  messages: string[];
};

export type DashboardPersonalAttention = {
  conflicts: DashboardPersonalConflictItem[];
  nextSelectedRun: DashboardNextSelectedRun | null;
  pendingCount: number;
};

const ATTENTION_CAP = 5;

function isActiveUpcomingRun(status: RunStatus): boolean {
  return UPCOMING_RUN_STATUSES.includes(status);
}

function compareSelectedRuns(a: MyRunSignupItem, b: MyRunSignupItem): number {
  const byStart = a.scheduledStartAt.localeCompare(b.scheduledStartAt);
  if (byStart !== 0) return byStart;
  const byRun = a.runId.localeCompare(b.runId);
  if (byRun !== 0) return byRun;
  return a.id.localeCompare(b.id);
}

function toCommitment(item: MyRunSignupItem): DashboardPersonalCommitment {
  return {
    signupId: item.id,
    participationType: item.participationType,
    characterId: item.characterId,
    characterName: item.characterName,
    publishedRole: item.publishedRole,
    isBackup: item.isBackup,
    lootbuddyClass: item.lootbuddyClass,
    lootbuddyMode: item.lootbuddyMode,
    scheduleConflicts: item.scheduleConflicts,
  };
}

/**
 * Pure personal attention projection from authoritative My Runs DTO.
 * SELECTED on upcoming statuses only; PENDING count excludes terminal Runs.
 */
export function projectPersonalDashboardAttention(myRuns: MyRunsProjection): DashboardPersonalAttention {
  const activeSelected = myRuns.selected
    .filter((item) => isActiveUpcomingRun(item.runStatus))
    .slice()
    .sort(compareSelectedRuns);

  const pendingCount = myRuns.pending.filter((item) => isActiveUpcomingRun(item.runStatus)).length;

  const conflicts: DashboardPersonalConflictItem[] = [];
  for (const item of activeSelected) {
    if (item.participationType !== "BOOSTER" || !item.characterName) continue;
    if (item.scheduleConflicts.length === 0) continue;
    conflicts.push({
      signupId: item.id,
      runId: item.runId,
      runTitle: item.runTitle,
      scheduledStartAt: item.scheduledStartAt,
      characterName: item.characterName,
      publishedRole: item.publishedRole,
      messages: item.scheduleConflicts.map((conflict) => conflict.message),
    });
  }

  let nextSelectedRun: DashboardNextSelectedRun | null = null;
  if (activeSelected.length > 0) {
    const first = activeSelected[0]!;
    const sameRun = activeSelected.filter((item) => item.runId === first.runId);
    const commitments = sameRun.map(toCommitment);
    nextSelectedRun = {
      runId: first.runId,
      runTitle: first.runTitle,
      productLabel: first.productLabel,
      contentSummary: first.contentSummary,
      difficulty: first.difficulty,
      scheduledStartAt: first.scheduledStartAt,
      runStatus: first.runStatus,
      commitments,
      hasScheduleConflict: commitments.some((row) => row.scheduleConflicts.length > 0),
    };
  }

  return {
    conflicts: conflicts.slice(0, ATTENTION_CAP),
    nextSelectedRun,
    pendingCount,
  };
}

export type DashboardOperationItem = {
  runId: string;
  runTitle: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  productLabel: string;
  attention: RunOperationalAttention;
  nextAction: RunOperationalAction;
  unmarkedCount: number;
  settlementStage: string;
  priority: number;
};

const ACTIONABLE_KINDS = new Set([
  "ATTENDANCE",
  "COMPLETE",
  "PREPARE_PAYOUT",
  "REVIEW_PAYOUT",
  "MARK_PAID",
  "BUILD_ROSTER",
  "CONTINUE_ROSTER",
  "START",
]);

function operationPriority(kind: RunOperationalAction["kind"]): number {
  switch (kind) {
    case "MARK_PAID":
      return 10;
    case "ATTENDANCE":
      return 20;
    case "COMPLETE":
      return 30;
    case "PREPARE_PAYOUT":
    case "REVIEW_PAYOUT":
      return 40;
    case "START":
      return 50;
    case "BUILD_ROSTER":
    case "CONTINUE_ROSTER":
      return 60;
    default:
      return 100;
  }
}

export function projectDashboardOperations(input: {
  rows: Array<{
    run: {
      id: string;
      title: string;
      scheduledStartAt: string;
      difficulty: RaidDifficulty;
      contentDisplay: { productLabel: string };
    };
    handoff: {
      attention: RunOperationalAttention;
      nextAction: RunOperationalAction;
      attendance: { unmarkedCount: number };
      settlement: { stage: string };
    };
  }>;
  includeRosterWork: boolean;
  adminOnlyMarkPaid: boolean;
}): {
  operations: DashboardOperationItem[];
  adminMarkPaid: DashboardOperationItem[];
} {
  const operations: DashboardOperationItem[] = [];
  const adminMarkPaid: DashboardOperationItem[] = [];

  for (const row of input.rows) {
    const kind = row.handoff.nextAction.kind;
    if (!ACTIONABLE_KINDS.has(kind)) continue;
    if (kind === "BUILD_ROSTER" || kind === "CONTINUE_ROSTER") {
      if (!input.includeRosterWork) continue;
    }
    if (kind === "VIEW_PAYOUT") continue;

    const item: DashboardOperationItem = {
      runId: row.run.id,
      runTitle: row.run.title,
      scheduledStartAt: row.run.scheduledStartAt,
      difficulty: row.run.difficulty,
      productLabel: row.run.contentDisplay.productLabel,
      attention: row.handoff.attention,
      nextAction: row.handoff.nextAction,
      unmarkedCount: row.handoff.attendance.unmarkedCount,
      settlementStage: row.handoff.settlement.stage,
      priority: operationPriority(kind),
    };

    if (kind === "MARK_PAID") {
      if (input.adminOnlyMarkPaid) {
        adminMarkPaid.push(item);
      }
      continue;
    }

    // RAID_LEAD FINALIZED → VIEW_PAYOUT is skipped above; informational optional omitted for V1
    operations.push(item);
  }

  operations.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.scheduledStartAt.localeCompare(b.scheduledStartAt) || a.runId.localeCompare(b.runId);
  });
  adminMarkPaid.sort(
    (a, b) => a.scheduledStartAt.localeCompare(b.scheduledStartAt) || a.runId.localeCompare(b.runId),
  );

  return {
    operations: operations.slice(0, ATTENTION_CAP),
    adminMarkPaid: adminMarkPaid.slice(0, ATTENTION_CAP),
  };
}

export const DASHBOARD_ATTENTION_CAP = ATTENTION_CAP;
