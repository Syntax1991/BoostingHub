"use client";

import { useId, useRef, useState, useTransition, type Ref } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  adminForceRefreshCharacterAction,
  adminSyncCharacterAction,
} from "@/controllers/character-operations.actions";
import { cn } from "@/lib/cn";

/**
 * Admin "Sync now" (normal cooldown applies) and "Force refresh" (confirmed;
 * bypasses the 60s cooldown only). Disabled states mirror server eligibility;
 * the server enforces everything again.
 */
export function CharacterSyncButtons({
  characterId,
  characterLabel,
  ineligibleCopy,
  cooldownRemainingMs,
  compact = false,
  showSync = true,
  showForceRefresh = true,
  /** When set, Force refresh trigger can be hosted off-screen for overflow menus. */
  forceButtonRef,
  forceButtonClassName,
}: {
  characterId: string;
  characterLabel: string;
  /** Null when eligible; otherwise the reason copy shown and used as tooltip. */
  ineligibleCopy: string | null;
  cooldownRemainingMs: number;
  compact?: boolean;
  showSync?: boolean;
  showForceRefresh?: boolean;
  forceButtonRef?: Ref<HTMLButtonElement>;
  forceButtonClassName?: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const inCooldown = cooldownRemainingMs > 0;
  const syncDisabledReason =
    ineligibleCopy ?? (inCooldown ? `Normal sync available in ${Math.ceil(cooldownRemainingMs / 1000)}s.` : null);

  function run(force: boolean) {
    setMessage(null);
    startTransition(async () => {
      const action = force ? adminForceRefreshCharacterAction : adminSyncCharacterAction;
      const result = await action({ characterId });
      setMessage({ ok: result.ok, text: result.message });
      dialogRef.current?.close();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className={compact ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-2"}>
        {showSync ? (
          <span title={syncDisabledReason ?? undefined}>
            <Button
              variant="secondary"
              className={compact ? "h-7 px-2 text-xs" : undefined}
              disabled={pending || Boolean(syncDisabledReason)}
              onClick={() => run(false)}
            >
              {pending ? "Syncing…" : "Sync now"}
            </Button>
          </span>
        ) : null}
        {showForceRefresh ? (
          <span title={ineligibleCopy ?? "Bypasses the 60s cooldown. Requires confirmation."}>
            <button
              ref={forceButtonRef}
              type="button"
              disabled={pending || Boolean(ineligibleCopy)}
              onClick={() => dialogRef.current?.showModal()}
              className={cn(
                "inline-flex items-center justify-center rounded-md font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                compact ? "h-7 px-2 text-xs" : "h-9 px-3 text-sm",
                forceButtonClassName,
              )}
            >
              Force refresh
            </button>
          </span>
        ) : null}
      </div>
      {!compact && showSync && syncDisabledReason ? <p className="text-xs text-muted">{syncDisabledReason}</p> : null}
      {message ? (
        <p role="status" className={message.ok ? "text-xs text-success" : "text-xs text-danger"}>
          {message.text}
        </p>
      ) : null}
      {showForceRefresh ? (
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          className="w-[min(28rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
        >
          <div className="flex flex-col gap-3 p-4">
            <h2 id={titleId} className="text-sm font-semibold">
              Force refresh {characterLabel}?
            </h2>
            <p className="text-xs text-muted">
              Runs a Blizzard sync now, bypassing the normal 60-second cooldown. Eligibility, identity checks and
              rate-limit handling still apply.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={pending} onClick={() => dialogRef.current?.close()}>
                Cancel
              </Button>
              <Button disabled={pending} onClick={() => run(true)}>
                {pending ? "Refreshing…" : "Force refresh"}
              </Button>
            </div>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
