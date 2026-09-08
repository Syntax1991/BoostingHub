import { formatDate, formatTime } from "@/lib/datetime";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { DifficultyBadge, RoleBadge, SignupStatusBadge } from "@/components/ui/badges";
import type { dashboardController } from "@/controllers/dashboard.controller";

type DashboardData = Awaited<ReturnType<typeof dashboardController.getDashboard>>;

export function DashboardView({ data }: { data: DashboardData }) {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="What needs attention next: upcoming runs, your signups, characters, and recent activity."
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Upcoming Runs" description="Open and in-progress operations across the community." />
          {data.upcomingRuns.length === 0 ? (
            <EmptyState title="No upcoming runs" description="Nothing is scheduled in an active operational state." />
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
                  {data.upcomingRuns.map((run) => (
                    <tr key={run.id} className="border-t border-border">
                      <td className="px-4 py-3">
                        <div className="font-medium">{run.title}</div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                          <span>{run.raidName}</span>
                          <DifficultyBadge difficulty={run.difficulty} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        <div>{formatDate(run.scheduledStartAt)}</div>
                        <div className="text-xs">{formatTime(run.scheduledStartAt)}</div>
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
        </Card>
        <Card>
          <CardHeader title="Characters" description="Active roster and lockout attention this reset." />
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
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="My Upcoming Runs" description="Selected and pending relationships only." />
          {data.myUpcomingRuns.length === 0 ? (
            <EmptyState title="No personal run assignments" description="You have no pending or selected signups on upcoming runs." />
          ) : (
            <div className="divide-y divide-border">
              {data.myUpcomingRuns.map((signup) => (
                <div key={signup.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-medium">{signup.runTitle}</p>
                    <p className="text-xs text-muted">
                      {signup.characterName ?? "No character"} · {signup.participationType}
                      {signup.isBackup ? " · Backup" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {signup.role ? <RoleBadge role={signup.role} /> : null}
                    <SignupStatusBadge status={signup.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Recent Activity" description="Seeded operational events for development." />
          <ul className="divide-y divide-border">
            {data.recentActivity.map((event) => (
              <li key={event.id} className="px-4 py-3">
                <p className="text-sm">{event.message}</p>
                <p className="mt-1 text-xs text-muted">
                  {event.actorName} · {event.occurredAtLabel}
                </p>
              </li>
            ))}
          </ul>
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
