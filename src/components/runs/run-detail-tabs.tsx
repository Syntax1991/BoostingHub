"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { resolveRunDetailTab, runDetailPath, type RunDetailTab } from "@/lib/run-routes";
import { RunSignupsSection } from "@/components/runs/run-signups-section";
import { RunRosterSection } from "@/components/runs/run-roster-section";
import { RunRosterConfigAdmin } from "@/components/runs/run-roster-config-admin";
import type { RunDetailView } from "@/services/run-detail.service";

/** Non-default tabs: code-split so Roster-first loads skip these client modules. */
const RunOperationsSection = dynamic(() =>
  import("@/components/runs/run-operations-section").then((m) => m.RunOperationsSection),
);
const RunAttendanceSection = dynamic(() =>
  import("@/components/runs/run-attendance-section").then((m) => m.RunAttendanceSection),
);
const RunHistorySection = dynamic(() =>
  import("@/components/runs/run-history-section").then((m) => m.RunHistorySection),
);
const RunConsumablesSection = dynamic(() =>
  import("@/components/runs/run-consumables-section").then((m) => m.RunConsumablesSection),
);

const BASE_TABS: Array<{ id: RunDetailTab; label: string }> = [
  { id: "roster", label: "Roster" },
  { id: "operations", label: "Operations" },
  { id: "attendance", label: "Attendance" },
  { id: "history", label: "History" },
];

export function RunDetailTabs({
  data,
  initialTab,
  timeZone,
}: {
  data: RunDetailView;
  initialTab: RunDetailTab;
  timeZone?: string;
}) {
  const router = useRouter();
  const consumables = data.consumables;
  const TABS = consumables ? [...BASE_TABS, { id: "consumables" as const, label: "Consumables" }] : BASE_TABS;
  const [tab, setTab] = useState<RunDetailTab>(() =>
    resolveRunDetailTab(initialTab, Boolean(consumables)),
  );

  function selectTab(next: RunDetailTab) {
    const resolved = resolveRunDetailTab(next, Boolean(consumables));
    setTab(resolved);
    router.replace(runDetailPath(data.run.id, resolved), { scroll: false });
  }

  const canManageRoster = data.permissions.canManageRun && Boolean(data.manager);

  return (
    <div>
      <div
        role="tablist"
        aria-label="Run sections"
        className="-mx-1 mb-3 flex w-full max-w-full gap-0.5 overflow-x-auto border-b border-border px-1 pb-px"
      >
        {TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`run-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`run-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              className={cn(
                "shrink-0 rounded-t-md px-3 py-2 text-sm font-medium",
                selected
                  ? "border border-b-0 border-border bg-surface text-foreground"
                  : "text-muted hover:bg-surface-raised hover:text-foreground",
              )}
              onClick={() => selectTab(item.id)}
              onKeyDown={(event) => {
                const index = TABS.findIndex((entry) => entry.id === tab);
                let nextId: RunDetailTab | null = null;
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  nextId = TABS[(index + 1) % TABS.length].id;
                }
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  nextId = TABS[(index - 1 + TABS.length) % TABS.length].id;
                }
                if (!nextId) return;
                selectTab(nextId);
                requestAnimationFrame(() => {
                  document.getElementById(`run-tab-${nextId}`)?.focus();
                });
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`run-panel-${tab}`} aria-labelledby={`run-tab-${tab}`}>
        {tab === "roster" ? (
          <div className="space-y-6">
            {canManageRoster ? (
              <RunRosterSection
                data={data}
                afterContext={<RunRosterConfigAdmin data={data} timeZone={timeZone ?? "UTC"} />}
              />
            ) : (
              <>
                <RunRosterConfigAdmin data={data} timeZone={timeZone ?? "UTC"} />
                <RunSignupsSection data={data} />
                <RunRosterSection data={data} />
              </>
            )}
          </div>
        ) : null}
        {tab === "operations" ? <RunOperationsSection data={data} timeZone={timeZone ?? "UTC"} /> : null}
        {tab === "attendance" ? <RunAttendanceSection data={data} /> : null}
        {tab === "history" ? (
          data.history ? (
            <RunHistorySection events={data.history} />
          ) : (
            <p className="text-sm text-muted">History is available to run managers.</p>
          )
        ) : null}
        {tab === "consumables" && consumables ? <RunConsumablesSection audit={consumables} /> : null}
      </div>
    </div>
  );
}
