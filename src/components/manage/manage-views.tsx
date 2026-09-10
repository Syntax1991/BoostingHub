import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { DifficultyBadge, RunStatusBadge } from "@/components/ui/badges";
import { runDetailPath, runDetailTabForManageAction } from "@/lib/run-routes";
import { ManageRunsFilters } from "@/components/manage/manage-runs-filters";
import type { ManagedRunsPage } from "@/services/run.service";

export function ManageRunsView({ data }: { data: ManagedRunsPage }) {
  const filtered = Boolean(data.filters.status || data.filters.raidLeadId || data.filters.timeframe);

  return (
    <div>
      <PageHeader
        title="Manage runs"
        description="Create drafts, open signups, and open the canonical run page to roster. Raid leads see assigned runs. Admins see every run."
        actions={
          data.canCreate ? (
            <Link
              href="/manage/runs/new"
              className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-black hover:bg-[#d8b436]"
            >
              Create Run
            </Link>
          ) : null
        }
      />
      <ManageRunsFilters
        status={data.filters.status}
        raidLeadId={data.filters.raidLeadId}
        timeframe={data.filters.timeframe}
        raidLeads={data.raidLeads}
      />
      <Card>
        {data.runs.length === 0 ? (
          <EmptyState
            title={filtered ? "No runs match these filters." : "No runs created yet."}
            description={
              filtered
                ? "Clear filters to see every run you can manage."
                : "Create a draft, review the configuration, then open it for signups."
            }
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
                {data.runs.map((run) => (
                  <tr key={run.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <Link href={runDetailPath(run.id)} className="max-w-[240px] truncate font-medium text-accent hover:underline">
                        {run.title}
                      </Link>
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
                        href={runDetailPath(run.id, runDetailTabForManageAction(run.actionLabel))}
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
