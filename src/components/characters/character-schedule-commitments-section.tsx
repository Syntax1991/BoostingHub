import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { runDetailPath } from "@/lib/run-routes";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import {
  DifficultyBadge,
  RoleBadge,
  RunStatusBadge,
  SignupStatusBadge,
} from "@/components/ui/badges";
import type { CharacterScheduleCommitment } from "@/services/character-schedule-commitments.service";

export function CharacterScheduleCommitmentsSection({
  commitments,
}: {
  commitments: CharacterScheduleCommitment[];
}) {
  return (
    <Card>
      <CardHeader
        title="BoostingHub commitments"
        description="Upcoming Runs that reserve this Character (draft-selected or published SELECTED). Pending-only offers do not reserve and are not listed here."
      />
      {commitments.length === 0 ? (
        <EmptyState
          title="No upcoming BoostingHub reservations"
          description="This Character is not draft-selected or published SELECTED on any upcoming Run."
        />
      ) : (
        <ul className="divide-y divide-border">
          {commitments.map((item) => (
            <li key={item.signupId} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={runDetailPath(item.runId)}
                  className="font-medium hover:underline"
                >
                  {item.runTitle}
                </Link>
                <DifficultyBadge difficulty={item.difficulty} />
                <RunStatusBadge status={item.runStatus} />
                <SignupStatusBadge status={item.signupStatus} />
                {item.draftSelected && item.signupStatus !== "SELECTED" ? (
                  <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                    Draft selected
                  </span>
                ) : null}
                {item.role ? <RoleBadge role={item.role} /> : null}
              </div>
              <p className="mt-1 text-xs text-muted">
                {formatDateTime(item.scheduledStartAt)}
                {item.contentSummary ? ` · ${item.contentSummary}` : ""}
                {item.productLabel ? ` · ${item.productLabel}` : ""}
              </p>
              {item.scheduleConflicts.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-warning" aria-label="Schedule conflicts">
                  {item.scheduleConflicts.map((conflict, index) => (
                    <li key={`${item.signupId}-${conflict.source}-${index}`}>
                      {conflict.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
