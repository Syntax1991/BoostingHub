import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { formatDateTime } from "@/lib/datetime";
import { DIFFICULTY_LABELS } from "@/lib/labels";
import { runDetailPath } from "@/lib/run-routes";
import {
  getRunCommitmentPresentation,
  SCHEDULE_CONFLICT_ALERT_CLASSNAME,
} from "@/lib/run-commitment-presentation";
import type { CharacterRunCommitment } from "@/services/character-run-commitment-state";
import type { CharacterScheduleConflict } from "@/services/character-schedule-conflict";

function CommitmentRunDetails({ item }: { item: CharacterRunCommitment }) {
  return (
    <>
      <Link href={runDetailPath(item.runId)} className="hover:underline">
        {item.productLabel || item.runTitle}
      </Link>
      {` · ${DIFFICULTY_LABELS[item.difficulty]} · ${formatDateTime(item.scheduledStartAt)}`}
    </>
  );
}

function StateChip({ state }: { state: "RESERVED" | "COMMITTED" }) {
  const presentation = getRunCommitmentPresentation(state);
  return (
    <span className={presentation.chipClassName} title={presentation.tooltip}>
      {presentation.label}
    </span>
  );
}

/**
 * Raid Lead-facing cross-run commitment lines for Roster Builder.
 * Informational only — never disables selection by itself.
 */
export function RosterRunCommitmentsBlock({
  commitments,
  className = "",
}: {
  commitments: CharacterRunCommitment[];
  className?: string;
}) {
  if (commitments.length === 0) return null;

  const reserved = commitments.filter((item) => item.state === "RESERVED");
  const committed = commitments.filter((item) => item.state === "COMMITTED");
  const single = commitments.length === 1 ? commitments[0]! : null;

  if (single) {
    const presentation = getRunCommitmentPresentation(single.state);
    return (
      <div className={`mt-1 space-y-0.5 text-xs text-muted ${className}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span>Other run ·</span>
          <StateChip state={single.state} />
        </div>
        <div>
          <CommitmentRunDetails item={single} />
        </div>
        <span className="sr-only">{presentation.tooltip}</span>
      </div>
    );
  }

  return (
    <div className={`mt-1 space-y-1.5 text-xs text-muted ${className}`}>
      <p className="font-medium text-muted">Other run selections</p>
      {reserved.length > 0 ? (
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <StateChip state="RESERVED" />
          </div>
          <ul className="space-y-0.5">
            {reserved.map((item) => (
              <li key={`reserved-${item.runId}`}>
                <CommitmentRunDetails item={item} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {committed.length > 0 ? (
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <StateChip state="COMMITTED" />
          </div>
          <ul className="space-y-0.5">
            {committed.map((item) => (
              <li key={`committed-${item.runId}`}>
                <CommitmentRunDetails item={item} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Phrasing-safe alert body so it can sit inside a <label> without block nesting. */
function ScheduleConflictAlertBody({ conflicts }: { conflicts: CharacterScheduleConflict[] }) {
  return (
    <>
      <span className="flex items-center gap-1.5 text-xs font-semibold">
        <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        Schedule conflict
      </span>
      <span className="mt-1 block space-y-0.5 text-xs">
        {conflicts.map((conflict) => (
          <span key={`${conflict.source}-${conflict.message}`} className="block">
            {conflict.message}
          </span>
        ))}
      </span>
    </>
  );
}

/**
 * Strong danger alert for real schedule conflicts (blocking).
 * Visually stronger than informational Draft roster chips.
 * When `htmlFor` is set, the label itself carries alert chrome so click-to-toggle
 * stays valid HTML (no block elements nested inside label).
 */
export function RosterScheduleConflictAlert({
  conflicts,
  htmlFor,
  className = "",
}: {
  conflicts: CharacterScheduleConflict[];
  htmlFor?: string;
  className?: string;
}) {
  if (conflicts.length === 0) return null;

  if (htmlFor) {
    return (
      <label
        htmlFor={htmlFor}
        className={`mt-1 block cursor-pointer ${SCHEDULE_CONFLICT_ALERT_CLASSNAME} ${className}`}
        role="alert"
      >
        <ScheduleConflictAlertBody conflicts={conflicts} />
      </label>
    );
  }

  return (
    <div className="mt-1">
      <div className={`${SCHEDULE_CONFLICT_ALERT_CLASSNAME} ${className}`} role="alert">
        <ScheduleConflictAlertBody conflicts={conflicts} />
      </div>
    </div>
  );
}
