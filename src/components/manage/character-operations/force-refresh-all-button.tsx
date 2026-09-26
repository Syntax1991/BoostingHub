"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { adminForceRefreshAllAction } from "@/controllers/character-operations.actions";
import type { BulkForceRefreshResult } from "@/services/character-operations.service";

const SKIP_COPY: Record<keyof BulkForceRefreshResult["skippedByReason"], string> = {
  ALREADY_SYNCING: "already syncing",
  RATE_LIMITED: "stopped after Blizzard rate limit",
  TIME_BUDGET: "time budget reached",
};

/**
 * "Force refresh all": mandatory confirmation showing the eligible count
 * (resolved again server-side at execution), then a synchronous bounded run
 * and a final result panel. No client-supplied id list is ever sent.
 */
export function ForceRefreshAllButton({ eligibleCount }: { eligibleCount: number }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkForceRefreshResult | null>(null);

  function open() {
    setError(null);
    setResult(null);
    dialogRef.current?.showModal();
  }

  function run() {
    setError(null);
    startTransition(async () => {
      const response = await adminForceRefreshAllAction();
      if (!response.ok) {
        setError(response.message);
        return;
      }
      setResult(response.result);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="secondary" disabled={eligibleCount === 0} onClick={open}>
        Force refresh all
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="w-[min(34rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
      >
        <div className="flex max-h-[80vh] flex-col gap-3 overflow-y-auto p-4">
          <h2 id={titleId} className="text-sm font-semibold">
            {result ? "Force refresh all — result" : "Force refresh all characters?"}
          </h2>
          {result ? (
            <>
              <dl className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-5">
                {(
                  [
                    ["Eligible", result.eligible],
                    ["Attempted", result.attempted],
                    ["Succeeded", result.succeeded],
                    ["Failed", result.failed],
                    ["Skipped", result.skipped],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-md border border-border px-2 py-1.5">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              {result.failures.length > 0 ? (
                <div>
                  <h3 className="mb-1 text-xs font-semibold text-danger">Failed</h3>
                  <ul className="space-y-0.5 text-xs">
                    {result.failures.map((failure) => (
                      <li key={failure.characterId}>
                        {failure.label} — <span className="text-muted">{failure.errorLabel}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {result.skippedCharacters.length > 0 ? (
                <div>
                  <h3 className="mb-1 text-xs font-semibold text-warning">Skipped</h3>
                  <ul className="space-y-0.5 text-xs">
                    {result.skippedCharacters.map((skip) => (
                      <li key={skip.characterId}>
                        {skip.label} — <span className="text-muted">{SKIP_COPY[skip.reason]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-xs text-muted">Finished in {Math.round(result.durationMs / 1000)}s.</p>
            </>
          ) : (
            <>
              <p className="text-sm">
                <span className="font-semibold tabular-nums">{eligibleCount}</span> eligible characters will be synced
                from Blizzard now.
              </p>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
                <li>This bypasses the normal freshness rules for every eligible character.</li>
                <li>It can generate significant Blizzard API traffic (4 at a time, stops on rate limits).</li>
                <li>
                  Only active characters linked to Battle.net whose owner has a connection for that region run — retired,
                  not-linked and no-connection characters are skipped.
                </li>
                <li>Can run at most once every 10 minutes and never alongside the scheduled sync.</li>
              </ul>
            </>
          )}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={() => dialogRef.current?.close()}>
              {result ? "Close" : "Cancel"}
            </Button>
            {result ? null : (
              <Button disabled={pending} onClick={run}>
                {pending ? "Refreshing… (up to ~2 min)" : "Force refresh all"}
              </Button>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
