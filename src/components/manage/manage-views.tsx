import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { DifficultyBadge, RunStatusBadge } from "@/components/ui/badges";
import type { rosterService } from "@/services/roster.service";

type Runs = Awaited<ReturnType<typeof rosterService.listManagedRuns>>;

export function ManageRunsView({ runs }: { runs: Runs }) {
  return (
    <div>
      <PageHeader
        title="Manage runs"
        description="Raid leads manage their assigned runs. Admins can manage every run."
      />
      <Card>
        {runs.length === 0 ? (
          <EmptyState
            title="No manageable runs yet."
            description="Assigned runs appear here after a raid lead or admin creates them."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Run</th>
                  <th className="px-4 py-2 font-medium">Schedule</th>
                  <th className="px-4 py-2 font-medium">Lead</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Signups</th>
                  <th className="px-4 py-2 font-medium">Roster</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <div className="max-w-[240px] truncate font-medium">{run.title}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                        <span>{run.raidName}</span>
                        <DifficultyBadge difficulty={run.difficulty} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDateTime(run.scheduledStartAt)}</td>
                    <td className="px-4 py-3">{run.raidLeadName}</td>
                    <td className="px-4 py-3">
                      <RunStatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {run.signupCount} active · {run.selectedCount} selected
                      <div>{run.signupWindowOpen ? "Open" : "Closed"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-muted">
                        Draft {run.draftSelectedCount}
                        {run.publishedAt ? " · published" : ""}
                      </div>
                      <Link
                        href={`/manage/runs/${run.id}`}
                        className="mt-1 inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-surface-raised"
                      >
                        {run.actionLabel}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function ManageHomeView() {
  return (
    <div>
      <PageHeader
        title="Management"
        description="Operations tools for raid leads and administrators. Only this area is role-gated."
      />
      <Card>
        <div className="px-4 py-4 text-sm">
          <p className="text-muted">Available now:</p>
          <Link href="/manage/runs" className="mt-2 inline-flex text-accent hover:underline">
            Manage runs
          </Link>
        </div>
      </Card>
    </div>
  );
}

export function RosterUnavailable({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <Card>
        <div className="px-4 py-4 text-sm">
          <Link href="/manage/runs" className="text-accent hover:underline">
            Back to manage runs
          </Link>
        </div>
      </Card>
    </div>
  );
}
