"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addStrikeAction } from "@/controllers/strike.actions";
import { Button } from "@/components/ui/button";

/** General (not run-linked) strike creation. Run-linked strikes are added from the Attendance tab, where the run/attendance context is already known. */
export function AddStrikeDialog({ userId, userName }: { userId: string; userName: string }) {
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
    const onClose = () => {
      setOpen(false);
      setError(null);
      setReason("");
      setNotes("");
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [open]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
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
      <Button type="button" variant="secondary" className="h-8 px-2 text-xs" onClick={() => setOpen(true)}>
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
          <p className="text-xs text-muted">
            Not linked to a specific run. To add a strike for a run incident, use Add Strike on that run&apos;s
            Attendance tab instead.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Reason</span>
            <input
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={200}
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
              placeholder="Short, staff/user-facing reason"
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
