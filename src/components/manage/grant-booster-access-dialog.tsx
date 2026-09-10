"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { grantBoosterAccessAction } from "@/controllers/booster-access.actions";
import { Button } from "@/components/ui/button";
import {
  CHARACTER_ROLE_LABELS,
  CLASS_LABELS,
  DIFFICULTY_LABELS,
} from "@/lib/labels";
import {
  CHARACTER_ROLES,
  RAID_DIFFICULTIES,
  WOW_CLASSES,
  type CharacterRole,
  type RaidDifficulty,
  type WowClass,
} from "@/models/enums";
import { BOOSTER_ACCESS_REVIEW_REASON_MAX } from "@/validators/booster-access";

type GrantUser = {
  id: string;
  name: string;
  discordUsername: string | null;
};

export function GrantBoosterAccessDialog({
  users,
  defaultUserId,
}: {
  users: GrantUser[];
  defaultUserId?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const notesId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initialUserId =
    defaultUserId && users.some((user) => user.id === defaultUserId)
      ? defaultUserId
      : (users[0]?.id ?? "");
  const [userId, setUserId] = useState(initialUserId);
  const [wowClass, setWowClass] = useState<WowClass>("WARRIOR");
  const [role, setRole] = useState<CharacterRole>("DPS");
  const [difficulty, setDifficulty] = useState<RaidDifficulty>("HEROIC");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setOpen(false);
      setError(null);
      setNotes("");
      setUserId(initialUserId);
      setWowClass("WARRIOR");
      setRole("DPS");
      setDifficulty("HEROIC");
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [open, initialUserId]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await grantBoosterAccessAction({
        userId,
        wowClass,
        role,
        difficulty,
        notes: notes.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      close();
      router.refresh();
    });
  }

  if (users.length === 0) {
    return null;
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Grant access
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
            Grant booster access
          </h2>
          <p className="text-xs text-muted">
            Approves eligibility for the selected class, role, and difficulty on the account.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">User</span>
            <select
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              aria-label="User"
              required
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                  {user.discordUsername ? ` (@${user.discordUsername})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Class</span>
            <select
              value={wowClass}
              onChange={(event) => setWowClass(event.target.value as WowClass)}
              aria-label="Class"
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
            >
              {WOW_CLASSES.map((option) => (
                <option key={option} value={option}>
                  {CLASS_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Role</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as CharacterRole)}
                aria-label="Role"
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              >
                {CHARACTER_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {CHARACTER_ROLE_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Difficulty</span>
              <select
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value as RaidDifficulty)}
                aria-label="Difficulty"
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              >
                {RAID_DIFFICULTIES.map((option) => (
                  <option key={option} value={option}>
                    {DIFFICULTY_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Notes (optional)</span>
            <textarea
              id={notesId}
              value={notes}
              maxLength={BOOSTER_ACCESS_REVIEW_REASON_MAX}
              onChange={(event) => setNotes(event.target.value)}
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
            <Button type="submit" disabled={pending || !userId}>
              {pending ? "Saving…" : "Grant access"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
