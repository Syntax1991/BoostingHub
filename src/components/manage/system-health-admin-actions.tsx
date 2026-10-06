"use client";

import { useState, useTransition } from "react";
import {
  adminSystemForceRefreshAllAction,
  adminSystemWclAutoAuditPassAction,
} from "@/controllers/system-health.actions";

type ActionState = { kind: "idle" } | { kind: "ok"; message: string } | { kind: "err"; message: string };

export function SystemHealthAdminActions() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>({ kind: "idle" });

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      setState(result.ok ? { kind: "ok", message: result.message } : { kind: "err", message: result.message });
    });
  }

  return (
    <section aria-labelledby="admin-ops-heading" className="mb-8">
      <h2 id="admin-ops-heading" className="mb-2 text-sm font-semibold">
        Admin operations
      </h2>
      <p className="mb-3 text-xs text-muted">
        Safe actions that reuse existing domain services, cooldowns, and invariants. Discord sync-now is not
        exposed here — the bot has no web wake channel yet; Character troubleshooting stays on Character
        Operations.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Force refresh all eligible Characters now? Existing 10-minute bulk cooldown applies.")) {
              return;
            }
            run(adminSystemForceRefreshAllAction);
          }}
          className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-black hover:bg-[#d8b436] disabled:opacity-60"
        >
          Force eligible Character refresh
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(adminSystemWclAutoAuditPassAction)}
          className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm disabled:opacity-60"
        >
          Run WCL auto-audit pass
        </button>
      </div>
      {state.kind !== "idle" ? (
        <p
          role="status"
          className={`mt-3 text-sm ${state.kind === "ok" ? "text-emerald-700" : "text-red-700"}`}
        >
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
