import { QuietOkIcon, WarningIcon } from "@/components/ui/ops-icons";
import type { RunPreflightResult } from "@/services/run-preflight.service";

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
        {preflight.checks.map((check) => (
          <li key={check.id} className="flex gap-2">
            <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${statusTone(check.status)}`}>
              {check.status}
            </span>
            <span>
              <span className="font-medium text-foreground">{check.label}</span>
              <span className="text-muted"> — {check.summary}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
