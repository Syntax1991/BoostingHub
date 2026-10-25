import Link from "next/link";
import { DEFAULT_TIME_ZONE } from "@/lib/datetime";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { PageWorkspace } from "@/components/ui/layout";
import { RunsFilters } from "@/components/runs/runs-filters";
import { RunsViewMode } from "@/components/runs/runs-view-mode";
import { runCreatePath } from "@/lib/run-routes";
import type { runController } from "@/controllers/app.controller";

type RunsPage = Awaited<ReturnType<typeof runController.getRunsPage>>;

/**
 * User-facing Runs discovery — card/grid surface (not Manage → Runs table).
 * Start times are absolute instants; display uses the viewer Settings timezone.
 */
export function RunsView({ data, timeZone = DEFAULT_TIME_ZONE }: { data: RunsPage; timeZone?: string }) {
  return (
    <PageWorkspace width="wide">
      <PageHeader
        title="Runs"
        description="Browse scheduled boosting operations and sign as booster or lootbuddy."
        actions={
          data.canCreate ? (
            <Link
              href={runCreatePath()}
              className="inline-flex h-8 items-center rounded-md bg-accent px-2.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover"
            >
              Create Run
            </Link>
          ) : null
        }
      />
      <RunsFilters difficulty={data.filters.difficulty} status={data.filters.status} />
      <p className="mb-3 text-[11px] text-muted">
        Times shown in <span className="text-foreground">{timeZone}</span> ·{" "}
        <Link href="/settings" className="text-accent hover:underline">
          Settings
        </Link>
      </p>
      {data.runs.length === 0 ? (
        <EmptyState
          title="No upcoming runs yet."
          description="Clear filters if you applied any, or wait for a raid lead to create runs."
        />
      ) : (
        <RunsViewMode runs={data.runs} timeZone={timeZone} />
      )}
    </PageWorkspace>
  );
}
