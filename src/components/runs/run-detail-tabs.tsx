"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { runDetailPath, type RunDetailTab } from "@/lib/run-routes";
import { RunOverviewSection } from "@/components/runs/run-overview-section";
import { RunSignupsSection } from "@/components/runs/run-signups-section";
import { RunRosterSection } from "@/components/runs/run-roster-section";
import type { RunDetailView } from "@/services/run-detail.service";

const TABS: Array<{ id: RunDetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "signups", label: "Signups" },
  { id: "roster", label: "Roster" },
];

export function RunDetailTabs({
  data,
  initialTab,
}: {
  data: RunDetailView;
  initialTab: RunDetailTab;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<RunDetailTab>(initialTab);

  function selectTab(next: RunDetailTab) {
    setTab(next);
    router.replace(runDetailPath(data.run.id, next), { scroll: false });
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Run sections"
        className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1"
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
                "shrink-0 rounded-md px-3 py-2 text-sm",
                selected ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-raised hover:text-foreground",
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
                if (!nextId) {
                  return;
                }
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
      <div
        role="tabpanel"
        id={`run-panel-${tab}`}
        aria-labelledby={`run-tab-${tab}`}
      >
        {tab === "overview" ? <RunOverviewSection data={data} /> : null}
        {tab === "signups" ? <RunSignupsSection data={data} /> : null}
        {tab === "roster" ? <RunRosterSection data={data} /> : null}
      </div>
    </div>
  );
}
