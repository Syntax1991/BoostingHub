"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  rejectBoosterAccessAction,
  revokeBoosterAccessAction,
} from "@/controllers/booster-access.actions";
import { Button } from "@/components/ui/button";
import { BOOSTER_ACCESS_REVIEW_REASON_MAX } from "@/validators/booster-access";

export function BoosterAccessReviewDialog({
  accessId,
  qualificationId,
  mode,
}: {
  accessId?: string;
  qualificationId?: string;
  mode: "reject" | "revoke";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const reasonId = useId();
  const errorId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setOpen(false);
      setError(null);
      setReason("");
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [open]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result =
        mode === "reject"
          ? await rejectBoosterAccessAction({
              accessId: accessId!,
              reason: reason.trim() || undefined,
            })
          : await revokeBoosterAccessAction({
              qualificationId: qualificationId!,
              reason: reason.trim() || undefined,
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
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {mode === "reject" ? "Reject" : "Revoke"}
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
            {mode === "reject" ? "Reject booster access" : "Revoke booster access"}
          </h2>
          <p className="text-xs text-muted">
            {mode === "revoke"
              ? "The account becomes ineligible for new booster signups at this difficulty. Existing signups and roster history stay."
              : "Rejected access does not grant booster eligibility."}
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Reason (optional, visible to the owner)</span>
            <textarea
              id={reasonId}
              aria-label="Review reason"
              value={reason}
              maxLength={BOOSTER_ACCESS_REVIEW_REASON_MAX}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
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
              {pending ? "Saving…" : mode === "reject" ? "Reject" : "Revoke"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
