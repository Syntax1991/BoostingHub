import {
  assertCanManageRun,
  canManageRun,
  type AuthenticatedUser,
} from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { integrationEventRepository } from "@/repositories/integration-event.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { runRepository } from "@/repositories/run.repository";
import { compositionWarnings } from "@/services/roster-composition";
import { rosterService, type RosterManagementView } from "@/services/roster.service";
import type { RunStatus } from "@/models/enums";
import { canStartRun } from "@/services/run-state";

export const PREFLIGHT_OVERALL = ["READY", "ATTENTION", "BLOCKED"] as const;
export type PreflightOverall = (typeof PREFLIGHT_OVERALL)[number];

export const PREFLIGHT_CHECK_STATUSES = ["PASS", "WARNING", "ERROR"] as const;
export type PreflightCheckStatus = (typeof PREFLIGHT_CHECK_STATUSES)[number];

export type PreflightCheck = {
  id: string;
  label: string;
  status: PreflightCheckStatus;
  summary: string;
};

export type RunPreflightResult = {
  runId: string;
  overall: PreflightOverall;
  attentionCount: number;
  checks: PreflightCheck[];
};

export type RunPreflightContext = {
  runId: string;
  run: {
    status: RunStatus;
    raidLeadId: string | null;
    raidLeadName: string;
    signupsOpen: boolean;
  };
  manager: RosterManagementView;
  discordPost: {
    runChannelId: string | null;
    signupMessageId: string | null;
  } | null;
  recentDiscordHasError: boolean;
};

function overallFromChecks(checks: PreflightCheck[]): {
  overall: PreflightOverall;
  attentionCount: number;
} {
  const hasError = checks.some((check) => check.status === "ERROR");
  const warnings = checks.filter((check) => check.status === "WARNING").length;
  if (hasError) return { overall: "BLOCKED", attentionCount: checks.filter((c) => c.status !== "PASS").length };
  if (warnings > 0) return { overall: "ATTENTION", attentionCount: warnings };
  return { overall: "READY", attentionCount: 0 };
}

/** Exported for unit tests of overall roll-up. */
export function summarizePreflightChecks(checks: PreflightCheck[]) {
  return overallFromChecks(checks);
}

/**
 * Pure assembly from already-loaded manager context.
 * Does not invent new hard rules — mirrors existing start/publish validators.
 */
