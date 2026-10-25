import { DifficultyBadge, RunStatusBadge } from "@/components/ui/badges";
import { RunManagerActions } from "@/components/runs/run-manager-actions";
import { DEFAULT_TIME_ZONE, formatDateTime } from "@/lib/datetime";
import type { RunDetailView } from "@/services/run-detail.service";

/** Run configuration + administration — placed under Buffs on the Roster tab. */
export function RunRosterConfigAdmin({
  data,
  timeZone = DEFAULT_TIME_ZONE,
}: {
  data: RunDetailView;
  timeZone?: string;
}) {
  const run = data.overview;

  return (
    <div className="space-y-6">
      <section id="roster-config" className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">Run configuration</h2>
        <dl className="grid gap-3 rounded-md border border-border bg-surface px-3 py-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-muted">Product</dt>
            <dd className="mt-0.5 font-medium">{run.productLabel}</dd>
          </div>
          <div>
            <dt className="text-muted">Content</dt>
            <dd className="mt-0.5 font-medium">{run.contentSummary || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Difficulty</dt>
            <dd className="mt-0.5">
              <DifficultyBadge difficulty={run.difficulty} />
            </dd>
          </div>
          <div>
            <dt className="text-muted">Status</dt>
            <dd className="mt-0.5">
              <RunStatusBadge status={run.status} />
            </dd>
          </div>
          <div>
            <dt className="text-muted">Raid Lead</dt>
            <dd className="mt-0.5 font-medium">{run.raidLeadDisplayName}</dd>
          </div>
          <div>
            <dt className="text-muted">Schedule</dt>
            <dd className="mt-0.5 font-medium" title={timeZone}>
              {formatDateTime(run.scheduledStartAt, timeZone)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Signups</dt>
            <dd className="mt-0.5 font-medium">{run.signupWindowOpen ? "Open" : "Closed"}</dd>
          </div>
          <div>
            <dt className="text-muted">Targets</dt>
            <dd className="mt-0.5 font-medium tabular-nums">
              {run.desiredTankCount}T / {run.desiredHealerCount}H / {run.desiredDpsCount}D
              {run.desiredLootbuddyCount > 0 ? ` / ${run.desiredLootbuddyCount} LB` : ""}
            </dd>
          </div>
        </dl>
        {run.notes ? (
          <div>
            <p className="text-sm text-muted">Notes</p>
            <p className="mt-0.5 text-sm">{run.notes}</p>
          </div>
        ) : null}
      </section>

      {data.permissions.canManageRun ? (
        <section id="roster-admin" className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">Run administration</h2>
          <RunManagerActions
            surface="admin"
            run={data.run}
            capabilities={data.capabilities}
            editor={data.editor}
            unmarkedCount={data.attendance.manager?.summary.unmarked ?? 0}
            finalSetupPreview={data.finalSetupPreview}
            rosterHasUnpublishedChanges={Boolean(data.manager?.roster.hasUnpublishedChanges)}
            preflight={data.preflight}
            externalBoosters={
              data.manager?.roster.canEdit
                ? {
                    boosters: data.manager.roster.externalBoosters,
                    rosterVersion: data.manager.roster.version,
                  }
                : null
            }
          />
        </section>
      ) : null}
    </div>
  );
}
