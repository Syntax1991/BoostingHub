import { formatDate, formatTime } from "@/lib/datetime";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { DifficultyBadge, RunStatusBadge, SignupStatusBadge } from "@/components/ui/badges";
import { RunsFilters } from "@/components/runs/runs-filters";
import { RunSignupButton } from "@/components/runs/signup-dialog";
import type { runController } from "@/controllers/app.controller";

type RunsPage = Awaited<ReturnType<typeof runController.getRunsPage>>;

export function RunsView({ data }: { data: RunsPage }) {
  return (
    <div>
      <PageHeader
        title="Runs"
        description="Browse scheduled boosting operations and sign as booster or lootbuddy for the current run."
      />
      <RunsFilters difficulty={data.filters.difficulty} status={data.filters.status} />
      <Card>
        {data.runs.length === 0 ? (
          <EmptyState title="No runs match these filters" description="Clear filters or wait for raid leads to publish more runs." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Raid</th>
                  <th className="px-4 py-2 font-medium">Schedule</th>
                  <th className="px-4 py-2 font-medium">Lead</th>
                  <th className="px-4 py-2 font-medium">Comp</th>
                  <th className="px-4 py-2 font-medium">Signups</th>
                  <th className="px-4 py-2 font-medium">You</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((run) => (
                  <tr key={run.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <div className="max-w-[240px] truncate font-medium">{run.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span className="max-w-[180px] truncate">{run.raidName}</span>
                        <DifficultyBadge difficulty={run.difficulty} />
                        <RunStatusBadge status={run.status} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      <div>{formatDate(run.scheduledStartAt)}</div>
                      <div className="text-xs">{formatTime(run.scheduledStartAt)}</div>
                    </td>
                    <td className="px-4 py-3">{run.raidLeadName}</td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {run.desiredTankCount}T / {run.desiredHealerCount}H / {run.desiredDpsCount}D
                    </td>
                    <td className="px-4 py-3">
                      <div>{run.signupCount} total</div>
                      <div className="text-xs text-muted">
                        {run.signupWindowOpen ? "Open" : "Closed"} · {run.selectedCount} selected
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {run.alreadySigned ? (
                        <div className="space-y-1">
                          {run.currentUserSignups.map((signup) => (
                            <SignupStatusBadge key={signup.id} status={signup.status} />
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted">Not signed</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <RunSignupButton
                        runId={run.id}
                        signupWindowOpen={run.signupWindowOpen}
                        ownSignupCount={run.ownSignupCount}
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
