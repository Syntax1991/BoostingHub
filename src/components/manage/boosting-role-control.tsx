"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBoostingRoleAction } from "@/controllers/boosting-role.actions";
import { Button } from "@/components/ui/button";
import type { BoostingRole } from "@/models/enums";
import { BOOSTING_ROLE_REASON_MAX } from "@/validators/boosting-roles";

const ROLE_LABEL: Record<BoostingRole, string> = { BOOSTER: "Booster", LOOTBUDDY: "Lootbuddy" };

const EFFECT_COPY: Record<BoostingRole, { grant: string; revoke: string }> = {
  BOOSTER: {
    grant: "They can sign up and be rostered as a Booster on Normal, Heroic and Mythic runs (other signup rules still apply).",
    revoke: "They can no longer sign up or be selected as a Booster. Existing signups and roster history stay.",
  },
  LOOTBUDDY: {
    grant: "Marks them as a recognised Lootbuddy. Lootbuddy signups are not gated by this role.",
    revoke: "Removes the Lootbuddy role. Lootbuddy signups are not gated by this role.",
  },
};

/**
 * Grant / revoke one Boosting Role on a User (ADMIN / OWNER). Independent of
 * the account role and of the other Boosting Role.
 */
export function BoostingRoleControl({
  userId,
  userName,
  role,
  enabled,
}: {
  userId: string;
  userName: string;
  role: BoostingRole;
  enabled: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const label = ROLE_LABEL[role];
  const nextEnabled = !enabled;

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
      const result = await setBoostingRoleAction({
        userId,
        role,
        enabled: nextEnabled,
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

  const actionLabel = nextEnabled ? `Grant ${label}` : `Revoke ${label}`;

  return (
    <>
      <Button
        type="button"
        variant={nextEnabled ? "primary" : "secondary"}
        onClick={() => setOpen(true)}
        aria-label={`${actionLabel} for ${userName}`}
      >
        {nextEnabled ? "Grant" : "Revoke"}
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
            {actionLabel} — {userName}
          </h2>
          <p className="text-xs text-muted">
            {nextEnabled ? EFFECT_COPY[role].grant : EFFECT_COPY[role].revoke} The account role is not changed.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Reason (optional, recorded in the audit log)</span>
            <textarea
              aria-label="Reason"
              value={reason}
              maxLength={BOOSTING_ROLE_REASON_MAX}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
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
              {pending ? "Saving…" : actionLabel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
