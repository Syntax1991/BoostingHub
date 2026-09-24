"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawPickedSignupAction, withdrawSignupAction } from "@/controllers/signup.actions";
import { Button } from "@/components/ui/button";
import { WITHDRAW_REASON_MAX_LENGTH, WITHDRAW_REASON_MIN_LENGTH } from "@/services/signup-state";

/**
 * Withdraws one signup. A picked signup (on the roster or its saved draft)
 * needs a reason for the Raid Lead: `requireReason` opens the reason form
 * straight away, and a plain withdraw the server answers with
 * WITHDRAW_REASON_REQUIRED switches to it too.
 */
export function WithdrawButton({ signupId, requireReason = false }: { signupId: string; requireReason?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [askReason, setAskReason] = useState(false);
  const [reason, setReason] = useState("");

  function withdrawPlain() {
    setError(null);
    startTransition(async () => {
      const result = await withdrawSignupAction({ signupId });
      if (!result.ok) {
        if (result.code === "WITHDRAW_REASON_REQUIRED") {
          setAskReason(true);
          return;
        }
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  function withdrawWithReason(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await withdrawPickedSignupAction({ signupId, reason });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  if (askReason) {
    const tooShort = reason.trim().length < WITHDRAW_REASON_MIN_LENGTH;
    return (
      <form onSubmit={withdrawWithReason} className="w-full max-w-sm space-y-2">
        <label className="block text-xs">
          <span className="mb-1 block text-muted">
            You are on the roster. Why are you withdrawing? The raid lead gets your reason.
          </span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={WITHDRAW_REASON_MAX_LENGTH}
            rows={3}
            required
            className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm"
          />
        </label>
        <div className="flex gap-2">
          <Button type="submit" className="h-8 px-2 text-xs" disabled={pending || tooShort}>
            {pending ? "Withdrawing…" : "Withdraw from roster"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-2 text-xs"
            disabled={pending}
            onClick={() => {
              setAskReason(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        className="h-8 px-2 text-xs"
        disabled={pending}
        onClick={() => (requireReason ? setAskReason(true) : withdrawPlain())}
      >
        {pending ? "Withdrawing…" : "Withdraw"}
      </Button>
      {error ? (
        <p role="alert" className="mt-1 max-w-[12rem] text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
