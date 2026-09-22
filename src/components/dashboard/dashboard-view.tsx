import Link from "next/link";
import { formatDate, formatTime } from "@/lib/datetime";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { DifficultyBadge } from "@/components/ui/badges";
import { runDetailPath } from "@/lib/run-routes";
import { APP_CONTROL_CENTER_HEADING } from "@/lib/branding";
import {
  CHARACTER_ROLE_LABELS,
  CLASS_LABELS,
  LOOTBUDDY_MODE_LABELS,
} from "@/lib/labels";
import type { dashboardController } from "@/controllers/dashboard.controller";
import type { DashboardOperationItem, DashboardPersonalCommitment } from "@/services/dashboard-attention";

type DashboardData = Awaited<ReturnType<typeof dashboardController.getDashboard>>;

function commitmentLine(commitment: DashboardPersonalCommitment): string {
  if (commitment.participationType === "LOOTBUDDY") {
    const classLabel = commitment.lootbuddyClass ? CLASS_LABELS[commitment.lootbuddyClass] : "Lootbuddy";
    const mode = commitment.lootbuddyMode ? LOOTBUDDY_MODE_LABELS[commitment.lootbuddyMode] : null;
    return mode ? `Lootbuddy · ${classLabel} · ${mode}` : `Lootbuddy · ${classLabel}`;
  }
  const name = commitment.characterName ?? "Unknown character";
  const role = commitment.publishedRole
    ? CHARACTER_ROLE_LABELS[commitment.publishedRole]
    : "Role unavailable";
  return commitment.isBackup ? `${name} · ${role} · Backup` : `${name} · ${role}`;
}

function operationHint(item: DashboardOperationItem): string {
  if (item.nextAction.kind === "ATTENDANCE") {
    return `${item.unmarkedCount} unmarked`;
  }
  if (item.nextAction.kind === "COMPLETE") {
    return "Ready to complete";
  }
  if (item.nextAction.kind === "PREPARE_PAYOUT") {
    return "Needs payout";
  }
  if (item.nextAction.kind === "REVIEW_PAYOUT") {
    return "Settlement draft";
  }
  if (item.nextAction.kind === "MARK_PAID") {
    return "Settlement finalized";
  }
  return item.nextAction.label;
}

function operationHref(item: DashboardOperationItem): string {
  if (item.nextAction.mode === "link" && item.nextAction.tab) {
    return runDetailPath(item.runId, item.nextAction.tab);
  }
  return runDetailPath(item.runId);
}

