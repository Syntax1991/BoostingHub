"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteAvailabilityBlockAction } from "@/controllers/character-availability.actions";
import { AvailabilityBlockDialog } from "@/components/characters/availability-block-dialog";
import { formatDateTime } from "@/lib/datetime";
import type { ExternalPlanningSummary } from "@/services/character-availability.service";

export function ExternalPlanningCell({
  characterId,
  commitments,
}: {
  characterId: string;
  commitments: ExternalPlanningSummary[];
}) {
  const primary = commitments[0] ?? null;
  const extraCount = Math.max(0, commitments.length - 1);

  return (
    <div className="min-w-[10rem] max-w-[14rem] space-y-2 text-xs">
      {primary ? (
        <div className="min-w-0">
          {primary.isCurrent ? (
            <div className="font-medium text-accent">External now</div>
          ) : null}
          <div className="truncate font-medium" title={primary.communityLabel}>
            {primary.communityLabel}
          </div>
          <div className="text-muted">{primary.timeLabel}</div>
          {extraCount > 0 ? (
            <div className="text-muted">+{extraCount} more</div>
          ) : null}
        </div>
      ) : (
        <div className="text-muted">None</div>
      )}
      <div className="flex flex-wrap gap-2">
        <AvailabilityBlockDialog
          characterId={characterId}
          mode="create"
          triggerLabel={primary ? "Add" : "Add external plan"}
          triggerClassName="inline-flex h-7 items-center rounded-md border border-border px-2 text-[11px] hover:bg-surface-raised"
        />
        {primary ? (
          <ManageExternalPlansDialog characterId={characterId} commitments={commitments} />
        ) : null}
      </div>
    </div>
  );
}

function ManageExternalPlansDialog({
  characterId,
  commitments,
}: {
  characterId: string;
  commitments: ExternalPlanningSummary[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setOpen(false);
      setError(null);
      setPendingId(null);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [open]);

  function remove(blockId: string) {
    setError(null);
    setPendingId(blockId);
    startTransition(async () => {
      const result = await deleteAvailabilityBlockAction({ blockId });
      if (!result.ok) {
        setError(result.message);
        setPendingId(null);
        return;
      }
      router.refresh();
      if (commitments.length <= 1) {
        dialogRef.current?.close();
      }
      setPendingId(null);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 items-center rounded-md border border-border px-2 text-[11px] hover:bg-surface-raised"
      >
        Manage
      </button>
      {open ? (
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          className="w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/50"
        >
          <div className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id={titleId} className="text-base font-semibold">
                  External commitments
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Current and upcoming plans for this Character.
                </p>
              </div>
              <button
                type="button"
                onClick={() => dialogRef.current?.close()}
                className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-surface-raised"
              >
                Close
              </button>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <ul className="divide-y divide-border rounded-md border border-border">
              {commitments.map((block) => (
                <li
                  key={block.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-3 py-3 text-sm"
                >
                  <div className="min-w-0">
                    {block.isCurrent ? (
                      <div className="text-xs font-medium text-accent">External now</div>
                    ) : null}
                    <div className="font-medium" title={block.communityLabel}>
                      {block.communityLabel}
                    </div>
                    <div className="text-xs text-muted">
                      {formatDateTime(block.startsAt)} → {formatDateTime(block.endsAt)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <AvailabilityBlockDialog
                      characterId={characterId}
                      mode="edit"
                      triggerLabel="Edit"
                      initial={{
                        id: block.id,
                        startsAt: block.startsAt,
                        endsAt: block.endsAt,
                        reason: block.reason,
                      }}
                    />
                    <button
                      type="button"
                      disabled={pending && pendingId === block.id}
                      onClick={() => remove(block.id)}
                      className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {pending && pendingId === block.id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
