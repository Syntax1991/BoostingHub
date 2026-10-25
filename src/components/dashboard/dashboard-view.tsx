import type { ReactNode } from "react";
import Link from "next/link";
import { formatDate, formatRelative, formatTime } from "@/lib/datetime";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { PageWorkspace } from "@/components/ui/layout";
import { DifficultyBadge } from "@/components/ui/badges";
import { RoleIcon, LootbuddyIcon, QuietOkIcon } from "@/components/ui/ops-icons";
import { runDetailPath } from "@/lib/run-routes";
import { APP_CONTROL_CENTER_HEADING } from "@/lib/branding";
import {
  CHARACTER_ROLE_LABELS,
  CLASS_LABELS,
  LOOTBUDDY_MODE_LABELS,
} from "@/lib/labels";
import { cn } from "@/lib/cn";
import type { dashboardController } from "@/controllers/dashboard.controller";
import type {
  DashboardNextSelectedRun,
  DashboardOperationItem,
  DashboardPersonalCommitment,
} from "@/services/dashboard-attention";

type DashboardData = Awaited<ReturnType<typeof dashboardController.getDashboard>>;

/** Compact when line: "Tue 08/09 · 21:00" */
function formatShortWhen(value: string, timeZone: string): string {
  const date = formatDate(value, timeZone).replace(/\/\d{4}$/, "");
  return `${date} · ${formatTime(value, timeZone)}`;
}

function operationReason(item: DashboardOperationItem): string {
  switch (item.nextAction.kind) {
    case "ATTENDANCE":
      return item.unmarkedCount === 1
        ? "1 attendance entry unmarked"
        : `${item.unmarkedCount} attendance entries unmarked`;
    case "COMPLETE":
      return "Ready to complete";
    case "START":
      return "Ready to start";
    case "BUILD_ROSTER":
      return "Roster not started";
    case "CONTINUE_ROSTER":
      return "Roster incomplete";
    default:
      return item.nextAction.label;
  }
}

function operationHref(item: DashboardOperationItem): string {
  if (item.nextAction.mode === "link" && item.nextAction.tab) {
    return runDetailPath(item.runId, item.nextAction.tab);
  }
  return runDetailPath(item.runId);
}

function nextRunStatusLabel(run: DashboardNextSelectedRun): string {
  if (run.runStatus === "PUBLISHED" || run.runStatus === "IN_PROGRESS" || run.runStatus === "COMPLETED") {
    return "Selected · Confirmed";
  }
  return "Selected";
}

function commitmentPrimary(commitment: DashboardPersonalCommitment): {
  name: string;
  roleLabel: string | null;
  isLootbuddy: boolean;
  role: DashboardPersonalCommitment["publishedRole"];
} {
  if (commitment.participationType === "LOOTBUDDY") {
    const classLabel = commitment.lootbuddyClass ? CLASS_LABELS[commitment.lootbuddyClass] : "Lootbuddy";
    const mode = commitment.lootbuddyMode ? LOOTBUDDY_MODE_LABELS[commitment.lootbuddyMode] : null;
    return {
      name: classLabel,
      roleLabel: mode ? `Lootbuddy · ${mode}` : "Lootbuddy",
      isLootbuddy: true,
      role: null,
    };
  }
  const base =
    commitment.characterName && commitment.characterRealm
      ? `${commitment.characterName}-${commitment.characterRealm}`
      : (commitment.characterName ?? "Unknown character");
  const roleLabel = commitment.publishedRole
    ? CHARACTER_ROLE_LABELS[commitment.publishedRole]
    : null;
  return {
    name: commitment.isBackup ? `${base} · Backup` : base,
    roleLabel,
    isLootbuddy: false,
    role: commitment.publishedRole,
  };
}

/**
 * One cohesive surface per functional area — Raid Hub–like boxes without KPI spam.
 * Shared vocabulary: surface bg, 1px border, ~8–10px radius, 16px padding.
 */
