import { CHARACTER_ROLE_LABELS } from "@/lib/labels";
import type { RosterDiffChange, RosterDiffMember } from "@/lib/roster-diff";
import type { CharacterRole } from "@/models/enums";

function roleLabel(member: Pick<RosterDiffMember, "participationType">, role: CharacterRole | null): string {
  if (member.participationType === "LOOTBUDDY") return "Lootbuddy";
  return role ? (CHARACTER_ROLE_LABELS[role] ?? role) : "No role";
}

/**
 * Update Roster preview: exactly what changes against the published roster.
 * Compact one line per change; identity comes from roster-diff (signup / User), never row order.
 */
export function RosterUpdateDiff({ changes, runChanged }: { changes: RosterDiffChange[]; runChanged: boolean }) {
  if (changes.length === 0) {
    return (
      <p className="text-muted">
        {runChanged
          ? "No roster member changes — Run details changed since the last publish."
          : "No roster member changes."}
      </p>
    );
  }
  return (
    <div>
      <p className="font-medium">
        {changes.length} change{changes.length === 1 ? "" : "s"}
        {runChanged ? <span className="font-normal text-muted"> · Run details changed too</span> : null}
      </p>
      <ul className="mt-1 space-y-1">
        {changes.map((change) => {
          if (change.kind === "ADDED") {
            return (
              <li key={`add:${change.member.signupId}`} className="flex gap-2">
                <span aria-label="Added" className="w-3 shrink-0 font-semibold text-success">
                  +
                </span>
                <span>
                  {change.member.label} · {roleLabel(change.member, change.member.role)}
                </span>
              </li>
            );
          }
          if (change.kind === "REMOVED") {
            return (
              <li key={`remove:${change.member.signupId}`} className="flex gap-2">
                <span aria-label="Removed" className="w-3 shrink-0 font-semibold text-danger">
                  −
                </span>
                <span>
                  {change.member.label} · {roleLabel(change.member, change.member.role)}
                </span>
              </li>
            );
          }
          if (change.kind === "CHARACTER_CHANGED") {
            const fromRole = roleLabel(change.from, change.from.role);
            const toRole = roleLabel(change.to, change.to.role);
            return (
              <li key={`swap:${change.from.signupId}`} className="flex gap-2">
                <span aria-label="Character changed" className="w-3 shrink-0 font-semibold text-accent">
                  ⇄
                </span>
                <span>
                  {change.from.label} → {change.to.label} ·{" "}
                  {fromRole === toRole ? toRole : `${fromRole} → ${toRole}`}
                </span>
              </li>
            );
          }
          return (
            <li key={`role:${change.member.signupId}`} className="flex gap-2">
              <span aria-label="Role changed" className="w-3 shrink-0 font-semibold text-warning">
                ~
              </span>
              <span>
                {change.member.label} · {roleLabel(change.member, change.fromRole)} →{" "}
                {roleLabel(change.member, change.member.role)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
