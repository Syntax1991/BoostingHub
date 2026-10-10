import Link from "next/link";
import { formatDate, formatDateTime, formatTime } from "@/lib/datetime";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DifficultyBadge, RunStatusBadge } from "@/components/ui/badges";
import { RunSignupButton } from "@/components/runs/signup-dialog";
import { RunDetailTabs } from "@/components/runs/run-detail-tabs";
import { RunManagerActions } from "@/components/runs/run-manager-actions";
import { RunPreflightPanel } from "@/components/runs/run-preflight-panel";
import { runDetailPath, type RunDetailTab } from "@/lib/run-routes";
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
        title={
          <Link href={runDetailPath(run.id)} className="hover:underline underline-offset-4">
            {run.title}
          </Link>
        }
        description={`${run.productLabel}${run.contentSummary ? ` · ${run.contentSummary}` : ""} · Lead ${run.raidLeadName}`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {run.discordChannelUrl ? (
              <a
                href={run.discordChannelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent hover:underline"
              >
                Discord channel ↗
              </a>
            ) : null}
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
      {data.permissions.canManageRun && data.preflight ? <RunPreflightPanel preflight={data.preflight} /> : null}
      {data.permissions.canManageRun ? (
        <div className="mb-4">
          <RunManagerActions
            run={data.run}
            capabilities={data.capabilities}
            editor={data.editor}
            unmarkedCount={data.attendance.manager?.summary.unmarked ?? 0}
            finalSetupPreview={data.finalSetupPreview}
            rosterHasUnpublishedChanges={Boolean(data.manager?.roster.hasUnpublishedChanges)}
            preflight={data.preflight}
            addBooster={data.manager?.roster.canEdit ? { rosterVersion: data.manager.roster.version } : null}
            externalBoosters={
              data.manager?.roster.canEdit
                ? { boosters: data.manager.roster.externalBoosters, rosterVersion: data.manager.roster.version }
                : null
            }
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
            {run.desiredLootbuddyCount > 0 ? ` · ${run.desiredLootbuddyCount} Lootbuddies` : ""}
          </span>
          <span className="text-sm text-muted">{run.activeSignupCount} signed</span>
        </div>
      </Card>
      {data.startSnapshot ? (
        <Card className="mb-4">
          <CardHeader title="Run started" description="Operational start audit." />
          <div className="space-y-1 px-4 py-3 text-sm">
            <p>
              Started {formatDateTime(data.startSnapshot.startedAt)}
              {data.startSnapshot.startedByName ? ` · ${data.startSnapshot.startedByName}` : ""}
            </p>
          </div>
        </Card>
      ) : null}
      {data.archiveTranscript ? (
        <Card className="mb-4">
          <CardHeader title="Archive transcript" description="Discord channel history from app archive." />
          <div className="px-4 py-3 text-sm">
            <a
              href={data.archiveTranscript.downloadHref}
              className="text-accent hover:underline"
              download={data.archiveTranscript.filename}
            >
              Download {data.archiveTranscript.filename}
            </a>
          </div>
        </Card>
      ) : null}
      <RunDetailTabs data={data} initialTab={initialTab} />
    </div>
  );
}
