"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createAvailabilityBlockAction,
  updateAvailabilityBlockAction,
} from "@/controllers/character-availability.actions";
import { Button } from "@/components/ui/button";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime";

type BlockInitial = {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
};

export function AvailabilityBlockDialog({
  characterId,
  mode,
  initial,
  triggerLabel,
  triggerClassName,
}: {
  characterId: string;
  mode: "create" | "edit";
  initial?: BlockInitial;
  triggerLabel: string;
  triggerClassName?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [startsLocal, setStartsLocal] = useState(
    initial ? toDatetimeLocalValue(initial.startsAt) : "",
  );
  const [endsLocal, setEndsLocal] = useState(initial ? toDatetimeLocalValue(initial.endsAt) : "");
  const [reason, setReason] = useState(initial?.reason ?? "");

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setOpen(false);
      setError(null);
      setStartsLocal(initial ? toDatetimeLocalValue(initial.startsAt) : "");
      setEndsLocal(initial ? toDatetimeLocalValue(initial.endsAt) : "");
      setReason(initial?.reason ?? "");
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [open, initial]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    let startsAt: string;
    let endsAt: string;
    try {
      startsAt = fromDatetimeLocalValue(startsLocal);
      endsAt = fromDatetimeLocalValue(endsLocal);
    } catch {
      setError("Enter valid start and end times.");
      return;
    }

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createAvailabilityBlockAction({
              characterId,
              startsAt,
              endsAt,
              reason: reason.trim() || null,
            })
          : await updateAvailabilityBlockAction({
              blockId: initial!.id,
              startsAt,
              endsAt,
              reason: reason.trim() || null,
            });
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
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          "inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-surface-raised"
        }
      >
        {triggerLabel}
      </button>
      {open ? (
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/50"
        >
          <form onSubmit={submit} className="space-y-4 p-4">
            <h2 id={titleId} className="text-base font-semibold">
              {mode === "create" ? "Add external plan" : "Edit external plan"}
            </h2>
            <p className="text-xs text-muted">
              Times use Europe/Berlin. BoostingHub Runs whose start falls inside this interval cannot
              use this Character.
            </p>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Starts</span>
              <input
                type="datetime-local"
                required
                value={startsLocal}
                onChange={(event) => setStartsLocal(event.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Ends</span>
              <input
                type="datetime-local"
                required
                value={endsLocal}
                onChange={(event) => setEndsLocal(event.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Community / note</span>
              <input
                type="text"
                maxLength={120}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Phoenix"
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
              />
            </label>
            {error ? (
              <p id={errorId} role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : mode === "create" ? "Add" : "Save"}
              </Button>
            </div>
          </form>
        </dialog>
      ) : null}
    </>
  );
}
