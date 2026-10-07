"use client";

import { useRouter } from "next/navigation";

export function ManageTemplatesFilters({
  status,
}: {
  status?: string;
}) {
  const router = useRouter();

  function push(nextStatus: string) {
    const params = new URLSearchParams();
    if (nextStatus && nextStatus !== "active") params.set("status", nextStatus);
    const query = params.toString();
    router.push(query ? `/manage/templates?${query}` : "/manage/templates");
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <label className="text-xs text-muted">
        Status{" "}
        <select
          value={status ?? "active"}
          onChange={(event) => push(event.target.value)}
          className="ml-1 h-8 rounded-md border border-border bg-surface-raised px-2 text-sm"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </label>
    </div>
  );
}
