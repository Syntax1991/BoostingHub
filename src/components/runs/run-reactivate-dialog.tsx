"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { reactivateRunAction } from "@/controllers/run.actions";
import { Button } from "@/components/ui/button";
import type { RunStatus } from "@/models/enums";

function restoreLabel(status: RunStatus | null | undefined): string {
  switch (status) {
    case "DRAFT":
      return "Restore to Draft";
    case "OPEN":
      return "Restore to Open";
    case "ROSTERING":
      return "Restore to Rostering";
    case "PUBLISHED":
      return "Restore to Roster Published";
    default:
      return "Restore previous state";
  }
}

export function RunReactivateDialog({
  runId,
  cancelledFromStatus,
  onClose,
}: {
  runId: string;
  cancelledFromStatus: RunStatus | null;
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
      const result = await reactivateRunAction({ runId });
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
      aria-describedby={error ? errorId : undefined}
      className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-panel p-5 text-foreground shadow-xl backdrop:bg-black/60"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        Reactivate Run?
      </h2>
      <p className="mt-2 text-sm text-muted">
        This restores the Run to its state before cancellation and keeps its existing signups and
        roster. If the Discord channel was already removed, Manawyrm Hub will recreate the required
        Run channel automatically.
      </p>
      <p className="mt-2 text-sm font-medium text-foreground">{restoreLabel(cancelledFromStatus)}</p>
      {error ? (
        <p id={errorId} role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? "Reactivating…" : "Reactivate Run"}
        </Button>
      </div>
    </dialog>
  );
}
