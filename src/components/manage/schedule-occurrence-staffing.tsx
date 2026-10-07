import { RosterBuilderTrigger } from "@/components/manage/roster-builder-dialog";
import {
  formatCompositionCounts,
  formatMissingCounts,
} from "@/lib/run-staffing";
import type { CommunityScheduleOccurrenceStaffing } from "@/services/community-schedule.service";

const RUN_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  ROSTERING: "Rostering",
  PUBLISHED: "Published",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/**
 * Compact read-only staffing overlay for one Schedule occurrence.
 * Aggregate DPS only — Melee/Ranged split is informational.
 * Auto Build Roster opens on demand for materialized shortages.
 */
export function ScheduleOccurrenceStaffing({
  staffing,
  runId,
}: {
  staffing: CommunityScheduleOccurrenceStaffing;
  runId?: string;
}) {
  if (staffing.kind === "NONE") return null;

  if (staffing.kind === "PREVIEW") {
    const target = formatCompositionCounts({
      tanks: staffing.target.desiredTankCount,
      healers: staffing.target.desiredHealerCount,
      dps: staffing.target.desiredDpsCount,
      lootbuddies: staffing.target.desiredLootbuddyCount,
    });
    return (
      <div className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-muted">
        <p>
          <span className="font-medium text-foreground/80">Target</span> {target}
        </p>
        <p>Not created yet</p>
      </div>
    );
  }

  const { projection, runStatus } = staffing;
  const target = formatCompositionCounts(projection.desired);
  const staffedLine = formatCompositionCounts({
    tanks: projection.staffed.tanks,
    healers: projection.staffed.healers,
    dps: projection.staffed.dps,
    lootbuddies: projection.staffed.lootbuddies,
  });
  const missing = formatMissingCounts(projection.missing);
  const split =
    projection.staffed.dps > 0
      ? `${projection.staffed.meleeDps} Melee · ${projection.staffed.rangedDps} Ranged`
      : null;

  return (
    <div className="mt-1.5 space-y-1 text-[11px] leading-snug text-muted">
      <p className="text-[10px] uppercase tracking-wide">
        {RUN_STATUS_LABELS[runStatus] ?? runStatus}
      </p>
      <p>
        <span className="font-medium text-foreground/80">Target</span> {target}
      </p>
      <p>
        <span className="font-medium text-foreground/80">Staffed</span> {staffedLine}
      </p>
      {split ? <p className="text-muted">{split}</p> : null}
      {projection.status === "FULLY_STAFFED" ? (
        <p className="font-medium text-success">Fully staffed</p>
      ) : (
        <>
          <p>
            <span className="font-medium text-warning">Missing</span> {missing}
          </p>
          {runId ? (
            <div className="pt-0.5">
              <RosterBuilderTrigger runId={runId} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
