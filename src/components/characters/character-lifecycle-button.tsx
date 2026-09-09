"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deactivateCharacterAction,
  reactivateCharacterAction,
} from "@/controllers/character.actions";

export function CharacterLifecycleButton({
  characterId,
  isActive,
}: {
  characterId: string;
  isActive: boolean;
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

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
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
