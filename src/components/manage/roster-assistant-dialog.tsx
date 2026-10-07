"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { getRosterAssistantAction } from "@/controllers/roster.actions";
import { formatDateTime } from "@/lib/datetime";
import { formatMissingCounts } from "@/lib/run-staffing";
import {
  CHARACTER_ROLE_LABELS,
  CLASS_LABELS,
  DIFFICULTY_LABELS,
  RUN_LOOT_TYPE_LABELS,
} from "@/lib/labels";
import type { RosterAssistantResult } from "@/services/roster-assistant.service";

function CandidateLine({
  name,
  realm,
  wowClass,
  concreteRole,
  itemLevel,
  lockoutAttention,
}: {
  name: string;
  realm: string;
  wowClass: string;
  concreteRole?: string;
  itemLevel: number | null;
  lockoutAttention?: boolean;
}) {
  const parts = [
    name,
    realm,
    CLASS_LABELS[wowClass as keyof typeof CLASS_LABELS] ?? wowClass,
    concreteRole
      ? (CHARACTER_ROLE_LABELS[concreteRole as keyof typeof CHARACTER_ROLE_LABELS] ?? concreteRole)
      : null,
    itemLevel != null ? String(itemLevel) : null,
  ].filter(Boolean);
  return (
    <li className="text-sm">
      {parts.join(" · ")}
      {lockoutAttention ? (
        <span className="ml-2 text-[10px] uppercase tracking-wide text-warning">Lockout</span>
      ) : null}
    </li>
  );
}

/**
 * Read-only Roster Assistant. Loads candidates on open; never mutates roster.
 */
export function RosterAssistantDialog({
  runId,
  onClose,
}: {
  runId: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RosterAssistantResult | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onDialogClose = () => onClose();
    dialog.addEventListener("close", onDialogClose);
    return () => dialog.removeEventListener("close", onDialogClose);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      const result = await getRosterAssistantAction({ runId });
      if (cancelled) return;
      if (!result.ok || !result.data) {
        setError(result.message);
        setData(null);
        return;
      }
      setError(null);
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const missing = data ? formatMissingCounts(data.shortages) : "";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(36rem,calc(100vw-2rem))] max-h-[min(40rem,calc(100vh-2rem))] overflow-y-auto rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-base font-semibold">
          Roster Assistant
        </h2>
        {data ? (
          <p className="mt-1 text-xs text-muted">
            {data.run.productLabel} · {DIFFICULTY_LABELS[data.run.difficulty]}{" "}
            {RUN_LOOT_TYPE_LABELS[data.run.lootType]} · {formatDateTime(data.run.scheduledStartAt)}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">Deterministic eligible candidates for staffing shortages.</p>
        )}
      </div>

      <div className="space-y-4 px-4 py-4">
        {pending && !data ? <p className="text-sm text-muted">Loading candidates…</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {data?.fullyStaffed ? (
          <p className="text-sm font-medium text-success">No staffing shortages.</p>
        ) : null}

        {data && !data.fullyStaffed ? (
          <>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Needed</p>
              <p className="mt-1 text-sm">{missing || "—"}</p>
            </div>

            {data.shortages.healers > 0 ? (
              <section>
                <h3 className="text-sm font-semibold">
                  Healers · {data.candidates.healers.length}
                </h3>
                {data.candidates.healers.length === 0 ? (
                  <p className="mt-1 text-xs text-muted">No eligible healer candidates.</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {data.candidates.healers.map((row) => (
                      <CandidateLine
                        key={row.characterId}
                        name={row.characterName}
                        realm={row.realm}
                        wowClass={row.wowClass}
                        concreteRole={row.concreteRole}
                        itemLevel={row.itemLevel}
                        lockoutAttention={row.lockoutAttention}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            {data.shortages.tanks > 0 ? (
              <section>
                <h3 className="text-sm font-semibold">Tanks · {data.candidates.tanks.length}</h3>
                {data.candidates.tanks.length === 0 ? (
                  <p className="mt-1 text-xs text-muted">No eligible tank candidates.</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {data.candidates.tanks.map((row) => (
                      <CandidateLine
                        key={row.characterId}
                        name={row.characterName}
                        realm={row.realm}
                        wowClass={row.wowClass}
                        concreteRole={row.concreteRole}
                        itemLevel={row.itemLevel}
                        lockoutAttention={row.lockoutAttention}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            {data.shortages.dps > 0 ? (
              <section>
                <h3 className="text-sm font-semibold">DPS · {data.candidates.dps.length}</h3>
                <p className="mt-0.5 text-[11px] text-muted">
                  Aggregate DPS need — Melee and Ranged are both eligible (no quotas).
                </p>
                {data.candidates.dps.length === 0 ? (
                  <p className="mt-1 text-xs text-muted">No eligible DPS candidates.</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {data.candidates.dps.map((row) => (
                      <CandidateLine
                        key={row.characterId}
                        name={row.characterName}
                        realm={row.realm}
                        wowClass={row.wowClass}
                        concreteRole={row.concreteRole}
                        itemLevel={row.itemLevel}
                        lockoutAttention={row.lockoutAttention}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            {data.shortages.lootbuddies > 0 ? (
              <section>
                <h3 className="text-sm font-semibold">
                  Lootbuddies · {data.candidates.lootbuddies.length}
                </h3>
                {data.candidates.lootbuddies.length === 0 ? (
                  <p className="mt-1 text-xs text-muted">
                    No unselected Lootbuddy signups on this Run.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {data.candidates.lootbuddies.map((row) => (
                      <li key={row.signupId} className="text-sm">
                        {row.userName}
                        {row.lootbuddyClass
                          ? ` · ${CLASS_LABELS[row.lootbuddyClass] ?? row.lootbuddyClass}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="flex justify-end border-t border-border px-4 py-3">
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-surface-raised"
          onClick={() => dialogRef.current?.close()}
        >
          Close
        </button>
      </div>
    </dialog>
  );
}

export function RosterAssistantTrigger({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 items-center rounded-md border border-border bg-surface-raised px-2 text-xs font-medium hover:bg-[#222a3b]"
      >
        Roster Assistant
      </button>
      {open ? <RosterAssistantDialog runId={runId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