function DashboardModule({
  children,
  title,
  actions,
  className,
  tone = "default",
  titleClassName,
  id,
}: {
  children: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
  tone?: "default" | "emphasis" | "quiet";
  titleClassName?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "rounded-lg border p-4",
        tone === "default" && "border-border bg-surface",
        tone === "emphasis" && "border-border bg-surface-raised",
        tone === "quiet" && "border-border/80 bg-surface/80",
        className,
      )}
    >
      {title != null || actions != null ? (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          {title != null ? (
            <h2
              className={cn(
                "text-sm font-semibold tracking-tight text-foreground",
                titleClassName,
              )}
            >
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function DashboardView({ data, timeZone }: { data: DashboardData; timeZone: string }) {
  const { personal } = data;
  const conflictCount = personal.conflicts.length;
  const lockoutFlags = data.characters.lockoutAttentionCount;
  const syncIssues = data.characters.syncIssueCount ?? 0;
  const readyCount = data.characters.readyCount ?? data.characters.activeCount;
  const opsCount = data.showOperations ? data.operations.length : 0;
  const activityPreview = data.recentActivity.slice(0, 5);
  const hasActionableProblems =
    personal.pendingCount > 0 || opsCount > 0 || conflictCount > 0 || lockoutFlags > 0 || syncIssues > 0;

  return (
    <PageWorkspace width="wide">
      <PageHeader
        title="Dashboard"
        description="What needs attention — then jump to the workflow."
        className="mb-3 [&_h1]:text-xl"
      />

      {/* Attention strip — inline context, not a module */}
      <div className="mb-4 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm">
        <SummaryStat
          value={personal.pendingCount}
          label="Pending"
          href="/my-runs"
          emphasize={personal.pendingCount > 0}
          tone={personal.pendingCount > 0 ? "warning" : "quiet"}
        />
        {data.showOperations ? (
          <>
            <StripSep />
            <SummaryStat
              value={opsCount}
              label="Ops handoffs"
              href="#control-center"
              emphasize={opsCount > 0}
              tone={opsCount > 0 ? "accent" : "quiet"}
            />
          </>
        ) : null}
        <StripSep />
        {conflictCount > 0 ? (
          <SummaryStat value={conflictCount} label="Conflicts" emphasize tone="danger" />
        ) : (
          <QuietConfirm label="No conflicts" />
        )}
        <StripSep />
        {lockoutFlags > 0 ? (
          <SummaryStat
            value={lockoutFlags}
            label="Lockout issues"
            href="/characters"
            emphasize
            tone="warning"
          />
        ) : (
          <QuietConfirm label="No lockout issues" />
        )}
        <StripSep />
        <span className="text-xs text-muted">
          {data.characters.activeCount} active character
          {data.characters.activeCount === 1 ? "" : "s"}
        </span>
        {!hasActionableProblems && data.showOperations && opsCount === 0 ? (
          <>
            <StripSep />
            <QuietConfirm label="No operational issues" />
          </>
        ) : null}
      </div>

      {/*
        One shared desktop board: left rail (Control Center → Characters) and
        right rail (Next Run / Upcoming → Recent Activity) share the same tracks.
      */}
      <div className="dashboard-board">
        {data.showOperations ? (
          <DashboardModule
            id="control-center"
            className="dashboard-board-primary min-w-0"
            tone="emphasis"
            title={APP_CONTROL_CENTER_HEADING}
            titleClassName="text-base"
            actions={
              <Link href="/manage/runs" className="text-xs text-muted hover:text-accent hover:underline">
                Manage runs
              </Link>
            }
          >
            {data.operations.length === 0 ? (
              <p className="flex items-center gap-1.5 text-sm text-muted">
                <QuietOkIcon label="No operational issues" size={14} />
                No operational issues
              </p>
            ) : (
              <ul className="-mx-1 divide-y divide-border/70">
                {data.operations.map((item) => (
                  <li
                    key={item.runId}
                    className="flex flex-wrap items-center justify-between gap-3 px-1 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={runDetailPath(item.runId)}
                        className="text-[15px] font-semibold text-foreground hover:text-accent"
                      >
                        {item.runTitle}
                      </Link>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {formatShortWhen(item.scheduledStartAt, timeZone)}
                      </p>
                      <p className="mt-1 text-[13px] text-foreground/80">{operationReason(item)}</p>
                    </div>
                    <Link
                      href={operationHref(item)}
                      className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover"
                    >
                      {item.nextAction.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {conflictCount > 0 ? (
              <div className="mt-4 border-t border-border/70 pt-3">
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  Schedule conflicts
                  <span className="ml-1.5 text-xs font-normal text-muted">({conflictCount})</span>
                </h3>
                <ul className="space-y-2">
                  {personal.conflicts.map((conflict) => (
                    <li key={conflict.signupId} className="text-sm">
                      <Link
                        href={runDetailPath(conflict.runId)}
                        className="font-medium text-danger hover:underline"
                      >
                        {conflict.runTitle}
                      </Link>
                      {conflict.characterName ? (
                        <span className="text-xs text-muted">
                          {" "}
                          · {conflict.characterName}
                          {conflict.publishedRole
                            ? ` · ${CHARACTER_ROLE_LABELS[conflict.publishedRole]}`
                            : ""}
                        </span>
                      ) : null}
                      <p className="mt-0.5 text-[11px] text-muted">{conflict.messages.join("; ")}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </DashboardModule>
        ) : conflictCount > 0 ? (
          <DashboardModule title="Needs attention" className="dashboard-board-primary min-w-0" tone="emphasis">
            <ul className="-mx-1 divide-y divide-border/70">
              {personal.conflicts.map((conflict) => (
                <li key={conflict.signupId} className="px-1 py-3 first:pt-0 last:pb-0 text-sm">
                  <p className="text-xs font-medium text-danger">Schedule conflict</p>
                  <Link
                    href={runDetailPath(conflict.runId)}
                    className="mt-0.5 block text-[15px] font-semibold text-foreground hover:text-accent"
                  >
                    {conflict.runTitle}
                  </Link>
                  {conflict.characterName ? (
                    <p className="mt-0.5 text-[12px] text-muted">
                      {conflict.characterName}
                      {conflict.publishedRole
                        ? ` · ${CHARACTER_ROLE_LABELS[conflict.publishedRole]}`
                        : ""}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-muted">{conflict.messages.join("; ")}</p>
                </li>
              ))}
            </ul>
          </DashboardModule>
        ) : null}

        <aside className="dashboard-board-secondary flex min-w-0 flex-col gap-3.5">
          <DashboardModule
            tone="emphasis"
            title="Next Run"
            titleClassName="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted"
          >
            {personal.nextSelectedRun ? (
              <div>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link
                    href={runDetailPath(personal.nextSelectedRun.runId)}
                    className="text-[15px] font-semibold leading-snug text-foreground hover:text-accent"
                  >
                    {personal.nextSelectedRun.runTitle}
                  </Link>
                  <DifficultyBadge difficulty={personal.nextSelectedRun.difficulty} />
                </div>
                <p className="mt-1 text-[13px] text-muted">
                  {formatShortWhen(personal.nextSelectedRun.scheduledStartAt, timeZone)}
                </p>
                <ul className="mt-3 space-y-2.5">
                  {personal.nextSelectedRun.commitments.map((commitment) => {
                    const primary = commitmentPrimary(commitment);
                    const status = nextRunStatusLabel(personal.nextSelectedRun!);
                    return (
                      <li key={commitment.signupId} className="flex items-start gap-2">
                        {primary.isLootbuddy ? (
                          <LootbuddyIcon size={16} className="mt-0.5" />
                        ) : primary.role ? (
                          <RoleIcon role={primary.role} size={16} className="mt-0.5" />
                        ) : null}
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-foreground">{primary.name}</p>
                          <p
                            className={cn(
                              "mt-0.5 text-[12px]",
                              commitment.scheduleConflicts.length > 0 ? "text-danger" : "text-muted",
                            )}
                          >
                            {primary.roleLabel ? `${primary.roleLabel} · ` : null}
                            <span
                              className={cn(
                                "font-medium",
                                commitment.scheduleConflicts.length > 0 ? "text-danger" : "text-success",
                              )}
                            >
                              {status}
                              {commitment.scheduleConflicts.length > 0 ? " · Conflict" : ""}
                            </span>
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted">No selected upcoming run.</p>
            )}
          </DashboardModule>

          <DashboardModule
            title="Upcoming Runs"
            actions={
              <Link href="/runs" className="text-xs text-muted hover:text-accent hover:underline">
                View all runs
              </Link>
            }
          >
            {data.upcomingRuns.length === 0 ? (
              <p className="text-xs text-muted">No upcoming runs yet.</p>
            ) : (
              <ul className="-mx-1 divide-y divide-border/60">
                {data.upcomingRuns.slice(0, 6).map((run) => (
                  <li
                    key={run.id}
                    className="flex items-baseline justify-between gap-3 px-1 py-2 text-sm first:pt-0 last:pb-0"
                  >
                    <Link
                      href={runDetailPath(run.id)}
                      className="min-w-0 truncate font-medium text-foreground hover:text-accent"
                    >
                      {run.title}
                    </Link>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">
                      {formatShortWhen(run.scheduledStartAt, timeZone)}
                      <span className="mx-1 text-border">·</span>
                      {run.signupWindowOpen ? "open" : "closed"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DashboardModule>
        </aside>

        <DashboardModule
          className="dashboard-board-primary min-w-0"
          title="Characters"
          actions={
            <Link href="/characters" className="text-xs text-muted hover:text-accent hover:underline">
              Manage
            </Link>
          }
        >
          {data.characters.totalCount === 0 ? (
            <EmptyState
              title="No characters added yet."
              description="Add your first character to start using run signups."
              className="px-0 py-2 text-left"
            />
          ) : (
            <>
              <ul className="space-y-1 text-sm">
                <li className="text-foreground">
                  <span className="tabular-nums font-medium">{readyCount}</span> ready
                </li>
                <li className={lockoutFlags > 0 ? "font-medium text-warning" : "text-muted"}>
                  {lockoutFlags > 0 ? (
                    <>
                      <span className="tabular-nums">{lockoutFlags}</span> lockout conflict
                      {lockoutFlags === 1 ? "" : "s"}
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <QuietOkIcon label="No lockout conflicts" size={12} />
                      <span className="tabular-nums">0</span> lockout conflicts
                    </span>
                  )}
                </li>
                <li className={syncIssues > 0 ? "font-medium text-warning" : "text-muted"}>
                  {syncIssues > 0 ? (
                    <>
                      <span className="tabular-nums">{syncIssues}</span> stale sync
                      {syncIssues === 1 ? "" : "s"}
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <QuietOkIcon label="No sync errors" size={12} />
                      <span className="tabular-nums">0</span> sync errors
                    </span>
                  )}
                </li>
              </ul>
              {data.characters.lockoutAttention.length > 0 ? (
                <ul className="mt-3 space-y-1 border-t border-border/60 pt-2 text-xs text-muted">
                  {data.characters.lockoutAttention.map((lockout) => (
                    <li key={`${lockout.characterName}-${lockout.raidName}-${lockout.difficulty}`}>
                      <span className="text-foreground">{lockout.characterName}</span>
                      {" · "}
                      {lockout.raidName} {lockout.difficulty}
                      {lockout.isComplete ? " complete" : ` ${lockout.bossesDefeated} bosses`}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </DashboardModule>

        {data.showRecentActivity ? (
          <DashboardModule
            className="dashboard-board-secondary min-w-0"
            tone="quiet"
            title="Recent Activity"
            titleClassName="!font-medium text-muted"
            actions={
              <span className="text-[11px] text-muted/80">
                Latest {Math.min(5, data.recentActivity.length)}
              </span>
            }
          >
            {activityPreview.length === 0 ? (
              <p className="text-xs text-muted">No activity yet.</p>
            ) : (
              <ul className="-mx-1 divide-y divide-border/40">
                {activityPreview.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-baseline justify-between gap-3 px-1 py-1.5 first:pt-0 last:pb-0"
                  >
                    <p className="min-w-0 truncate text-[13px] text-muted">{event.message}</p>
                    <p className="shrink-0 text-[11px] text-muted/70">
                      {formatRelative(event.occurredAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </DashboardModule>
        ) : null}
      </div>
    </PageWorkspace>
  );
}

function StripSep() {
  return <span className="text-muted/40" aria-hidden="true">·</span>;
}

function QuietConfirm({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted", className)}>
      <QuietOkIcon label={label} size={12} />
      {label}
    </span>
  );
}

function SummaryStat({
  value,
  label,
  href,
  emphasize,
  tone,
}: {
  value: number;
  label: string;
  href?: string;
  emphasize: boolean;
  tone: "quiet" | "warning" | "danger" | "accent";
}) {
  const body = (
    <>
      <span
        className={cn(
          "tabular-nums",
          emphasize ? "text-base font-semibold" : "font-medium text-muted",
          tone === "warning" && emphasize && "text-warning",
          tone === "danger" && emphasize && "text-danger",
          tone === "accent" && emphasize && "text-accent",
          tone === "quiet" && "text-muted",
        )}
      >
        {value}
      </span>{" "}
      <span className={cn(emphasize ? "text-sm text-foreground" : "text-xs text-muted")}>{label}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="hover:underline underline-offset-2">
        {body}
      </Link>
    );
  }
  return <span>{body}</span>;
}
