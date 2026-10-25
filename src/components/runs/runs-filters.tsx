"use client";

import { useRouter } from "next/navigation";
import { RAID_DIFFICULTIES, RUN_STATUSES } from "@/models/enums";
import { DIFFICULTY_LABELS, RUN_STATUS_LABELS } from "@/lib/labels";
import { Toolbar, ToolbarField, toolbarControlClassName } from "@/components/ui/toolbar";

/**
 * Filter controls are the only client island on the runs page so the table
 * can stay a server view and avoid hydrating locale-sensitive date cells.
 */
export function RunsFilters({
  difficulty,
  status,
}: {
  difficulty?: string;
  status?: string;
}) {
  const router = useRouter();

  function updateFilter(key: "difficulty" | "status", value: string) {
    const params = new URLSearchParams();
    const nextDifficulty = key === "difficulty" ? value : difficulty ?? "";
    const nextStatus = key === "status" ? value : status ?? "";
    if (nextDifficulty) params.set("difficulty", nextDifficulty);
    if (nextStatus) params.set("status", nextStatus);
    router.push(`/runs${params.toString() ? `?${params}` : ""}`);
  }

  return (
    <Toolbar>
      <ToolbarField label="Difficulty">
        <select
          value={difficulty ?? ""}
          onChange={(event) => updateFilter("difficulty", event.target.value)}
          className={toolbarControlClassName}
          aria-label="Difficulty"
        >
          <option value="">All</option>
          {RAID_DIFFICULTIES.map((value) => (
            <option key={value} value={value}>
              {DIFFICULTY_LABELS[value]}
            </option>
          ))}
        </select>
      </ToolbarField>
      <ToolbarField label="Run status">
        <select
          value={status ?? ""}
          onChange={(event) => updateFilter("status", event.target.value)}
          className={toolbarControlClassName}
          aria-label="Run status"
        >
          <option value="">All</option>
          {RUN_STATUSES.filter((value) => value !== "DRAFT" && value !== "CANCELLED").map((value) => (
            <option key={value} value={value}>
              {RUN_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </ToolbarField>
    </Toolbar>
  );
}
