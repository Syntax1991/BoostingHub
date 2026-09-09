"use client";

import { useRouter } from "next/navigation";
import { RAID_DIFFICULTIES, RUN_STATUSES } from "@/models/enums";
import { DIFFICULTY_LABELS, RUN_STATUS_LABELS } from "@/lib/labels";

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
    <div className="mb-4 flex flex-wrap gap-2">
      <FilterSelect
        label="Difficulty"
        value={difficulty ?? ""}
        options={RAID_DIFFICULTIES.map((value) => ({ value, label: DIFFICULTY_LABELS[value] }))}
        onChange={(value) => updateFilter("difficulty", value)}
      />
      <FilterSelect
        label="Run status"
        value={status ?? ""}
        options={RUN_STATUSES.filter((value) => value !== "DRAFT" && value !== "CANCELLED").map((value) => ({
          value,
          label: RUN_STATUS_LABELS[value],
        }))}
        onChange={(value) => updateFilter("status", value)}
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-border bg-surface px-2"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
