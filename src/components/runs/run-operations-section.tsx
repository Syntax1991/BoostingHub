import { WarningIcon } from "@/components/ui/ops-icons";
import { RunPreflightPanel } from "@/components/runs/run-preflight-panel";
import type { RunDetailView } from "@/services/run-detail.service";

/**
 * Operations tab: Preflight + Roster validation only.
 * Run configuration / administration live under Buffs on the Roster tab.
 */
export function RunOperationsSection({
  data,
}: {
  data: RunDetailView;
  timeZone?: string;
}) {
  const validation = data.manager?.validation ?? null;

  return (
    <div className="space-y-6">
      <section id="operations-preflight" className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">Pre-flight</h2>
        {data.preflight ? (
          <div className="rounded-md border border-border bg-surface px-3 py-2">
            <RunPreflightPanel preflight={data.preflight} defaultOpen />
          </div>
        ) : (
          <p className="text-sm text-muted">No preflight data for this viewer.</p>
        )}
      </section>

      <section id="operations-validation" className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">Roster validation</h2>
        {!validation ? (
          <p className="text-sm text-muted">Roster validation is available to managers with draft access.</p>
        ) : (
          <div className="space-y-2 rounded-md border border-border bg-surface px-3 py-3 text-sm">
            <p className="text-muted">Saved draft vs composition targets.</p>
            {validation.blockers.length === 0 && validation.warnings.length === 0 ? (
              <p className="text-muted">No blockers or composition warnings on the saved draft.</p>
            ) : null}
            {validation.blockers.map((issue) => (
              <p key={`b-${issue.code}-${issue.message}`} className="flex items-start gap-2 text-danger">
                <WarningIcon label="Blocker" size={16} />
                <span>{issue.message}</span>
              </p>
            ))}
            {validation.warnings.map((issue) => (
              <p key={`w-${issue.code}-${issue.message}`} className="flex items-start gap-2 text-warning">
                <WarningIcon label="Warning" size={16} />
                <span>{issue.message}</span>
              </p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
