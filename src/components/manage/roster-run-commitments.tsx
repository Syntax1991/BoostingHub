import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, TriangleAlert } from "lucide-react";
import { formatDateTime } from "@/lib/datetime";
import { DIFFICULTY_LABELS } from "@/lib/labels";
import { runDetailPath } from "@/lib/run-routes";
import {
  getRunCommitmentPresentation,
  SCHEDULE_CONFLICT_ALERT_CLASSNAME,
} from "@/lib/run-commitment-presentation";
import type { CharacterRunCommitment } from "@/services/character-run-commitment-state";
import type { CharacterScheduleConflict } from "@/services/character-schedule-conflict";

function stopRosterToggle(event: MouseEvent) {
  event.stopPropagation();
}

function RunMetadataLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:decoration-solid"
      onClick={stopRosterToggle}
      onMouseDown={stopRosterToggle}
    >
      <span>{children}</span>
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </Link>
  );
}

function CommitmentRunDetails({ item }: { item: CharacterRunCommitment }) {
  const title = [
    item.productLabel || item.runTitle,
    DIFFICULTY_LABELS[item.difficulty],
    formatDateTime(item.scheduledStartAt),
  ].join(" · ");
  if (!item.runId.trim()) return <span>{title}</span>;
  return <RunMetadataLink href={runDetailPath(item.runId)}>{title}</RunMetadataLink>;
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

function ScheduleConflictMessage({ conflict }: { conflict: CharacterScheduleConflict }) {
  if (conflict.source === "RUN_RESERVATION" && conflict.conflictingRunId.trim()) {
    return (
      <span className="block">
        Another Manawyrm Hub Run:{" "}
        <RunMetadataLink href={runDetailPath(conflict.conflictingRunId)}>
          {conflict.conflictingRunTitle}
        </RunMetadataLink>{" "}
        at {formatDateTime(conflict.conflictingScheduledStartAt)}
      </span>
    );
  }
  return <span className="block">{conflict.message}</span>;
}

/** Heading stays a label; run links sit beside it so they never toggle the checkbox. */
function ScheduleConflictAlertBody({
  conflicts,
  htmlFor,
}: {
  conflicts: CharacterScheduleConflict[];
  htmlFor?: string;
}) {
  const heading = (
    <>
      <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      Schedule conflict
    </>
  );
  return (
    <>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold">
          {heading}
        </label>
      ) : (
        <span className="flex items-center gap-1.5 text-xs font-semibold">{heading}</span>
      )}
      <span className="mt-1 block space-y-0.5 text-xs">
        {conflicts.map((conflict) => (
          <ScheduleConflictMessage key={`${conflict.source}-${conflict.message}`} conflict={conflict} />
        ))}
      </span>
    </>
  );
}

/**
 * Strong danger alert for real schedule conflicts (blocking).
 * Visually stronger than informational Draft roster chips.
 * When `htmlFor` is set, only the heading is the checkbox label. Run links stay
 * outside that label so opening another Run never toggles the player.
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

  return (
    <div className={`mt-1 ${SCHEDULE_CONFLICT_ALERT_CLASSNAME} ${className}`} role="alert">
      <ScheduleConflictAlertBody conflicts={conflicts} htmlFor={htmlFor} />
    </div>
  );
}
