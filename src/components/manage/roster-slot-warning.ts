import { formatDateTime } from "@/lib/datetime";
import type { RunContentRaidSaveInfo } from "@/lib/run-content-lockouts";

type SlotWarningInput = {
  contentSaves?: readonly Pick<RunContentRaidSaveInfo, "raidName" | "label">[] | null;
  scheduleConflicts?: readonly { message: string }[] | null;
  runCommitments?: readonly { runTitle: string | null; scheduledStartAt: string }[] | null;
  issue?: string | null;
};

/**
 * Why a drafted roster slot shows the warning icon, one line per reason:
 * schedule conflict, already planned on another Run, lockout attention
 * (`Tide: HC 3/8 · Saved`, or Unknown), then any other signup issue.
 * Empty when the slot needs no attention.
 */
export function rosterSlotWarningReasons(signup: SlotWarningInput): string[] {
  const reasons: string[] = [];
  for (const conflict of signup.scheduleConflicts ?? []) reasons.push(conflict.message || "Schedule conflict");
  const commitments = signup.runCommitments ?? [];
  if (commitments.length > 0) {
    reasons.push(
      `Already planned: ${commitments.map((row) => row.runTitle || formatDateTime(row.scheduledStartAt)).join(" · ")}`,
    );
  }
  for (const row of signup.contentSaves ?? []) {
    if (row.label.attention) reasons.push(`${row.raidName}: ${row.label.text}`);
  }
  if (signup.issue) reasons.push(signup.issue);
  return reasons;
}
