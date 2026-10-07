"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { duplicateCommunityScheduleRunSetupAction } from "@/controllers/community-schedule.actions";

export function CommunityScheduleDuplicateSetupButton({
  runTemplateId,
}: {
  runTemplateId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await duplicateCommunityScheduleRunSetupAction({ runTemplateId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
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
        {pending ? "Duplicating…" : "Duplicate"}
      </button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
