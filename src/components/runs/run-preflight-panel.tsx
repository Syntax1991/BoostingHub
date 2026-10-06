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
export function RunPreflightPanel({ preflight }: { preflight: RunPreflightResult }) {
  const ready = preflight.overall === "READY";
  return (
    <details
      className={`mb-4 rounded-md border px-3 py-2 text-sm ${
        ready ? "border-border bg-surface" : "border-border bg-surface-raised"
      }`}
    >
      <summary className="cursor-pointer list-none font-medium">
        <span className={ready ? "text-foreground" : "text-warning"}>Preflight · {overallLabel(preflight)}</span>
        <span className="ml-2 text-xs font-normal text-muted">
          {ready ? "All checks passed" : "Expand checklist"}
        </span>
      </summary>
      <ul className="mt-2 space-y-1.5 border-t border-border pt-2">
        {preflight.checks.map((check) => (
          <li key={check.id} className="flex gap-2">
            <span className={`shrink-0 text-xs font-semibold uppercase tracking-wide ${statusTone(check.status)}`}>
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
