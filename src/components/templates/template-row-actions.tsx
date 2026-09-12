"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deactivateRunTemplateAction, reactivateRunTemplateAction } from "@/controllers/run-template.actions";
import { Button } from "@/components/ui/button";

export function TemplateRowActions({ templateId, isActive }: { templateId: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: (input: unknown) => Promise<{ ok: boolean; message: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action({ templateId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {isActive ? (
        <Button variant="secondary" disabled={pending} onClick={() => run(deactivateRunTemplateAction)}>
          {pending ? "Working…" : "Deactivate"}
        </Button>
      ) : (
        <Button variant="secondary" disabled={pending} onClick={() => run(reactivateRunTemplateAction)}>
          {pending ? "Working…" : "Reactivate"}
        </Button>
      )}
      {error ? <p role="alert" className="max-w-[16rem] text-right text-xs text-danger">{error}</p> : null}
    </div>
  );
}
