"use client";

import { useRouter } from "next/navigation";

export function ManageTemplatesFilters({
  status,
  raidLeadId,
  raidLeads,
}: {
  status?: string;
  raidLeadId?: string;
  raidLeads: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();

  function push(next: { status?: string; raidLeadId?: string }) {
    const params = new URLSearchParams();
    if (next.status && next.status !== "active") params.set("status", next.status);
    if (next.raidLeadId) params.set("raidLeadId", next.raidLeadId);
    router.push(`/manage/templates${params.toString() ? `?${params}` : ""}`);
  }

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted">Raid Lead</span>
        <select
          aria-label="Raid Lead"
          value={raidLeadId ?? ""}
          onChange={(event) => push({ status, raidLeadId: event.target.value })}
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
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted">Status</span>
        <select
          aria-label="Status"
          value={status ?? "active"}
          onChange={(event) => push({ status: event.target.value, raidLeadId })}
          className="h-9 rounded-md border border-border bg-surface px-2"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </label>
    </div>
  );
}
