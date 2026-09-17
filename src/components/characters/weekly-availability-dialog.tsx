"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCharacterCurrentResetAvailabilityAction } from "@/controllers/character-weekly-availability.actions";
import { Button } from "@/components/ui/button";
import { DIFFICULTY_LABELS } from "@/lib/labels";
import { cn } from "@/lib/cn";
import { RAID_DIFFICULTIES, type RaidDifficulty } from "@/models/enums";

type WeeklyAvailabilityState = {
  status: "AVAILABLE" | "UNAVAILABLE";
  unavailableDifficulties: RaidDifficulty[];
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
  const [selectedDifficulties, setSelectedDifficulties] = useState<RaidDifficulty[]>(
    weeklyAvailability.unavailableDifficulties,
  );

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
    setSelectedDifficulties([...weeklyAvailability.unavailableDifficulties]);
    setError(null);
    setOpen(true);
  }

  function close() {
    dialogRef.current?.close();
    setOpen(false);
  }

  function toggleDifficulty(difficulty: RaidDifficulty) {
    setSelectedDifficulties((current) =>
      current.includes(difficulty)
        ? current.filter((item) => item !== difficulty)
        : RAID_DIFFICULTIES.filter((item) => item === difficulty || current.includes(item)),
    );
  }

  function save() {
    if (!available && selectedDifficulties.length === 0) {
      setError("Select at least one difficulty when marking unavailable.");
      return;
    }
    startTransition(async () => {
      const result = await setCharacterCurrentResetAvailabilityAction({
        characterId,
        available,
        unavailableDifficulties: available ? undefined : selectedDifficulties,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      close();
      router.refresh();
    });
  }

  const saveDisabled = pending || (!available && selectedDifficulties.length === 0);

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

          <div className="space-y-2">
            <p className="text-sm font-medium">Available this reset?</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={available}
                onClick={() => {
                  setAvailable(true);
                  setError(null);
                }}
                className={cn(
                  "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium",
                  available
                    ? "bg-accent text-black"
                    : "border border-border hover:bg-surface-raised",
                )}
              >
                Yes
              </button>
              <button
                type="button"
                aria-pressed={!available}
                onClick={() => {
                  setAvailable(false);
                  setError(null);
                }}
                className={cn(
                  "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium",
                  !available
                    ? "bg-accent text-black"
                    : "border border-border hover:bg-surface-raised",
                )}
              >
                No
              </button>
            </div>
          </div>

          {!available ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Unavailable for</p>
              <div className="flex flex-wrap gap-2">
                {RAID_DIFFICULTIES.map((difficulty) => {
                  const selected = selectedDifficulties.includes(difficulty);
                  return (
                    <button
                      key={difficulty}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        toggleDifficulty(difficulty);
                        setError(null);
                      }}
                      className={cn(
                        "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium",
                        selected
                          ? "border border-[#8a4a4a] bg-[#4a2a2a] text-[#f0b4b4]"
                          : "border border-border hover:bg-surface-raised",
                      )}
                    >
                      {DIFFICULTY_LABELS[difficulty]}
                    </button>
                  );
                })}
              </div>
              {selectedDifficulties.length === 0 ? (
                <p className="text-xs text-warning">Select at least one difficulty.</p>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-sm text-warning">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={saveDisabled}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
