import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { DifficultyBadge, RunStatusBadge } from "@/components/ui/badges";
import { runDetailPath } from "@/lib/run-routes";
import { ManageRunsFilters } from "@/components/manage/manage-runs-filters";
import { RunQuickActions } from "@/components/manage/run-quick-actions";
import type { ManagedRunsPage } from "@/services/run.service";

export function ManageRunsView({ data, massCreatedCount }: { data: ManagedRunsPage; massCreatedCount?: number }) {
  const filtered = Boolean(
    data.filters.status || data.filters.raidLeadId || data.filters.timeframe || data.filters.archived !== "active",
  );

  return (
    <div>
      {massCreatedCount ? (
        <p className="mb-4 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
          Created {massCreatedCount} run draft{massCreatedCount === 1 ? "" : "s"}.
        </p>
      ) : null}
      <PageHeader
        title="Manage runs"
        description="Create drafts, open signups, and open the canonical run page to roster. Raid leads see assigned runs. Admins see every run."
        actions={
          data.canCreate ? (
            <Link
              href="/manage/runs/create"
              className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-black hover:bg-[#d8b436]"
            >
              Create Runs
            </Link>
          ) : null
        }
      />
      <ManageRunsFilters
        status={data.filters.status}
        raidLeadId={data.filters.raidLeadId}
        timeframe={data.filters.timeframe}
        archived={data.filters.archived}
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
                  <th className="px-4 py-2 font-medium">Actions</th>
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
                      <div className="flex flex-wrap items-center gap-1.5">
                        <RunStatusBadge status={run.status} />
                        {run.archivedAt ? (
                          <span className="inline-flex items-center rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                            Archived
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {run.signupCount} active · {run.selectedCount} selected
                      <div>{run.signupWindowOpen ? "Open" : "Closed"}</div>
                      <div className="mt-1">
                        Draft {run.draftSelectedCount}
                        {run.publishedAt ? " · published" : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RunQuickActions
                        run={{
                          id: run.id,
                          title: run.title,
                          status: run.status,
                          archivedAt: run.archivedAt,
                          actionLabel: run.actionLabel,
                          capabilities: run.capabilities,
                        }}
                      />
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
