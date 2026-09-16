"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { linkMissingWarcraftLogsCharactersAction } from "@/controllers/warcraft-logs.actions";

/**
 * Page-level owner action: discover WCL for all active owned Characters missing an ID.
 * Does not accept Character IDs from the client — ownership is resolved server-side.
 */
export function FindMissingWarcraftLogsButton() {
  const router = useRouter();
  const messageId = useId();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function run() {
    setMessage(null);
    setIsError(false);
    startTransition(async () => {
      const result = await linkMissingWarcraftLogsCharactersAction();
      if (!result.ok) {
        setIsError(true);
        setMessage(result.message);
        return;
      }
      setIsError(false);
      setMessage(result.message);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={run}
        className="h-8 px-2 text-xs"
        aria-describedby={message ? messageId : undefined}
      >
        {pending ? "Finding Warcraft Logs…" : "Find missing Warcraft Logs"}
      </Button>
      {message ? (
        <span
          id={messageId}
          role={isError ? "alert" : "status"}
          className={`max-w-72 text-xs ${isError ? "text-danger" : "text-muted"}`}
        >
          {message}
        </span>
      ) : null}
    </span>
  );
}