export function DashboardView({ data, timeZone }: { data: DashboardData; timeZone: string }) {
  const { personal } = data;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="What needs your attention now — then jump to the canonical workflow."
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Your attention"
            description="Schedule conflicts on selected BoostingHub commitments."
            action={
              <Link href="/my-runs" className="text-xs text-accent hover:underline">
                View My Runs
              </Link>
            }
          />
          {personal.conflicts.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">No personal conflicts need attention.</p>
          ) : (
            <ul className="divide-y divide-border">
              {personal.conflicts.map((conflict) => (
                <li key={conflict.signupId} className="px-4 py-3 text-sm">
                  <p className="font-medium text-danger">Schedule conflict</p>
                  <p className="mt-0.5">
                    <Link href={runDetailPath(conflict.runId)} className="text-accent hover:underline">
                      {conflict.runTitle}
                    </Link>
                    {conflict.characterName ? (
                      <span className="text-muted">
                        {" "}
                        · {conflict.characterName}
                        {conflict.publishedRole
                          ? ` · ${CHARACTER_ROLE_LABELS[conflict.publishedRole]}`
                          : ""}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs text-muted">{conflict.messages.join("; ")}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Next selected run"
            description="Published SELECTED commitments only."
            action={
              <Link href="/my-runs" className="text-xs text-accent hover:underline">
                My Runs
              </Link>
            }
          />
          {personal.nextSelectedRun ? (
            <div className="space-y-3 px-4 py-4 text-sm">
              <div>
                <Link
                  href={runDetailPath(personal.nextSelectedRun.runId)}
                  className="font-medium text-accent hover:underline"
                >
                  {personal.nextSelectedRun.runTitle}
                </Link>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                  <span>
                    {personal.nextSelectedRun.productLabel}
                    {personal.nextSelectedRun.contentSummary
                      ? ` · ${personal.nextSelectedRun.contentSummary}`
                      : ""}
                  </span>
                  <DifficultyBadge difficulty={personal.nextSelectedRun.difficulty} />
                </div>
                <p className="mt-1 text-xs text-muted">
                  {formatDate(personal.nextSelectedRun.scheduledStartAt, timeZone)}{" "}
                  {formatTime(personal.nextSelectedRun.scheduledStartAt, timeZone)}
                </p>
              </div>
              <ul className="space-y-1 text-xs">
                {personal.nextSelectedRun.commitments.map((commitment) => (
                  <li key={commitment.signupId}>
                    {commitmentLine(commitment)}
                    {commitment.scheduleConflicts.length > 0 ? (
                      <span className="text-danger"> · conflict</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {personal.nextSelectedRun.hasScheduleConflict ? (
                <p className="text-xs text-danger">
                  Resolve on{" "}
                  <Link href="/my-runs" className="underline">
                    My Runs
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          ) : (
            <p className="px-4 py-4 text-sm text-muted">No selected upcoming run.</p>
          )}
          <div className="border-t border-border px-4 py-3 text-sm">
            <Link href="/my-runs" className="text-accent hover:underline">
              Pending: {personal.pendingCount}
            </Link>
          </div>
        </Card>

        {data.showOperations ? (
          <Card className="xl:col-span-2">
            <CardHeader
              title={APP_CONTROL_CENTER_HEADING}
              description="Assigned Run handoffs that need action."
              action={
                <Link href="/manage/runs" className="text-xs text-accent hover:underline">
                  View all
                </Link>
              }
            />
            {data.operations.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">No operational blockers right now.</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.operations.map((item) => (
                  <li
                    key={item.runId}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                  >
                    <div>
                      <Link href={runDetailPath(item.runId)} className="font-medium text-accent hover:underline">
                        {item.runTitle}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted">
                        {formatDate(item.scheduledStartAt, timeZone)} {formatTime(item.scheduledStartAt, timeZone)} ·{" "}
                        {operationHint(item)}
                      </p>
                    </div>
                    <Link href={operationHref(item)} className="text-xs text-accent hover:underline">
                      {item.nextAction.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {data.isAdmin ? (
          <Card>
            <CardHeader title="Admin attention" description="Finalized settlements awaiting Mark Paid." />
            {data.adminMarkPaid.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">No settlements need Mark Paid.</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.adminMarkPaid.map((item) => (
                  <li key={item.runId} className="px-4 py-3 text-sm">
                    <Link href={operationHref(item)} className="font-medium text-accent hover:underline">
                      Mark paid · {item.runTitle}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted">{operationHint(item)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        <Card className="xl:col-span-2">
          <CardHeader title="Upcoming Runs" description="Open and in-progress operations across the community." />
          {data.upcomingRuns.length === 0 ? (
            <EmptyState title="No upcoming runs yet." description="Runs appear here after a raid lead creates and opens them." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Run</th>
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-4 py-2 font-medium">Signups</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcomingRuns.slice(0, 8).map((run) => (
                    <tr key={run.id} className="border-t border-border">
                      <td className="px-4 py-3">
                        <div className="font-medium">
                          <Link href={runDetailPath(run.id)} className="text-accent hover:underline">
                            {run.title}
                          </Link>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                          <span>
                            {run.productLabel}
                            {run.contentSummary ? ` · ${run.contentSummary}` : ""}
                          </span>
                          <DifficultyBadge difficulty={run.difficulty} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        <div>{formatDate(run.scheduledStartAt, timeZone)}</div>
                        <div className="text-xs">{formatTime(run.scheduledStartAt, timeZone)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{run.signupCount} signed</div>
                        <div className="text-xs text-muted">
                          {run.signupWindowOpen ? "Signups open" : "Signups closed"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.upcomingRuns.length > 8 ? (
            <div className="border-t border-border px-4 py-3 text-xs">
              <Link href="/runs" className="text-accent hover:underline">
                View all runs
              </Link>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title="Characters"
            description="Active roster and lockout attention this reset."
            action={
              <Link href="/characters" className="text-xs text-accent hover:underline">
                Manage
              </Link>
            }
          />
          {data.characters.totalCount === 0 ? (
            <EmptyState
              title="No characters added yet."
              description="Add your first World of Warcraft character on the Characters page to start using run signups."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 px-4 py-4 text-sm">
                <Stat label="Active" value={data.characters.activeCount} />
                <Stat label="Booster-eligible" value={data.characters.boosterEligibleCount} />
                <Stat label="Lockout flags" value={data.characters.lockoutAttentionCount} />
                <Stat label="Total" value={data.characters.totalCount} />
              </div>
              {data.characters.lockoutAttention.length > 0 ? (
                <ul className="space-y-2 border-t border-border px-4 py-3 text-sm">
                  {data.characters.lockoutAttention.map((lockout) => (
                    <li key={`${lockout.characterName}-${lockout.raidName}-${lockout.difficulty}`}>
                      <span className="font-medium">{lockout.characterName}</span>
                      <span className="text-muted">
                        {" "}
                        · {lockout.raidName} {lockout.difficulty}
                        {lockout.isComplete ? " complete" : ` ${lockout.bossesDefeated} bosses`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="border-t border-border px-4 py-3 text-sm text-muted">No lockout conflicts this reset.</p>
              )}
            </>
          )}
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader title="Recent Activity" description="Operational events for this community." />
          {data.recentActivity.length === 0 ? (
            <EmptyState title="No activity yet." description="Signups, roster publishes, and other events will appear here." />
          ) : (
            <ul className="divide-y divide-border">
              {data.recentActivity.slice(0, 8).map((event) => (
                <li key={event.id} className="px-4 py-3">
                  <p className="text-sm">{event.message}</p>
                  <p className="mt-1 text-xs text-muted">
                    {event.actorName} · {event.occurredAtLabel}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-surface-raised px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
