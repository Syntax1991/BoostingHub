"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteCharacterAction } from "@/controllers/character.actions";
import { adminDeleteCharacterAction } from "@/controllers/character-operations.actions";

/**
 * Confirmed hard delete of a Character — by its owner ("owner") or from
 * Character Operations ("admin"). The server enforces ownership / admin
 * rights and refuses while an unfinished Run still has a signup on it.
 */
export function DeleteCharacterButton({
  characterId,
  characterLabel,
  mode,
  redirectTo,
  compact = false,
}: {
  characterId: string;
  characterLabel: string;
  mode: "owner" | "admin";
  /** Detail pages leave the deleted Character's page; lists just refresh in place. */
  redirectTo?: string;
  /** Row-action size used in the management lists. */
  compact?: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const action = mode === "admin" ? adminDeleteCharacterAction : deleteCharacterAction;
      const result = await action({ characterId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      dialogRef.current?.close();
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          dialogRef.current?.showModal();
        }}
        className={`${compact ? "h-7" : "h-8"} rounded-md border border-danger/40 px-2 text-xs text-danger hover:bg-danger/10`}
      >
        Delete
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={error ? errorId : undefined}
        className="w-[min(28rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
      >
        <div className="flex flex-col gap-3 p-4">
          <h2 id={titleId} className="text-sm font-semibold">
            Delete {characterLabel} permanently?
          </h2>
          <div className="space-y-1 text-xs text-muted">
            <p>This permanently removes the Character from BoostingHub, with its lockouts and availability.</p>
            <p>Historical completed-run records and payout history are preserved.</p>
            <p>Characters with active run signups cannot be deleted. To keep it, use Deactivate instead.</p>
          </div>
          {error ? (
            <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button variant="danger" disabled={pending} onClick={run}>
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
