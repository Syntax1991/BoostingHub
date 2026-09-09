"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { completeRunAction } from "@/controllers/run.actions";
import { Button } from "@/components/ui/button";

export function RunCompleteDialog({
  runId,
  unmarkedCount,
  onClose,
}: {
  runId: string;
  unmarkedCount: number;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const blocked = unmarkedCount > 0;

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
    if (blocked) return;
    setError(null);
    startTransition(async () => {
      const result = await completeRunAction({ runId });
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
      className="w-[min(32rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Complete this run?
        </h2>
      </div>
      <div className="space-y-3 px-4 py-4 text-sm">
        {error ? (
          <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
            {error}
          </p>
        ) : null}
        {blocked ? (
          <p role="alert">
            Mark attendance for all rostered participants before completing the run. {unmarkedCount} unmarked{" "}
            {unmarkedCount === 1 ? "entry remains" : "entries remain"}.
          </p>
        ) : (
          <p>Attendance becomes final and read-only. Signup and roster history stay intact.</p>
        )}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3 -mx-4 -mb-4 mt-4">
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Keep in progress
          </Button>
          <Button type="button" onClick={submit} disabled={pending || blocked}>
            {pending ? "Completing…" : "Complete run"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
