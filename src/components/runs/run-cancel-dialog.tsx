"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { cancelRunAction } from "@/controllers/run.actions";
import { Button } from "@/components/ui/button";

export function RunCancelDialog({
  runId,
  onClose,
}: {
  runId: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onDialogClose = () => onClose();
    dialog.addEventListener("close", onDialogClose);
    return () => dialog.removeEventListener("close", onDialogClose);
  }, [onClose]);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await cancelRunAction({ runId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      close();
      window.location.reload();
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(28rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Cancel this run?
        </h2>
      </div>
      <div className="space-y-3 px-4 py-4 text-sm">
        {error ? (
          <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
            {error}
          </p>
        ) : null}
        <p>The run will be marked cancelled and the signup window will close.</p>
        <p className="text-muted">
          Existing signup and roster records stay for history. Nothing is deleted.
        </p>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3 -mx-4 -mb-4 mt-4">
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Keep run
          </Button>
          <Button type="button" variant="danger" onClick={submit} disabled={pending}>
            {pending ? "Cancelling…" : "Cancel run"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
