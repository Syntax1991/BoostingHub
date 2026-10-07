"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { hasOwnerAccess } from "@/auth/authorization";
import { changeAccountRoleAction } from "@/controllers/user-management.actions";
import { setBoostingRoleAction } from "@/controllers/boosting-role.actions";
import { Button } from "@/components/ui/button";
import { OfferedRolesBadges } from "@/components/ui/badges";
import { ROLE_LABELS } from "@/lib/labels";
import type { ConcreteCharacterRole } from "@/lib/character-roles";
import { MANAGEABLE_ACCOUNT_ROLES, type AccountRole } from "@/models/enums";

/**
 * Compact Access dialog for /manage/users — reuses #214 server actions.
 * Platform role + Booster grant/revoke; Character roles are read-only.
 */
export function UserAccessDialog({
  userId,
  userName,
  accountRole,
  isBooster,
  characterRoles,
}: {
  userId: string;
  userName: string;
  accountRole: AccountRole;
  isBooster: boolean;
  characterRoles: readonly ConcreteCharacterRole[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ownerProtected = hasOwnerAccess(accountRole);
  const [nextRole, setNextRole] = useState<AccountRole>(accountRole);
  const [nextBooster, setNextBooster] = useState(isBooster);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setOpen(false);
      setError(null);
      setNextRole(accountRole);
      setNextBooster(isBooster);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [open, accountRole, isBooster]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
  }

  function submit() {
    setError(null);
    const roleChanged = !ownerProtected && nextRole !== accountRole;
    const boosterChanged = nextBooster !== isBooster;
    if (!roleChanged && !boosterChanged) {
      close();
      return;
    }

    startTransition(async () => {
      if (roleChanged) {
        const roleResult = await changeAccountRoleAction({
          targetUserId: userId,
          nextRole,
        });
        if (!roleResult.ok) {
          setError(roleResult.message);
          return;
        }
      }
      if (boosterChanged) {
        const boosterResult = await setBoostingRoleAction({
          userId,
          role: "BOOSTER",
          enabled: nextBooster,
        });
        if (!boosterResult.ok) {
          setError(boosterResult.message);
          return;
        }
      }
      close();
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-label={`Manage access for ${userName}`}
        className="h-8 px-2.5 text-xs"
      >
        Access
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
          <div>
            <h2 id={titleId} className="text-sm font-semibold">
              Manage Access
            </h2>
            <p className="mt-0.5 text-xs text-muted">{userName}</p>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Platform Role</span>
            {ownerProtected ? (
              <p className="text-sm">
                {ROLE_LABELS[accountRole]}
                <span className="ml-2 text-xs text-muted">Protected</span>
              </p>
            ) : (
              <select
                value={nextRole}
                onChange={(event) => setNextRole(event.target.value as AccountRole)}
                aria-label="Platform role"
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              >
                {MANAGEABLE_ACCOUNT_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                    {role === accountRole ? " (current)" : ""}
                  </option>
                ))}
              </select>
            )}
          </label>

          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">Boosting Access</span>
            <span className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={nextBooster}
                onChange={(event) => setNextBooster(event.target.checked)}
                aria-label="Booster access enabled"
                className="h-4 w-4 rounded border-border"
              />
              <span>{nextBooster ? "Enabled" : "Disabled"}</span>
            </span>
          </label>

          <div className="text-sm">
            <p className="mb-1 text-muted">Boosting Roles</p>
            {characterRoles.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                <OfferedRolesBadges roles={characterRoles} />
              </div>
            ) : (
              <p className="text-xs text-muted">—</p>
            )}
            <p className="mt-1 text-[11px] text-muted">
              Read-only from active Characters. Independent of Booster access.
            </p>
          </div>

          {error ? (
            <p id={errorId} role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
