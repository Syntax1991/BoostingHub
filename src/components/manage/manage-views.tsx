import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { PageWorkspace } from "@/components/ui/layout";
import { DataTable, DataTd, DataTh, DataThead, MobileDataCard } from "@/components/ui/data-table";
import { DifficultyBadge, RunStatusBadge } from "@/components/ui/badges";
import { runDetailPath } from "@/lib/run-routes";
import { ManageRunsFilters } from "@/components/manage/manage-runs-filters";
import { RunQuickActions } from "@/components/manage/run-quick-actions";
import { formatOperationalAttentionHint } from "@/services/run-operational-handoff";
import type { ManagedRunsPage } from "@/services/run.service";

export function ManageRunsView({ data, massCreatedCount }: { data: ManagedRunsPage; massCreatedCount?: number }) {
  const filtered = Boolean(
    data.filters.status || data.filters.raidLeadId || data.filters.timeframe || data.filters.archived !== "active",
  );

  return (
    <PageWorkspace width="wide">
      {massCreatedCount ? (
        <p className="mb-3 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm">
          Created {massCreatedCount} run draft{massCreatedCount === 1 ? "" : "s"}.
        </p>
      ) : null}
      <PageHeader
        title="Manage runs"
        description="Open signups, roster, and archive existing runs."
      />
      <ManageRunsFilters
        status={data.filters.status}
        raidLeadId={data.filters.raidLeadId}
        timeframe={data.filters.timeframe}
        archived={data.filters.archived}
        raidLeads={data.raidLeads}
      />
      <Card flush>
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
          <>
            <div className="hidden md:block">
              <DataTable minWidth="56rem">
                <DataThead>
                  <tr>
                    <DataTh>Run</DataTh>
                    <DataTh>Schedule</DataTh>
                    <DataTh>Lead</DataTh>
                    <DataTh>Status</DataTh>
                    <DataTh>Signups</DataTh>
                    <DataTh>Actions</DataTh>
                  </tr>
                </DataThead>
                <tbody>
                  {data.runs.map((run) => {
                    const attentionHint = formatOperationalAttentionHint({
                      attendance: run.attendance,
                      attention: run.attention,
                      nextAction: run.nextAction,
                    });
                    return (
                      <tr key={run.id} className="hover:bg-surface-raised/40">
                        <DataTd>
                          <Link
                            href={runDetailPath(run.id)}
                            className="max-w-[220px] truncate font-medium text-accent hover:underline"
                          >
                            {run.title}
                          </Link>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                            <span className="truncate">
                              {run.productLabel}
                              {run.contentSummary ? ` · ${run.contentSummary}` : ""}
                            </span>
                            <DifficultyBadge difficulty={run.difficulty} />
                          </div>
                        </DataTd>
                        <DataTd className="whitespace-nowrap text-muted text-xs">
                          {formatDateTime(run.scheduledStartAt)}
                        </DataTd>
                        <DataTd className="whitespace-nowrap">{run.raidLeadDisplayName}</DataTd>
                        <DataTd>
                          <div className="flex flex-wrap items-center gap-1">
                            <RunStatusBadge status={run.status} />
                            {run.archivedAt ? (
                              <span className="inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold uppercase text-muted">
                                Archived
                              </span>
                            ) : null}
                            {attentionHint ? (
                              <span className="inline-flex h-5 items-center rounded bg-surface-raised px-1.5 text-[11px] text-muted">
                                {attentionHint}
                              </span>
                            ) : null}
                          </div>
                        </DataTd>
                        <DataTd className="text-[11px] text-muted">
                          <span className="tabular-nums text-foreground">{run.signupCount}</span> ·{" "}
                          {run.selectedCount} sel · {run.signupWindowOpen ? "open" : "closed"}
                          <div>
                            Draft {run.draftSelectedCount}
                            {run.publishedAt ? " · published" : ""}
                          </div>
                        </DataTd>
                        <DataTd>
                          <RunQuickActions
                            run={{
                              id: run.id,
                              title: run.title,
                              status: run.status,
                              archivedAt: run.archivedAt,
                              nextAction: run.nextAction,
                              unmarkedCount: run.attendance.unmarkedCount,
                              capabilities: run.capabilities,
                            }}
                          />
                        </DataTd>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
            </div>
            <ul className="flex flex-col gap-2 p-2 md:hidden">
              {data.runs.map((run) => (
                <li key={run.id}>
                  <MobileDataCard>
                    <Link href={runDetailPath(run.id)} className="text-sm font-medium text-accent hover:underline">
                      {run.title}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {formatDateTime(run.scheduledStartAt)} · {run.raidLeadDisplayName}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <RunStatusBadge status={run.status} />
                      <DifficultyBadge difficulty={run.difficulty} />
                    </div>
                    <div className="mt-2">
                      <RunQuickActions
                        run={{
                          id: run.id,
                          title: run.title,
                          status: run.status,
                          archivedAt: run.archivedAt,
                          nextAction: run.nextAction,
                          unmarkedCount: run.attendance.unmarkedCount,
                          capabilities: run.capabilities,
                        }}
                      />
                    </div>
                  </MobileDataCard>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </PageWorkspace>
  );
}

export function RosterUnavailable({ title, description }: { title: string; description: string }) {
  return (
    <PageWorkspace>
      <PageHeader title={title} description={description} />
      <Card>
        <div className="px-3 py-3 text-sm">
          <Link href="/manage/runs" className="text-accent hover:underline">
            Back to manage runs
          </Link>
        </div>
      </Card>
    </PageWorkspace>
  );
}
