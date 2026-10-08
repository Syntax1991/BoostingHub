"use client";

import { useEffect, useId, useRef } from "react";
import {
  formatWarningContentProgress,
  type ConfirmedRosterWarning,
  type PendingRosterSelectionWarning,
  type RosterSelectionWarning,
  type RosterWarningAcknowledgement,
} from "@/services/roster-selection-risk";

/** One Character's warnings as shown in the confirmation dialog. */
export type RosterWarningDialogItem = {
  /** Stable React key (signupId, or characterId for Add Player). */
  key: string;
  /** e.g. "Synmist-Antonidas". */
  characterLabel: string;
  warnings: RosterSelectionWarning[];
};

export function warningDialogItemsFromPending(
  pending: readonly PendingRosterSelectionWarning[],
): RosterWarningDialogItem[] {
  const byKey = new Map<string, RosterWarningDialogItem>();
  for (const row of pending) {
    const key = row.signupId ?? row.characterId ?? row.characterLabel;
    const item = byKey.get(key) ?? { key, characterLabel: row.characterLabel, warnings: [] };
    item.warnings.push(row.warning);
    byKey.set(key, item);
  }
  return [...byKey.values()];
}

export function acknowledgementsFor(warnings: readonly RosterSelectionWarning[]): RosterWarningAcknowledgement[] {
  return warnings.map((warning) => ({ type: warning.type, fingerprint: warning.fingerprint }));
}

export function confirmedWarningsFor(
  signupId: string,
  warnings: readonly RosterSelectionWarning[],
): ConfirmedRosterWarning[] {
  return acknowledgementsFor(warnings).map((ack) => ({ ...ack, signupId }));
}

/**
 * Explicit confirmation for roster selections with a WARNING risk (saved /
 * fully-saved lockout progress). One dialog for one or many Characters; each
 * affected RunRaidContent is listed on its own line — a Bundle is never
 * summed into one number. Hard conflicts never reach this dialog.
 * Confirming only collects the acknowledgement; the server re-validates it.
 */
export function RosterWarningConfirmDialog({
  title,
  intro,
  items,
  confirmLabel,
  pending = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  intro?: string;
  items: RosterWarningDialogItem[];
  confirmLabel: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const showCharacterLabels = items.length > 1;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // Escape / backdrop dismissal counts as Cancel — never as confirmation.
    const onDialogCancel = (event: Event) => {
      event.preventDefault();
      onCancel();
    };
    dialog.addEventListener("cancel", onDialogCancel);
    return () => dialog.removeEventListener("cancel", onDialogCancel);
  }, [onCancel]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(28rem,calc(100vw-2rem))] max-h-[min(36rem,calc(100vh-2rem))] overflow-y-auto rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        {intro ? <p className="mt-1 text-sm text-muted">{intro}</p> : null}
      </div>

      <ul className="space-y-3 px-4 py-4">
        {items.map((item) => (
          <li key={item.key}>
            {showCharacterLabels ? (
              <p className="text-sm font-medium">
                {item.characterLabel}{" "}
                <span className="text-[10px] uppercase tracking-wide text-warning">Saved</span>
              </p>
            ) : null}
            <ul className={showCharacterLabels ? "mt-1 space-y-1" : "space-y-2"}>
              {item.warnings.flatMap((warning) =>
                warning.contents.map((content) => (
                  <li key={`${warning.type}:${content.raidId}`} className="text-sm">
                    <span className="font-medium">{content.raidName}</span>
                    <span className="text-warning"> · {formatWarningContentProgress(content)}</span>
                  </li>
                )),
              )}
            </ul>
          </li>
        ))}
      </ul>

      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-surface-raised"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-black hover:bg-[#d8b436] disabled:opacity-50"
          disabled={pending}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