export function buildRunPreflight(ctx: RunPreflightContext): RunPreflightResult {
  const { run, manager, discordPost } = ctx;
  const checks: PreflightCheck[] = [];

  // Run status — mirrors startRun hard gate.
  if (run.status === "IN_PROGRESS") {
    checks.push({
      id: "run_status",
      label: "Run status",
      status: "PASS",
      summary: "Run is already in progress.",
    });
  } else if (canStartRun(run.status)) {
    checks.push({
      id: "run_status",
      label: "Run status",
      status: "PASS",
      summary: "Run is published and eligible to start.",
    });
  } else {
    checks.push({
      id: "run_status",
      label: "Run status",
      status: "ERROR",
      summary: `Only a published run can be started (current: ${run.status}).`,
    });
  }

  // Roster publish / seed.
  if (!manager.roster.publishedAt) {
    checks.push({
      id: "roster_published",
      label: "Roster published",
      status: "ERROR",
      summary: "Roster has not been published yet.",
    });
  } else if (manager.roster.needsPublishSeed) {
    checks.push({
      id: "roster_published",
      label: "Roster published",
      status: "ERROR",
      summary: "Published roster draft needs to be seeded before management continues.",
    });
  } else {
    checks.push({
      id: "roster_published",
      label: "Roster published",
      status: "PASS",
      summary: "A published roster exists.",
    });
  }

  // Unpublished draft changes — Start refuses these.
  if (manager.roster.hasUnpublishedChanges) {
    checks.push({
      id: "unpublished_changes",
      label: "Unpublished roster changes",
      status: "ERROR",
      summary: "Roster has unpublished changes. Update the roster before starting.",
    });
  } else {
    checks.push({
      id: "unpublished_changes",
      label: "Unpublished roster changes",
      status: "PASS",
      summary: "No unpublished roster draft changes.",
    });
  }

  // Selected participants — start requires ≥1 published selected.
  const publishedSelectedCount = manager.run.publishedSelectedCount;
  const draftSelectedTotal = manager.validation.composition.total;
  if (publishedSelectedCount < 1 && draftSelectedTotal < 1) {
    checks.push({
      id: "selected_entries",
      label: "Selected participants",
      status: "ERROR",
      summary: "At least one selected participant is required to start.",
    });
  } else if (publishedSelectedCount < 1 && canStartRun(run.status)) {
    checks.push({
      id: "selected_entries",
      label: "Selected participants",
      status: "ERROR",
      summary: "A published roster with at least one selected participant is required.",
    });
  } else {
    checks.push({
      id: "selected_entries",
      label: "Selected participants",
      status: "PASS",
      summary: `${Math.max(publishedSelectedCount, draftSelectedTotal)} selected participant(s).`,
    });
  }

  // Publish blockers (inactive, missing publishedRole, generic DPS, etc.) → ERROR when present.
  for (const blocker of manager.validation.blockers) {
    checks.push({
      id: `publish_blocker:${blocker.code}:${blocker.signupId ?? "run"}`,
      label: "Roster publish invariant",
      status: "ERROR",
      summary: blocker.message,
    });
  }

  // Composition vs desired — WARNING only (existing product rule).
  for (const warning of compositionWarnings(manager.validation.composition)) {
    checks.push({
      id: `composition:${warning.code}:${warning.message}`,
      label: "Desired composition",
      status: "WARNING",
      summary: warning.message,
    });
  }
  for (const warning of manager.validation.warnings) {
    if (checks.some((check) => check.summary === warning.message)) continue;
    checks.push({
      id: `roster_warning:${warning.code}:${warning.signupId ?? "run"}`,
      label: "Roster warning",
      status: "WARNING",
      summary: warning.message,
    });
  }

  // External boosters — informational.
  const externalCount = manager.roster.externalBoosters.length;
  checks.push({
    id: "external_boosters",
    label: "External Boosters",
    status: "PASS",
    summary:
      externalCount === 0
        ? "No External Boosters on this roster."
        : `${externalCount} External Booster(s) on the roster.`,
  });

  // Raid Lead.
  checks.push({
    id: "raid_lead",
    label: "Raid Lead",
    status: run.raidLeadId ? "PASS" : "ERROR",
    summary: run.raidLeadId ? `Raid Lead: ${run.raidLeadName}.` : "No Raid Lead assigned.",
  });

  // Signups open/closed — informational.
  checks.push({
    id: "signups",
    label: "Signups",
    status: "PASS",
    summary: run.signupsOpen ? "Signups are open." : "Signups are closed.",
  });

  // Discord channel / persistent message presence — WARNING only.
  if (!discordPost?.runChannelId) {
    checks.push({
      id: "discord_channel",
      label: "Discord channel",
      status: "WARNING",
      summary: "No Discord run channel id recorded yet.",
    });
  } else {
    checks.push({
      id: "discord_channel",
      label: "Discord channel",
      status: "PASS",
      summary: "Discord run channel is recorded.",
    });
  }
  if (!discordPost?.signupMessageId) {
    checks.push({
      id: "discord_signup_message",
      label: "Discord Signup message",
      status: "WARNING",
      summary: "Signup persistent message id is not recorded.",
    });
  } else {
    checks.push({
      id: "discord_signup_message",
      label: "Discord Signup message",
      status: "PASS",
      summary: "Signup persistent message is recorded.",
    });
  }

  // Global Discord health — WARNING only when recent ERROR telemetry exists.
  if (ctx.recentDiscordHasError) {
    checks.push({
      id: "discord_global",
      label: "Discord integration health",
      status: "WARNING",
      summary: "Recent Discord IntegrationEvent ERROR(s) in the last 24h — check System Health.",
    });
  } else {
    checks.push({
      id: "discord_global",
      label: "Discord integration health",
      status: "PASS",
      summary: "No recent Discord ERROR telemetry in the last 24h.",
    });
  }

  const { overall, attentionCount } = overallFromChecks(checks);
  return { runId: ctx.runId, overall, attentionCount, checks };
}

async function recentDiscordHasError(): Promise<boolean> {
  const recentDiscord = await integrationEventRepository.listRecent({
    provider: "DISCORD",
    createdAfter: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    limit: 20,
  });
  return recentDiscord.some((row) => row.status === "ERROR");
}

/**
 * Computed Run Preflight / Ready Check for managers.
 * Assembles existing start/publish validators — does not invent new hard rules.
 */
export const runPreflightService = {
  async evaluate(user: AuthenticatedUser, runId: string): Promise<RunPreflightResult> {
    const run = await runRepository.findById(runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    if (!canManageRun(user, run)) {
      throw new DomainError("RUN_NOT_MANAGEABLE", "You cannot manage this run.", 403);
    }
    assertCanManageRun(user, run);

    const manager = await rosterService.getRosterManagementView(user, runId);
    const discordPost = await runDiscordPostRepository.findByRunId(runId);
    return buildRunPreflight({
      runId,
      run: {
        status: run.status,
        raidLeadId: run.raidLeadId,
        raidLeadName: run.raidLeadName,
        signupsOpen: run.signupsOpen,
      },
      manager,
      discordPost,
      recentDiscordHasError: await recentDiscordHasError(),
    });
  },

  /** Prefer this from Run Detail when the manager roster view is already loaded. */
  async evaluateWithManager(
    user: AuthenticatedUser,
    runId: string,
    manager: RosterManagementView,
    discordPost: { runChannelId: string | null; signupMessageId: string | null } | null,
  ): Promise<RunPreflightResult> {
    const run = await runRepository.findById(runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    if (!canManageRun(user, run)) {
      throw new DomainError("RUN_NOT_MANAGEABLE", "You cannot manage this run.", 403);
    }
    assertCanManageRun(user, run);

    return buildRunPreflight({
      runId,
      run: {
        status: run.status,
        raidLeadId: run.raidLeadId,
        raidLeadName: run.raidLeadName,
        signupsOpen: run.signupsOpen,
      },
      manager,
      discordPost,
      recentDiscordHasError: await recentDiscordHasError(),
    });
  },
};
