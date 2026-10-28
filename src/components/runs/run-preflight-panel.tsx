import Link from "next/link";
import { QuietOkIcon, WarningIcon } from "@/components/ui/ops-icons";
import { runDetailPath } from "@/lib/run-routes";
import type { PreflightCheck, RunPreflightResult } from "@/services/run-preflight.service";

/** Anchor of the Roster tab's Needs-attention strip (roster-builder.tsx). */
export const ROSTER_ATTENTION_ANCHOR = "roster-attention";

/**
 * The direct next step for an existing preflight warning — a link into the
 * Roster tab, where the matching action (Find replacement / Fill gaps / Sync
 * Characters / Update) sits. Mapping only: no new warning state.
 */
export function preflightCheckAction(
  check: Pick<PreflightCheck, "id" | "status">,
  runId: string,
): { label: string; href: string } | null {
  if (check.status === "PASS") return null;
  const href = `${runDetailPath(runId)}#${ROSTER_ATTENTION_ANCHOR}`;
  if (check.id === "selected_lockouts" || check.id === "selected_schedule_conflicts") {
    return { label: "Find replacements", href };
  }
  if (check.id.startsWith("publish_blocker:CHARACTER_INACTIVE:") || check.id.startsWith("publish_blocker:BOOSTER_ACCESS_INVALID:")) {
    return { label: "Find replacement", href };
  }
  if (check.id.startsWith("composition:COMPOSITION_UNDER_TARGET")) return { label: "Fill gaps", href };
  if (check.id === "selected_blizzard_sync") return { label: "Sync Characters", href };
  if (check.id === "unpublished_changes") return { label: "Review & Update", href: runDetailPath(runId) };
  return null;
}

function statusTone(status: RunPreflightResult["checks"][number]["status"]): string {
  if (status === "ERROR") return "text-danger";
  if (status === "WARNING") return "text-warning";
  return "text-muted";
}

function overallLabel(preflight: RunPreflightResult): string {
  if (preflight.overall === "READY") return "Ready to start";
  const n = preflight.attentionCount;
  return `${n} item${n === 1 ? "" : "s"} need attention`;
}

/**
 * Compact manager-facing readiness checklist on Run Detail.
 * Domain start/publish invariants remain authoritative — this is advisory UI.
 */
export function RunPreflightPanel({
  preflight,
  defaultOpen = false,
}: {
  preflight: RunPreflightResult;
  /** Operations tab shows the checklist expanded. */
  defaultOpen?: boolean;
}) {
  const ready = preflight.overall === "READY";
  return (
    <details
      open={defaultOpen || undefined}
      className={`mb-0 text-sm ${
        ready ? "" : "rounded-md border border-warning/40 bg-warning/5 px-3 py-2"
      }`}
    >
      <summary
        className={`flex cursor-pointer list-none items-center gap-1.5 font-medium ${ready ? "py-0.5" : ""}`}
      >
        {ready ? (
          <QuietOkIcon label="Preflight ready" size={14} />
        ) : (
          <WarningIcon label="Preflight attention" size={14} />
        )}
        <span className={ready ? "text-muted" : "text-warning"}>
          {ready ? "Preflight · Ready" : `Preflight · ${overallLabel(preflight)}`}
        </span>
        <span className="text-[11px] font-normal text-muted">{ready ? "" : "Expand"}</span>
      </summary>
      <ul className="mt-1.5 space-y-1 border-t border-border pt-1.5">
        {preflight.checks.map((check) => {
          const action = preflightCheckAction(check, preflight.runId);
          return (
          <li key={check.id} className="flex gap-2">
            <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${statusTone(check.status)}`}>
              {check.status}
            </span>
            <span>
              <span className="font-medium text-foreground">{check.label}</span>
              <span className="text-muted"> — {check.summary}</span>
              {action ? (
                <>
                  {" "}
                  <Link href={action.href} className="whitespace-nowrap font-medium text-accent hover:underline">
                    {action.label}
                  </Link>
                </>
              ) : null}
            </span>
          </li>
          );
        })}
      </ul>
    </details>
  );
}
