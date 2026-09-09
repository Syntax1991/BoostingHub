"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestBoosterAccessAction } from "@/controllers/booster-access.actions";
import { Button } from "@/components/ui/button";
import { CHARACTER_ROLE_LABELS, DIFFICULTY_LABELS } from "@/lib/labels";
import type { CharacterRole, RaidDifficulty } from "@/models/enums";
import type { BoosterAccessCell } from "@/services/booster-access.service";

export function RequestBoosterAccessDialog({
  characterId,
  cells,
  disabled,
  disabledReason,
}: {
  characterId: string;
  cells: BoosterAccessCell[];
  disabled: boolean;
  disabledReason: string | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const requestable = useMemo(() => cells.filter((cell) => cell.canRequest), [cells]);
  const [role, setRole] = useState<CharacterRole>(requestable[0]?.role ?? "DPS");
  const [difficulty, setDifficulty] = useState<RaidDifficulty>(requestable[0]?.difficulty ?? "HEROIC");

  const roles = [...new Set(requestable.map((cell) => cell.role))];
  const difficultiesForRole = requestable
    .filter((cell) => cell.role === role)
    .map((cell) => cell.difficulty);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setOpen(false);
      setError(null);
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
      const result = await requestBoosterAccessAction({ characterId, role, difficulty });
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
      <Button
        type="button"
        disabled={disabled || requestable.length === 0}
        onClick={() => {
          const first = requestable[0];
          if (first) {
            setRole(first.role);
            setDifficulty(first.difficulty);
          }
          setOpen(true);
        }}
      >
        Request Access
      </Button>
      {disabled && disabledReason ? <p className="mt-2 text-xs text-muted">{disabledReason}</p> : null}
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
            Request booster access
          </h2>
          <p className="text-xs text-muted">
            Class is taken from this character. Each difficulty is approved separately.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Role</span>
            <select
              aria-label="Requested role"
              value={role}
              onChange={(event) => {
                const nextRole = event.target.value as CharacterRole;
                setRole(nextRole);
                const nextDifficulties = requestable
                  .filter((cell) => cell.role === nextRole)
                  .map((cell) => cell.difficulty);
                if (!nextDifficulties.includes(difficulty) && nextDifficulties[0]) {
                  setDifficulty(nextDifficulties[0]);
                }
              }}
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
            >
              {roles.map((option) => (
                <option key={option} value={option}>
                  {CHARACTER_ROLE_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Difficulty</span>
            <select
              aria-label="Requested difficulty"
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value as RaidDifficulty)}
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
            >
              {difficultiesForRole.map((option) => (
                <option key={option} value={option}>
                  {DIFFICULTY_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          {error ? (
            <p id={errorId} role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || requestable.length === 0}>
              {pending ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
