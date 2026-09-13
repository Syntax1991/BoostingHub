"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { startRunAction } from "@/controllers/run.actions";
import { Button } from "@/components/ui/button";
import { renderFinalSetupText, type FinalSetupInput } from "@/lib/run-start-message";

export function RunStartDialog({
  runId,
  finalSetup,
  onClose,
}: {
  runId: string;
  finalSetup?: FinalSetupInput | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const previewText = finalSetup ? renderFinalSetupText(finalSetup) : null;

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

  function copyMessage() {
    if (!previewText) return;
    void navigator.clipboard.writeText(previewText).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await startRunAction({ runId });
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
      className="w-[min(40rem,calc(100vw-2rem))] max-h-[min(90vh,44rem)] overflow-y-auto rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Start Run
        </h2>
      </div>
      <div className="space-y-4 px-4 py-4 text-sm">
        {error ? (
          <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
            {error}
          </p>
        ) : null}
        <p>Starting this run will:</p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>close signups</li>
          <li>freeze/snapshot the published roster into Attendance</li>
          <li>set the Run to IN_PROGRESS</li>
          <li>post the Final Setup to the Run&apos;s Discord channel asynchronously</li>
        </ul>

        {previewText ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Final Setup</p>
              <Button type="button" variant="ghost" disabled={pending} onClick={copyMessage}>
                {copied ? "Copied" : "Copy message"}
              </Button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-surface-raised px-3 py-3 font-mono text-xs leading-relaxed">
              {previewText}
            </pre>
          </div>
        ) : (
          <p className="text-muted">Final Setup preview is available from the Run detail page.</p>
        )}

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3 -mx-4 -mb-4">
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? "Starting…" : "Start Run"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
