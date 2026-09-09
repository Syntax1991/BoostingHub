"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveBoosterAccessAction } from "@/controllers/booster-access.actions";
import { Button } from "@/components/ui/button";

export function ApproveBoosterAccessButton({ accessId }: { accessId: string }) {
  const router = useRouter();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await approveBoosterAccessAction({ accessId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" disabled={pending} onClick={run}>
        {pending ? "Approving…" : "Approve"}
      </Button>
      {error ? (
        <span id={errorId} role="alert" className="max-w-40 text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
