"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  deactivateCommunityScheduleSlotAction,
  deleteCommunityScheduleSlotAction,
  reactivateCommunityScheduleSlotAction,
} from "@/controllers/community-schedule.actions";
import { communityWeekdayShortLabel } from "@/lib/community-schedule";
import { COMMUNITY_SCHEDULE_RUN_MODE_LABELS } from "@/lib/labels";
import type { CommunityScheduleRunMode, CommunityWeekday } from "@/models/enums";

export function CommunityScheduleSlotActions({
  slotId,
  isActive,
  canDelete = false,
  weekday,
  localStartTime,
  runMode,
  runSetupName,
  raidLeadName,
}: {
  slotId: string;
  isActive: boolean;
  /** When omitted (e.g. Current/Next window rows), hard-delete controls are hidden. */
  canDelete?: boolean;
  weekday?: CommunityWeekday;
  localStartTime?: string;
  runMode?: CommunityScheduleRunMode;
  runSetupName?: string;
  raidLeadName?: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runLifecycle() {
    setError(null);
    startTransition(async () => {
      const result = isActive
        ? await deactivateCommunityScheduleSlotAction({ slotId })
        : await reactivateCommunityScheduleSlotAction({ slotId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  function runDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteCommunityScheduleSlotAction({ slotId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      dialogRef.current?.close();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={runLifecycle}
          disabled={pending}
          className="inline-flex h-8 items-center rounded-md border border-border bg-surface-raised px-2 text-xs font-medium hover:bg-[#222a3b] disabled:opacity-60"
        >
          {pending ? "Working…" : isActive ? "Deactivate" : "Reactivate"}
        </button>
        {canDelete && weekday && localStartTime && runMode ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              dialogRef.current?.showModal();
            }}
            disabled={pending}
            className="inline-flex h-8 items-center rounded-md border border-danger/40 px-2 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-60"
          >
            Delete
          </button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {weekday && localStartTime && runMode ? (
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          aria-describedby={error ? errorId : undefined}
          className="w-[min(28rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
        >
          <div className="flex flex-col gap-3 p-4">
            <h2 id={titleId} className="text-sm font-semibold">
              Delete Schedule time?
            </h2>
            <div className="space-y-1 text-xs text-muted">
              <p className="font-medium text-foreground">
                {communityWeekdayShortLabel(weekday)} {localStartTime} ·{" "}
                {COMMUNITY_SCHEDULE_RUN_MODE_LABELS[runMode]}
              </p>
              <p>
                {runSetupName} · {raidLeadName}
              </p>
              <p>This permanently removes this recurring time.</p>
              <p>Existing Runs already created from this time will NOT be changed.</p>
            </div>
            {error ? (
              <p
                id={errorId}
                role="alert"
                className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs"
              >
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={pending} onClick={() => dialogRef.current?.close()}>
                Cancel
              </Button>
              <Button variant="danger" disabled={pending} onClick={runDelete}>
                {pending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
