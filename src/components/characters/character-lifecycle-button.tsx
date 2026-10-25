"use client";

import { useId, useState, useTransition, type Ref } from "react";
import { useRouter } from "next/navigation";
import {
  deactivateCharacterAction,
  reactivateCharacterAction,
} from "@/controllers/character.actions";
import { cn } from "@/lib/cn";

export function CharacterLifecycleButton({
  characterId,
  isActive,
  variant = "button",
  buttonRef,
}: {
  characterId: string;
  isActive: boolean;
  /** `switch` = compact Active toggle for Characters table. */
  variant?: "button" | "switch";
  /** Optional ref to the action button — used when Deactivate is fired from an overflow menu host. */
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const router = useRouter();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const result = isActive
        ? await deactivateCharacterAction({ characterId })
        : await reactivateCharacterAction({ characterId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  if (variant === "switch") {
    return (
      <span className="relative inline-flex h-5 items-center">
        <button
          type="button"
          role="switch"
          aria-checked={isActive}
          disabled={pending}
          onClick={run}
          aria-label={isActive ? "Deactivate character" : "Activate character"}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            isActive ? "bg-accent" : "bg-border",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
              isActive ? "left-4" : "left-0.5",
            )}
          />
        </button>
        {error ? (
          <span
            id={errorId}
            role="alert"
            className="absolute left-1/2 top-full z-10 mt-0.5 w-max max-w-28 -translate-x-1/2 text-[10px] leading-tight text-danger"
          >
            {error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        ref={buttonRef}
        type="button"
        disabled={pending}
        onClick={run}
        aria-describedby={error ? errorId : undefined}
        className="h-8 rounded-md border border-border px-2 text-xs hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Saving…" : isActive ? "Deactivate" : "Reactivate"}
      </button>
      {error ? (
        <span id={errorId} role="alert" className="max-w-40 text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
