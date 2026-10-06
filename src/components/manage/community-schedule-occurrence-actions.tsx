"use client";

import Link from "next/link";
import { useTransition, useState } from "react";
import { materializeCommunityScheduleOccurrenceAction } from "@/controllers/community-schedule.actions";
import type { CommunityScheduleOccurrenceView } from "@/services/community-schedule.service";
import type { RaidIdWindow } from "@/lib/community-schedule";

const STATE_LABELS: Record<CommunityScheduleOccurrenceView["state"], string> = {
  RUN_CREATED: "Run created",
  NO_RUN_YET: "No run yet",
  AUTO_WAITING: "Auto-create waiting",
  AUTO_BLOCKED: "Auto-create blocked",
  PAST: "Past",
};

export function CommunityScheduleOccurrenceActions({
  scheduleSlotId,
  window,
  materialization,
}: {
  scheduleSlotId: string;
  window: RaidIdWindow;
  materialization: CommunityScheduleOccurrenceView;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function createRun() {
    setError(null);
    startTransition(async () => {
      const result = await materializeCommunityScheduleOccurrenceAction({
        scheduleSlotId,
        window,
      });
      if (!result.ok) {
        setError(result.message);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
        {STATE_LABELS[materialization.state]}
      </span>
      {materialization.templateLabel ? (
        <p className="text-[10px] text-muted">Run Setup: {materialization.templateLabel}</p>
      ) : null}
      <p className="text-[10px] text-muted">
        Auto-create: {materialization.autoCreateRun ? "ON" : "OFF"}
      </p>
      {materialization.blockedReason ? (
        <p className="max-w-xs text-right text-[10px] text-danger">{materialization.blockedReason}</p>
      ) : null}
      {materialization.runId ? (
        <Link
          href={`/manage/runs/${materialization.runId}`}
          className="text-xs font-medium text-accent hover:underline"
        >
          Open Run
        </Link>
      ) : null}
      {materialization.canMaterialize && materialization.state !== "RUN_CREATED" ? (
        <button
          type="button"
          disabled={pending}
          onClick={createRun}
          className="inline-flex h-7 items-center rounded-md border border-border bg-surface-raised px-2 text-xs font-medium hover:bg-[#222a3b] disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create Run"}
        </button>
      ) : null}
      {error ? <p className="max-w-xs text-right text-[10px] text-danger">{error}</p> : null}
    </div>
  );
}
