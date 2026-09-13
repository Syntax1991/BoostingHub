import Link from "next/link";
import { formatDate, formatDateTime, formatTime } from "@/lib/datetime";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DifficultyBadge, RunStatusBadge } from "@/components/ui/badges";
import { RunSignupButton } from "@/components/runs/signup-dialog";
import { RunDetailTabs } from "@/components/runs/run-detail-tabs";
import { RunManagerActions } from "@/components/runs/run-manager-actions";
import type { RunDetailTab } from "@/lib/run-routes";
import type { RunDetailView as RunDetailData } from "@/services/run-detail.service";

function startComposition(data: RunDetailData) {
  const members = data.publishedRoster?.members ?? [];
  const tanks = members.filter((member) => member.role === "TANK").length;
  const healers = members.filter((member) => member.role === "HEALER").length;
  const dps = members.filter((member) => member.role === "DPS").length;
  const lootbuddies = members.filter((member) => member.participationType === "LOOTBUDDY").length;
  return {
    tanks,
    healers,
    dps,
    lootbuddies,
    total: members.length,
  };
}

export function RunDetailView({
  data,
  initialTab,
}: {
  data: RunDetailData;
  initialTab: RunDetailTab;
}) {
  const run = data.run;
  const composition = startComposition(data);
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
              startComposition={composition}
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
      {data.startSnapshot ? (
        <Card className="mb-4">
          <CardHeader title="Gold Collectors" description="Frozen when this Run started." />
          <div className="space-y-1 px-4 py-3 text-sm">
            <p>
              Collector 1: {data.startSnapshot.goldCollector1Name}-{data.startSnapshot.goldCollector1Realm}
            </p>
            <p>
              Collector 2: {data.startSnapshot.goldCollector2Name}-{data.startSnapshot.goldCollector2Realm}
            </p>
            <p className="text-xs text-muted">
              Started {formatDateTime(data.startSnapshot.startedAt)}
              {data.startSnapshot.startedByName ? ` · ${data.startSnapshot.startedByName}` : ""}
            </p>
          </div>
        </Card>
      ) : null}
      <RunDetailTabs data={data} initialTab={initialTab} />
    </div>
  );
}
