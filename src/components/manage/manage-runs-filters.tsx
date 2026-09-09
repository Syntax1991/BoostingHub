"use client";

import { useRouter } from "next/navigation";
import { RUN_STATUSES } from "@/models/enums";
import { RUN_STATUS_LABELS } from "@/lib/labels";

export function ManageRunsFilters({
  status,
  raidLeadId,
  timeframe,
  raidLeads,
}: {
  status?: string;
  raidLeadId?: string;
  timeframe?: string;
  raidLeads: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();

  function push(next: { status?: string; raidLeadId?: string; timeframe?: string }) {
    const params = new URLSearchParams();
    if (next.status) params.set("status", next.status);
    if (next.raidLeadId) params.set("raidLeadId", next.raidLeadId);
    if (next.timeframe) params.set("timeframe", next.timeframe);
    router.push(`/manage/runs${params.toString() ? `?${params}` : ""}`);
  }

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted">Status</span>
        <select
          aria-label="Run status"
          value={status ?? ""}
          onChange={(event) => push({ status: event.target.value, raidLeadId, timeframe })}
          className="h-9 rounded-md border border-border bg-surface px-2"
        >
          <option value="">All</option>
          {RUN_STATUSES.map((value) => (
            <option key={value} value={value}>
              {RUN_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted">Schedule</span>
        <select
          aria-label="Schedule timeframe"
          value={timeframe ?? ""}
          onChange={(event) => push({ status, raidLeadId, timeframe: event.target.value })}
          className="h-9 rounded-md border border-border bg-surface px-2"
        >
          <option value="">All</option>
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
        </select>
      </label>
      {raidLeads.length > 0 ? (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Raid Lead</span>
          <select
            aria-label="Raid Lead"
            value={raidLeadId ?? ""}
            onChange={(event) => push({ status, raidLeadId: event.target.value, timeframe })}
            className="h-9 max-w-[12rem] rounded-md border border-border bg-surface px-2"
          >
            <option value="">All</option>
            {raidLeads.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
