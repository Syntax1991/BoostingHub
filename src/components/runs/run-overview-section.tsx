import { formatDateTime } from "@/lib/datetime";
import { Card, CardHeader } from "@/components/ui/primitives";
import { DifficultyBadge, RunStatusBadge } from "@/components/ui/badges";
import type { RunDetailView } from "@/services/run-detail.service";

export function RunOverviewSection({ data }: { data: RunDetailView }) {
  const run = data.overview;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Run" description="Status and signup window are changed through explicit manager actions, not this summary." />
        <dl className="grid grid-cols-2 gap-3 px-4 py-4 text-sm">
          <div>
            <dt className="text-muted">Content</dt>
            <dd className="mt-1">{run.raidName}</dd>
          </div>
          <div>
            <dt className="text-muted">Difficulty</dt>
            <dd className="mt-1">
              <DifficultyBadge difficulty={run.difficulty} />
            </dd>
          </div>
          <div>
            <dt className="text-muted">Scheduled</dt>
            <dd className="mt-1">{formatDateTime(run.scheduledStartAt)}</dd>
          </div>
          <div>
            <dt className="text-muted">Raid Lead</dt>
            <dd className="mt-1">{run.raidLeadName}</dd>
          </div>
          <div>
            <dt className="text-muted">Status</dt>
            <dd className="mt-1">
              <RunStatusBadge status={run.status} />
            </dd>
          </div>
          <div>
            <dt className="text-muted">Signups</dt>
            <dd className="mt-1">{run.signupWindowOpen ? "Open" : "Closed"}</dd>
          </div>
        </dl>
      </Card>
      <Card>
        <CardHeader title="Composition and participation" />
        <dl className="grid grid-cols-2 gap-3 px-4 py-4 text-sm">
          <div>
            <dt className="text-muted">Desired tanks</dt>
            <dd className="mt-1">{run.desiredTankCount}</dd>
          </div>
          <div>
            <dt className="text-muted">Desired healers</dt>
            <dd className="mt-1">{run.desiredHealerCount}</dd>
          </div>
          <div>
            <dt className="text-muted">Desired DPS</dt>
            <dd className="mt-1">{run.desiredDpsCount}</dd>
          </div>
          <div>
            <dt className="text-muted">Active signups</dt>
            <dd className="mt-1">{run.activeSignupCount}</dd>
          </div>
          <div>
            <dt className="text-muted">Your participation</dt>
            <dd className="mt-1">{run.participationSummary}</dd>
          </div>
          <div>
            <dt className="text-muted">Published roster</dt>
            <dd className="mt-1">
              {run.hasPublishedRoster ? `${run.publishedMemberCount} selected` : "Not published yet"}
            </dd>
          </div>
        </dl>
      </Card>
      {run.notes ? (
        <Card className="lg:col-span-2">
          <CardHeader title="Notes" />
          <p className="px-4 py-4 text-sm">{run.notes}</p>
        </Card>
      ) : null}
    </div>
  );
}
