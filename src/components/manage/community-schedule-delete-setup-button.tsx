"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteCommunityScheduleRunSetupAction } from "@/controllers/community-schedule.actions";

export function CommunityScheduleDeleteSetupButton({
  runTemplateId,
  runSetupName,
  raidLeadName,
  slotCount,
  canDelete,
  deleteBlockedReason,
}: {
  runTemplateId: string;
  runSetupName: string;
  raidLeadName: string;
  slotCount: number;
  canDelete: boolean;
  deleteBlockedReason: string | null;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canDelete) {
    if (!deleteBlockedReason) return null;
    return (
      <span
        title={deleteBlockedReason}
        className="inline-flex h-8 cursor-not-allowed items-center rounded-md border border-border px-2 text-xs text-muted opacity-60"
      >
        Delete Run Setup
      </span>
    );
  }

  function runDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteCommunityScheduleRunSetupAction({ runTemplateId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      dialogRef.current?.close();
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          dialogRef.current?.showModal();
        }}
        disabled={pending}
        className="inline-flex h-8 items-center rounded-md border border-danger/40 px-2 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-60"
      >
        Delete Run Setup
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={error ? errorId : undefined}
        className="w-[min(28rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
      >
        <div className="flex flex-col gap-3 p-4">
          <h2 id={titleId} className="text-sm font-semibold">
            Delete Run Setup?
          </h2>
          <div className="space-y-1 text-xs text-muted">
            <p className="font-medium text-foreground">
              {runSetupName} · {raidLeadName}
            </p>
            <p>This will permanently delete:</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>this Run Setup</li>
              <li>
                {slotCount} recurring Schedule time{slotCount === 1 ? "" : "s"}
              </li>
            </ul>
            <p>No Runs have ever been created from these times.</p>
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
              {pending ? "Deleting…" : "Delete Run Setup"}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
