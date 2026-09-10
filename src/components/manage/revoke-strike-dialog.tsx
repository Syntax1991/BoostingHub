"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokeStrikeAction } from "@/controllers/strike.actions";
import { Button } from "@/components/ui/button";

export function RevokeStrikeDialog({ strikeId }: { strikeId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revokedReason, setRevokedReason] = useState("");

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setOpen(false);
      setError(null);
      setRevokedReason("");
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [open]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
  }

  function submit() {
    if (!revokedReason.trim()) {
      setError("A reason is required to revoke a strike.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await revokeStrikeAction({ strikeId, revokedReason });
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
        Revoke
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
            Revoke strike
          </h2>
          <p className="text-xs text-muted">This is a staff correction. The strike stays in history as revoked.</p>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Reason for revoking</span>
            <input
              type="text"
              value={revokedReason}
              onChange={(event) => setRevokedReason(event.target.value)}
              maxLength={500}
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
              autoFocus
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
              {pending ? "Revoking…" : "Revoke strike"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
