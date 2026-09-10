"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeAccountRoleAction } from "@/controllers/user-management.actions";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/labels";
import { ACCOUNT_ROLES, type AccountRole } from "@/models/enums";

export function ChangeAccountRoleDialog({
  userId,
  userName,
  currentRole,
}: {
  userId: string;
  userName: string;
  currentRole: AccountRole;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nextRole, setNextRole] = useState<AccountRole>(
    ACCOUNT_ROLES.find((role) => role !== currentRole) ?? currentRole,
  );

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setOpen(false);
      setConfirming(false);
      setError(null);
      setNextRole(ACCOUNT_ROLES.find((role) => role !== currentRole) ?? currentRole);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [open, currentRole]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
  }

  function submit() {
    if (!confirming) {
      if (nextRole === currentRole) {
        setError(`${userName} already has the ${ROLE_LABELS[currentRole]} role.`);
        return;
      }
      setError(null);
      setConfirming(true);
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await changeAccountRoleAction({
        targetUserId: userId,
        nextRole,
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
        Change role
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
            {confirming ? "Confirm role change" : "Change account role"}
          </h2>
          {confirming ? (
            <>
              <p className="text-sm">
                <span className="text-muted">{ROLE_LABELS[currentRole]}</span>
                <span className="mx-2 text-muted">→</span>
                <span className="font-medium text-accent">{ROLE_LABELS[nextRole]}</span>
              </p>
              <p className="text-xs text-muted">This changes platform permissions.</p>
            </>
          ) : (
            <>
              <p className="text-xs text-muted">
                Update {userName}&apos;s platform role. This is separate from booster eligibility.
              </p>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">New role</span>
                <select
                  value={nextRole}
                  onChange={(event) => setNextRole(event.target.value as AccountRole)}
                  aria-label="New account role"
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                >
                  {ACCOUNT_ROLES.map((role) => (
                    <option key={role} value={role} disabled={role === currentRole}>
                      {ROLE_LABELS[role]}
                      {role === currentRole ? " (current)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {error ? (
            <p id={errorId} role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            {confirming ? (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setConfirming(false);
                  setError(null);
                }}
              >
                Back
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : confirming ? "Confirm" : "Continue"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
