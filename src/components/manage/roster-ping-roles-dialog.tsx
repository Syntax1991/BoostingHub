"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  getPingRolesDialogDataAction,
  requestCustomPingAction,
  requestLateFillHelpAction,
} from "@/controllers/roster.actions";
import {
  CUSTOM_PING_TEXT_MAX,
  customPingTextError,
  normalizeCustomPingText,
  PING_DELIVERY_LABELS,
  type PingRoleKey,
} from "@/lib/late-fill-help";
import type { PingPreviewLine, PingRolesDialogData } from "@/services/late-fill-help.service";

type PingMode = "automatic" | "custom";

const TEAM_ROLE_KEYS: readonly PingRoleKey[] = ["TANK", "HEALER", "DPS", "LOOTBUDDY"];

/** What Discord will show: the text in bold, mentions after it. */
function PingPreview({ lines }: { lines: PingPreviewLine[] }) {
  return (
    <div className="rounded-md border border-border bg-surface-raised/40 px-3 py-2 text-sm">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Discord preview</p>
      {lines.map((line) => (
        <p key={line.text} className="break-words">
          <strong className="font-semibold">{line.text}</strong>
          {line.mentions.map((mention) => (
            <span key={mention} className="ml-1 inline-block whitespace-nowrap rounded bg-accent/15 px-1 font-medium text-accent">
              @{mention}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

function RoleChoices({
  title,
  roles,
  selected,
  disabled,
  onToggle,
}: {
  title: string;
  roles: NonNullable<PingRolesDialogData["roles"]>;
  selected: ReadonlySet<PingRoleKey>;
  disabled: boolean;
  onToggle: (key: PingRoleKey) => void;
}) {
  if (roles.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs text-muted">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {roles.map((role) => (
          <button
            key={role.key}
            type="button"
            aria-pressed={selected.has(role.key)}
            disabled={disabled}
            onClick={() => onToggle(role.key)}
            className={`rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50 ${
              selected.has(role.key)
                ? "border-accent bg-accent/15 text-foreground"
                : "border-border text-muted hover:border-accent/60 hover:text-foreground"
            }`}
          >
            {role.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Ping roles: one message in the Run channel, sent by the bot. Automatic asks
 * for what the saved roster misses; Custom sends the Raid Lead's own text to the
 * roles they choose, even on a full roster. Opening and previewing write nothing.
 */
export function RosterPingRolesDialog({
  runId,
  onSent,
  onClose,
}: {
  runId: string;
  onSent: (message: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const textId = useId();
  const [data, setData] = useState<PingRolesDialogData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [chosenMode, setChosenMode] = useState<PingMode | null>(null);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<PingRoleKey>>(new Set());
  const [sending, startSending] = useTransition();

  useEffect(() => {
    dialogRef.current?.showModal();
    let current = true;
    void getPingRolesDialogDataAction({ runId }).then((result) => {
      if (!current) return;
      if (result.ok) setData(result.data);
      else setLoadError(result.message);
    });
    return () => {
      current = false;
    };
  }, [runId]);

  // Nothing to ask for automatically: start where the Raid Lead can act.
  const mode: PingMode = chosenMode ?? (data && data.automatic.lines.length === 0 ? "custom" : "automatic");
  const roles = data?.roles ?? null;
  const normalizedText = normalizeCustomPingText(text);
  const textError = normalizedText ? customPingTextError(text) : null;
  const customReady = !customPingTextError(text) && selected.size > 0;
  const customLines: PingPreviewLine[] = customReady
    ? [{ text: normalizedText, mentions: (roles ?? []).filter((role) => selected.has(role.key)).map((role) => role.label) }]
    : [];
  const canSend = !sending && data != null && (mode === "automatic" ? data.automatic.lines.length > 0 : customReady);

  function toggleRole(key: PingRoleKey) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  function send() {
    if (!canSend) return;
    setSendError(null);
    startSending(async () => {
      const result =
        mode === "automatic"
          ? await requestLateFillHelpAction({ runId })
          : await requestCustomPingAction({ runId, text, roles: [...selected] });
      if (!result.ok) {
        setSendError(result.message);
        return;
      }
      onSent(result.message);
      dialogRef.current?.close();
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      className="w-[min(30rem,calc(100vw-2rem))] max-h-[min(40rem,calc(100vh-2rem))] overflow-y-auto rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-base font-semibold">
          Ping roles
        </h2>
        <div role="group" aria-label="Ping type" className="inline-flex rounded-md border border-border p-0.5 text-xs">
          {(
            [
              ["automatic", "Automatic"],
              ["custom", "Custom request"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              disabled={sending}
              onClick={() => {
                setChosenMode(value);
                setSendError(null);
              }}
              className={`rounded px-2 py-1 font-medium ${
                mode === value ? "bg-surface-raised text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        {!data && !loadError ? <p className="text-sm text-muted">Loading…</p> : null}
        {loadError ? <p className="text-sm text-danger">{loadError}</p> : null}

        {data && mode === "automatic" ? (
          <>
            {data.automatic.lines.length > 0 ? (
              <PingPreview lines={data.automatic.lines} />
            ) : (
              <p className="text-sm text-muted">{data.automatic.emptyReason}</p>
            )}
            {data.automatic.notes.map((note) => (
              <p key={note} className="text-xs text-muted">
                {note}
              </p>
            ))}
          </>
        ) : null}

        {data && mode === "custom" ? (
          <>
            <div>
              <label htmlFor={textId} className="mb-1 flex items-baseline justify-between gap-2 text-xs text-muted">
                <span>Message</span>
                <span className="tabular-nums">
                  {normalizedText.length}/{CUSTOM_PING_TEXT_MAX}
                </span>
              </label>
              <input
                id={textId}
                type="text"
                value={text}
                disabled={sending}
                placeholder="Need 1 LB for Coiled Altar"
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    send();
                  }
                }}
                className="h-9 w-full rounded-md border border-border bg-surface-raised px-2 text-sm"
              />
              {textError ? <p className="mt-1 text-xs text-danger">{textError}</p> : null}
            </div>
            {roles ? (
              roles.length > 0 ? (
                <div className="space-y-2">
                  <RoleChoices
                    title="Roles to ping"
                    roles={roles.filter((role) => TEAM_ROLE_KEYS.includes(role.key))}
                    selected={selected}
                    disabled={sending}
                    onToggle={toggleRole}
                  />
                  <RoleChoices
                    title="Classes"
                    roles={roles.filter((role) => !TEAM_ROLE_KEYS.includes(role.key))}
                    selected={selected}
                    disabled={sending}
                    onToggle={toggleRole}
                  />
                </div>
              ) : (
                <p className="text-sm text-danger">No allowed role exists on Discord.</p>
              )
            ) : (
              <p className="text-sm text-danger">Discord roles could not be loaded. Close and try again.</p>
            )}
            {customLines.length > 0 ? <PingPreview lines={customLines} /> : null}
          </>
        ) : null}

        {sendError ? (
          <p role="alert" className="text-sm text-danger">
            {sendError}
          </p>
        ) : null}
        {data?.lastPingStatus ? (
          <p className={`text-xs ${PING_DELIVERY_LABELS[data.lastPingStatus].failed ? "text-danger" : "text-muted"}`}>
            {PING_DELIVERY_LABELS[data.lastPingStatus].text}
          </p>
        ) : null}
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button type="button" size="sm" variant="ghost" disabled={sending} onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={!canSend} onClick={send}>
          {sending ? "Sending…" : "Send ping"}
        </Button>
      </div>
    </dialog>
  );
}
