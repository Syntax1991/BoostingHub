"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawSignupAction } from "@/controllers/signup.actions";
import { Button } from "@/components/ui/button";

export function WithdrawButton({ signupId }: { signupId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        className="h-8 px-2 text-xs"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await withdrawSignupAction({ signupId });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            router.refresh();
          });
        }}
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
