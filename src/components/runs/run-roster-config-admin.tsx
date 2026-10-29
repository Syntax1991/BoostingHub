import { RunManagerActions } from "@/components/runs/run-manager-actions";
import type { RunDetailView } from "@/services/run-detail.service";

/**
 * Roster tab context bar: the Run's notes and the Run administration actions
 * (Edit Run, Signups, Cancel / Start / Complete) in one compact row above the
 * roster. Product, content, schedule, lead, signups and targets already show
 * in the Run header, so they are not repeated here; Booster entry (registered
 * and External) lives in the Roster's own Add Booster.
 */
export function RunRosterConfigAdmin({
  data,
}: {
  data: RunDetailView;
  /** Kept for callers; the schedule shows in the Run header. */
  timeZone?: string;
}) {
  const notes = data.overview.notes;
  const canManage = data.permissions.canManageRun;
  if (!notes && !canManage) return null;

  return (
    <section
      id="roster-admin"
      aria-label="Run administration"
      className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-md border border-border bg-surface-raised/20 px-3 py-2"
    >
      {notes ? (
        <p id="roster-config" className="min-w-0 flex-1 basis-64 text-sm text-muted">
          <span className="font-medium text-foreground">Notes</span> · <span className="whitespace-pre-line">{notes}</span>
        </p>
      ) : null}
      {canManage ? (
        <RunManagerActions
          surface="admin"
          run={data.run}
          capabilities={data.capabilities}
          editor={data.editor}
          unmarkedCount={data.attendance.manager?.summary.unmarked ?? 0}
          finalSetupPreview={data.finalSetupPreview}
          rosterHasUnpublishedChanges={Boolean(data.manager?.roster.hasUnpublishedChanges)}
          preflight={data.preflight}
        />
      ) : null}
    </section>
  );
}
