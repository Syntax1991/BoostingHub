"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCharacterCurrentResetAvailabilityAction } from "@/controllers/character-weekly-availability.actions";
import { Button } from "@/components/ui/button";

type WeeklyAvailabilityState = {
  status: "AVAILABLE" | "UNAVAILABLE";
  resetWindowLabel: string;
};

export function WeeklyAvailabilityDialog({
  characterId,
  characterName,
  weeklyAvailability,
  triggerLabel,
  triggerClassName,
}: {
  characterId: string;
  characterName: string;
  weeklyAvailability: WeeklyAvailabilityState;
  triggerLabel: string;
  triggerClassName?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(weeklyAvailability.status === "AVAILABLE");

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => setOpen(false);
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [open]);

  function openDialog() {
    setAvailable(weeklyAvailability.status === "AVAILABLE");
    setError(null);
    setOpen(true);
  }

  function close() {
    dialogRef.current?.close();
    setOpen(false);
  }

  function save() {
    startTransition(async () => {
      const result = await setCharacterCurrentResetAvailabilityAction({
        characterId,
        available,
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
      <button type="button" className={triggerClassName} onClick={openDialog}>
        {triggerLabel}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/50"
        onCancel={close}
      >
        <div className="space-y-4 p-5">
          <div>
            <h2 id={titleId} className="text-base font-semibold">
              Weekly Availability
            </h2>
            <p className="mt-1 text-sm text-muted">{characterName}</p>
          </div>

          <div className="rounded-md border border-border bg-surface-raised px-3 py-2 text-xs">
            <div className="text-muted">Current reset</div>
            <div className="mt-0.5 font-medium">{weeklyAvailability.resetWindowLabel}</div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Available this reset?</legend>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-accent">
              <input
                type="radio"
                name={`weekly-availability-${characterId}`}
                checked={available}
                onChange={() => setAvailable(true)}
              />
              Available
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-accent">
              <input
                type="radio"
                name={`weekly-availability-${characterId}`}
                checked={!available}
                onChange={() => setAvailable(false)}
              />
              Unavailable
            </label>
          </fieldset>

          {error ? <p className="text-sm text-warning">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
