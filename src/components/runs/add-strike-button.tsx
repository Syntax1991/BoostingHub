"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addStrikeAction } from "@/controllers/strike.actions";
import { Button } from "@/components/ui/button";

/**
 * Run-linked strike creation from the Signups tab. runId/userId come from
 * BoostingHub's own signup row — the server re-validates the User actually
 * has signup history on this Run (and, for a RAID_LEAD actor, that they
 * manage it) regardless of what this dialog sends. No Attendance
 * involvement: that operational workflow belongs to Dawn Boosting.
 */
export function AddStrikeButton({
  runId,
  userId,
  userName,
}: {
  runId: string;
  userId: string;
  userName: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onDialogClose = () => {
      setOpen(false);
      setError(null);
      setReason("");
      setNotes("");
    };
    dialog.addEventListener("close", onDialogClose);
    return () => dialog.removeEventListener("close", onDialogClose);
  }, [open]);

  function close() {
    dialogRef.current?.close();
  }

  function submit() {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addStrikeAction({
        userId,
        runId,
        reason,
        notes: notes.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      close();
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setOpen(true)}>
        Add strike
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="w-[min(28rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
      >
        <form
          className="flex flex-col gap-4 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <h2 id={titleId} className="text-sm font-semibold">
            Add strike · {userName}
          </h2>
          <p className="text-xs text-muted">Linked to this run.</p>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Reason</span>
            <input
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={200}
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
              placeholder="e.g. No-show without notice"
              autoFocus
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Internal notes (optional, staff-only)</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              rows={3}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5"
            />
          </label>
          {error ? (
            <p id={errorId} role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add strike"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
