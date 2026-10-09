"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearWclMappingAction, retryWclDetectionAction } from "@/controllers/raid-catalog.actions";

/** Raid detail Integrations card: Warcraft Logs status + Retry / Clear (no raw ID editing). */
export function RaidWclIntegration({
  raidId,
  wclZoneId,
  wclRankingEncounterId,
}: {
  raidId: string;
  wclZoneId: number | null;
  wclRankingEncounterId: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connected = wclZoneId != null;

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">Warcraft Logs</h3>
        <span className={connected ? "text-success" : "text-muted"}>{connected ? "Connected" : "Not resolved"}</span>
      </div>
      {connected ? (
        <dl className="grid grid-cols-[9rem_1fr] gap-y-0.5 text-muted">
          <dt>Zone</dt>
          <dd className="font-mono text-xs text-foreground">{wclZoneId}</dd>
          <dt>Ranking encounter</dt>
          <dd className="font-mono text-xs text-foreground">{wclRankingEncounterId ?? "— (zone-wide)"}</dd>
        </dl>
      ) : (
        <p className="text-xs text-muted">
          No safe automatic match yet. Detection runs on create and when encounters change; you can retry anytime.
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => retryWclDetectionAction({ raidId }))}
          className="h-8 rounded-md border border-border px-2 text-xs hover:bg-surface-raised disabled:opacity-50"
        >
          Retry detection
        </button>
        {connected ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => clearWclMappingAction({ raidId }))}
            className="h-8 rounded-md px-2 text-xs text-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
          >
            Clear mapping
          </button>
        ) : null}
      </div>
      {message ? <p className="text-xs text-success">{message}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
