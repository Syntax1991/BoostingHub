import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { formatDateTime } from "@/lib/datetime";
import { runDetailPath } from "@/lib/run-routes";
import {
  getRunCommitmentPresentation,
  SCHEDULE_CONFLICT_ALERT_CLASSNAME,
} from "@/lib/run-commitment-presentation";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import {
  DifficultyBadge,
  RoleBadge,
  RunStatusBadge,
  SignupStatusBadge,
} from "@/components/ui/badges";
import { deriveCharacterRunCommitmentState } from "@/services/character-run-commitment-state";
import type { CharacterScheduleCommitment } from "@/services/character-schedule-commitments.service";

export function CharacterScheduleCommitmentsSection({
  commitments,
}: {
  commitments: CharacterScheduleCommitment[];
}) {
  return (
    <Card>
      <CardHeader
        title="Manawyrm Hub commitments"
        description="Upcoming Runs that reserve this Character (draft roster or published roster). Pending-only offers do not reserve and are not listed here."
      />
      {commitments.length === 0 ? (
        <EmptyState
          title="No upcoming Manawyrm Hub commitments"
          description="This Character is not on a draft roster or published roster of any upcoming Run."
        />
      ) : (
        <ul className="divide-y divide-border">
          {commitments.map((item) => {
            const state = deriveCharacterRunCommitmentState(item.signupStatus, item.draftSelected);
            const presentation = state ? getRunCommitmentPresentation(state) : null;
            return (
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
                  {presentation ? (
                    <span className={`text-[10px] uppercase tracking-wide ${presentation.chipClassName}`} title={presentation.tooltip}>
                      {presentation.label}
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
                  <div
                    className={`mt-2 ${SCHEDULE_CONFLICT_ALERT_CLASSNAME}`}
                    role="alert"
                    aria-label="Schedule conflicts"
                  >
                    <p className="flex items-center gap-1.5 text-xs font-semibold">
                      <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                      Schedule conflict
                    </p>
                    <ul className="mt-1 space-y-1 text-xs">
                      {item.scheduleConflicts.map((conflict, index) => (
                        <li key={`${item.signupId}-${conflict.source}-${index}`}>
                          {conflict.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
