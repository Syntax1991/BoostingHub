import Link from "next/link";
import { DEFAULT_TIME_ZONE, formatDate, formatDateTime, formatTime } from "@/lib/datetime";
import { Card, CardHeader } from "@/components/ui/primitives";
import { ActionBar, PageWorkspace } from "@/components/ui/layout";
import { DifficultyBadge, RunStatusBadge } from "@/components/ui/badges";
import { RunSignupButton } from "@/components/runs/signup-dialog";
import { RunDetailTabs } from "@/components/runs/run-detail-tabs";
import { runDetailPath, type RunDetailTab } from "@/lib/run-routes";
import type { RunDetailView as RunDetailData } from "@/services/run-detail.service";

export function RunDetailView({
  data,
  initialTab,
  timeZone = DEFAULT_TIME_ZONE,
}: {
  data: RunDetailData;
  initialTab: RunDetailTab;
  /** Viewer's Settings timezone for the Run start time (fallback Europe/Berlin). */
  timeZone?: string;
}) {
  const run = data.run;
  return (
    <PageWorkspace width="default">
      {/* Compact run header — actions live on Roster / Operations tabs */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              <Link href={runDetailPath(run.id)} className="hover:underline underline-offset-4">
                {run.title}
              </Link>
            </h1>
            <DifficultyBadge difficulty={run.difficulty} />
            <RunStatusBadge status={run.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {run.productLabel}
            {run.contentSummary ? ` · ${run.contentSummary}` : ""}
            {" · "}
            <span title={timeZone}>
              {formatDate(run.scheduledStartAt, timeZone)} {formatTime(run.scheduledStartAt, timeZone)}
            </span>
            {" · "}
            {run.raidLeadDisplayName}
          </p>
          <p className="mt-1 text-sm text-muted">
            <span className="tabular-nums text-foreground">{run.activeSignupCount}</span> signed
            {" · "}
            {run.signupWindowOpen ? "Signups open" : "Signups closed"}
            {" · "}
            {run.desiredTankCount}T / {run.desiredHealerCount}H / {run.desiredDpsCount}D
            {run.desiredLootbuddyCount > 0 ? ` · ${run.desiredLootbuddyCount} LB` : ""}
          </p>
        </div>
        <ActionBar>
          {run.discordChannelUrl ? (
            <a
              href={run.discordChannelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent hover:underline"
            >
              Discord ↗
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
            timeZone={timeZone}
          />
        </ActionBar>
      </div>

      {data.startSnapshot ? (
        <p className="mb-2 text-sm text-muted">
          Started {formatDateTime(data.startSnapshot.startedAt)}
          {data.startSnapshot.startedByName ? ` · ${data.startSnapshot.startedByName}` : ""}
        </p>
      ) : null}
      {data.archiveTranscript ? (
        <Card className="mb-3" flush>
          <CardHeader title="Archive transcript" />
          <div className="px-3 py-2 text-sm">
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

      <RunDetailTabs data={data} initialTab={initialTab} timeZone={timeZone} />
    </PageWorkspace>
  );
}
