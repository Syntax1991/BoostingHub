"use client";

import { useState, useTransition } from "react";
import {
  deactivateCommunityScheduleSlotAction,
  reactivateCommunityScheduleSlotAction,
} from "@/controllers/community-schedule.actions";

export function CommunityScheduleSlotActions({
  slotId,
  isActive,
}: {
  slotId: string;
  isActive: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const result = isActive
        ? await deactivateCommunityScheduleSlotAction({ slotId })
        : await reactivateCommunityScheduleSlotAction({ slotId });
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex h-8 items-center rounded-md border border-border bg-surface-raised px-2 text-xs font-medium hover:bg-[#222a3b] disabled:opacity-60"
      >
        {pending ? "Working…" : isActive ? "Deactivate" : "Reactivate"}
      </button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
