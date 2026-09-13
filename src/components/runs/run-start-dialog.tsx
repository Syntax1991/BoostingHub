"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { startRunAction } from "@/controllers/run.actions";
import { Button } from "@/components/ui/button";

type CompositionPreview = {
  tanks: number;
  healers: number;
  dps: number;
  lootbuddies: number;
  total: number;
};

export function RunStartDialog({
  runId,
  composition,
  onClose,
}: {
  runId: string;
  composition?: CompositionPreview;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [collector1Name, setCollector1Name] = useState("");
  const [collector1Realm, setCollector1Realm] = useState("");
  const [collector2Name, setCollector2Name] = useState("");
  const [collector2Realm, setCollector2Realm] = useState("");

  const preview1 = useMemo(() => {
    const name = collector1Name.trim();
    const realm = collector1Realm.trim();
    return name && realm ? `${name}-${realm}` : null;
  }, [collector1Name, collector1Realm]);
  const preview2 = useMemo(() => {
    const name = collector2Name.trim();
    const realm = collector2Realm.trim();
    return name && realm ? `${name}-${realm}` : null;
  }, [collector2Name, collector2Realm]);

  const canSubmit = Boolean(preview1 && preview2);

  useEffect(() => {
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onDialogClose = () => onClose();
    dialog.addEventListener("close", onDialogClose);
    return () => dialog.removeEventListener("close", onDialogClose);
  }, [onClose]);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  function submit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await startRunAction({
        runId,
        goldCollectors: [
          { name: collector1Name, realm: collector1Realm },
          { name: collector2Name, realm: collector2Realm },
        ],
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      close();
      window.location.reload();
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(36rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Start Run
        </h2>
      </div>
      <div className="space-y-4 px-4 py-4 text-sm">
        {error ? (
          <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
            {error}
          </p>
        ) : null}
        <p>Starting freezes the operational roster and opens attendance tracking.</p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>Signups will close and attendance will be snapshotted from the published roster.</li>
          <li>Both Gold Collector characters will be frozen for this Run.</li>
          <li>The Discord bot will post the operational start roster into this Run&apos;s channel asynchronously.</li>
        </ul>

        <div className="grid gap-4 sm:grid-cols-2">
          <CollectorFields
            title="Gold Collector 1"
            name={collector1Name}
            realm={collector1Realm}
            onNameChange={setCollector1Name}
            onRealmChange={setCollector1Realm}
            disabled={pending}
          />
          <CollectorFields
            title="Gold Collector 2"
            name={collector2Name}
            realm={collector2Realm}
            onNameChange={setCollector2Name}
            onRealmChange={setCollector2Realm}
            disabled={pending}
          />
        </div>

        <div className="rounded-md border border-border bg-surface-raised px-3 py-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted">Preview</p>
          <p className="mt-2">
            Selected participants: {composition?.total ?? "—"}
            {composition
              ? ` · Tanks ${composition.tanks} · Healers ${composition.healers} · DPS ${composition.dps} · Lootbuddies ${composition.lootbuddies}`
              : null}
          </p>
          <p className="mt-1">Gold Collector 1: {preview1 ?? "—"}</p>
          <p>Gold Collector 2: {preview2 ?? "—"}</p>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3 -mx-4 -mb-4">
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Keep waiting
          </Button>
          <Button type="button" onClick={submit} disabled={pending || !canSubmit}>
            {pending ? "Starting…" : "Start Run"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function CollectorFields({
  title,
  name,
  realm,
  onNameChange,
  onRealmChange,
  disabled,
}: {
  title: string;
  name: string;
  realm: string;
  onNameChange: (value: string) => void;
  onRealmChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</legend>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-muted">Character</span>
        <input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          disabled={disabled}
          className="h-9 w-full rounded-md border border-border bg-surface px-2"
          autoComplete="off"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-muted">Realm</span>
        <input
          value={realm}
          onChange={(event) => onRealmChange(event.target.value)}
          disabled={disabled}
          className="h-9 w-full rounded-md border border-border bg-surface px-2"
          autoComplete="off"
        />
      </label>
    </fieldset>
  );
}
