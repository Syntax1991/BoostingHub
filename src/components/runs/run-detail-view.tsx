import Link from "next/link";
import { formatDate, formatTime } from "@/lib/datetime";
import { Card, PageHeader } from "@/components/ui/primitives";
import { DifficultyBadge, RunStatusBadge } from "@/components/ui/badges";
import { RunSignupButton } from "@/components/runs/signup-dialog";
import { RunDetailTabs } from "@/components/runs/run-detail-tabs";
import { RunManagerActions } from "@/components/runs/run-manager-actions";
import type { RunDetailTab } from "@/lib/run-routes";
import type { RunDetailView as RunDetailData } from "@/services/run-detail.service";

export function RunDetailView({
  data,
  initialTab,
}: {
  data: RunDetailData;
  initialTab: RunDetailTab;
}) {
  const run = data.run;
  return (
    <div>
      <PageHeader
        title={run.title}
        description={`${run.raidName} · Lead ${run.raidLeadName}`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {data.permissions.canManageRun ? (
              <Link href="/manage/runs" className="text-sm text-accent hover:underline">
                Manage runs
              </Link>
            ) : (
              <Link href="/runs" className="text-sm text-accent hover:underline">
                All runs
              </Link>
            )}
            <RunSignupButton
              runId={run.id}
              signupWindowOpen={run.signupWindowOpen}
              ownSignupCount={data.viewerSignups.filter((signup) => signup.status !== "WITHDRAWN").length}
            />
          </div>
        }
      />
      {data.permissions.canManageRun ? (
        <div className="mb-4">
            <RunManagerActions
              run={data.run}
              capabilities={data.capabilities}
              editor={data.editor}
              unmarkedCount={data.attendance.manager?.summary.unmarked ?? 0}
            />
        </div>
      ) : null}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <DifficultyBadge difficulty={run.difficulty} />
          <RunStatusBadge status={run.status} />
          <span className="text-sm text-muted">
            {formatDate(run.scheduledStartAt)} · {formatTime(run.scheduledStartAt)}
          </span>
          <span className="text-sm text-muted">{run.signupWindowOpen ? "Signups open" : "Signups closed"}</span>
          <span className="text-sm text-muted">
            {run.desiredTankCount}T / {run.desiredHealerCount}H / {run.desiredDpsCount}D
          </span>
          <span className="text-sm text-muted">{run.activeSignupCount} signed</span>
        </div>
      </Card>
      <RunDetailTabs data={data} initialTab={initialTab} />
    </div>
  );
}
