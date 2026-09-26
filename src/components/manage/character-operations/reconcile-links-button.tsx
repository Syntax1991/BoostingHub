"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { adminReconcileBattleNetLinksAction } from "@/controllers/character-operations.actions";
import type { ReconcileLinksResult } from "@/services/character-operations.service";

/**
 * "Link Battle.net matches": confirmed admin backfill that links existing
 * manual Characters to their owners' already-connected Battle.net accounts
 * (exact matches only, verified live). Never imports or unlinks anything.
 */
export function ReconcileLinksButton() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReconcileLinksResult | null>(null);

  function open() {
    setError(null);
    setResult(null);
    dialogRef.current?.showModal();
  }

  function run() {
    setError(null);
    startTransition(async () => {
      const response = await adminReconcileBattleNetLinksAction();
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
      <Button variant="secondary" onClick={open}>
        Link Battle.net matches
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="w-[min(34rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
      >
        <div className="flex max-h-[80vh] flex-col gap-3 overflow-y-auto p-4">
          <h2 id={titleId} className="text-sm font-semibold">
            {result ? "Link Battle.net matches — result" : "Link existing characters to Battle.net?"}
          </h2>
          {result ? (
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {(
                [
                  ["Connections", result.connections],
                  ["Linked", result.linked],
                  ["Already linked", result.alreadyLinked],
                  ["Skipped", result.skipped],
                  ["Failed", result.failed],
                  ["No roster", result.noSnapshot],
                  ["Errors", result.connectionErrors],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-md border border-border px-2 py-1.5">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
              <li>
                For every connected Battle.net account, links the owner&apos;s existing manual characters that exactly
                match its roster (same name, realm, region and class; level 90+).
              </li>
              <li>Each match is re-verified against the public Blizzard profile before linking.</li>
              <li>Nothing is imported, unlinked or duplicated. Safe to run again.</li>
              <li>&quot;No roster&quot; accounts need one Battle.net Import by their owner.</li>
            </ul>
          )}
          {error ? (
            <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={() => dialogRef.current?.close()}>
              {result ? "Close" : "Cancel"}
            </Button>
            {result ? null : (
              <Button disabled={pending} onClick={run}>
                {pending ? "Linking…" : "Link matches"}
              </Button>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
