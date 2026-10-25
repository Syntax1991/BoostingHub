"use client";

import { useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/cn";
import { RunDiscoveryCard } from "@/components/runs/run-discovery-card";
import type { runController } from "@/controllers/app.controller";

type RunRow = Awaited<ReturnType<typeof runController.getRunsPage>>["runs"][number];
type Mode = "grid" | "list";

/**
 * Grid (default) / List toggle for user-facing /runs.
 * Compact icon segmented control — Calendar is not wired in this architecture.
 */
export function RunsViewMode({ runs, timeZone }: { runs: RunRow[]; timeZone: string }) {
  const [mode, setMode] = useState<Mode>("grid");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-1">
        <div
          role="group"
          aria-label="Run list layout"
          className="inline-flex overflow-hidden rounded-md border border-border/80 bg-surface/40"
        >
          <ModeButton
            active={mode === "grid"}
            onClick={() => setMode("grid")}
            label="Grid view"
            icon={LayoutGrid}
          />
          <ModeButton
            active={mode === "list"}
            onClick={() => setMode("list")}
            label="List view"
            icon={List}
          />
        </div>
      </div>
      <div
        className={cn(
          mode === "grid" && "grid grid-cols-1 gap-3 md:grid-cols-2",
          mode === "list" && "flex flex-col gap-2",
        )}
      >
        {runs.map((run) => (
          <RunDiscoveryCard key={run.id} run={run} timeZone={timeZone} layout={mode} />
        ))}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: typeof LayoutGrid;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center transition-colors",
        active
          ? "bg-accent/20 text-accent"
          : "text-muted hover:bg-surface-raised hover:text-foreground",
      )}
    >
      <Icon aria-hidden strokeWidth={1.75} className="h-4 w-4" />
    </button>
  );
}
