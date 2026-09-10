"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCharacterAction,
  lookupCharacterAction,
  updateCharacterAction,
} from "@/controllers/character.actions";
import { Button } from "@/components/ui/button";
import { CLASS_LABELS, REGION_LABELS } from "@/lib/labels";
import { WOW_REGIONS, type WowClass, type WowRegion } from "@/models/enums";
import { specializationsForClass } from "@/lib/wow-specializations";

type FormMode = "create" | "edit";

type CharacterFormValues = {
  id?: string;
  name: string;
  realm: string;
  region: WowRegion;
  wowClass: WowClass;
  specialization: string;
  itemLevel: number | null;
};

const EMPTY_IDENTITY = { name: "", realm: "", region: "EU" as WowRegion };

/** Blizzard lookup result for the create-mode preview step. */
type LookupResult = { wowClass: WowClass; itemLevel: number | null } | null;

export function CharacterFormDialog({
  mode,
  initial,
  triggerLabel,
  triggerClassName,
}: {
  mode: FormMode;
  initial?: CharacterFormValues;
  triggerLabel: string;
  triggerClassName?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [identity, setIdentity] = useState(
    initial ? { name: initial.name, realm: initial.realm, region: initial.region } : EMPTY_IDENTITY,
  );
  const [specialization, setSpecialization] = useState(initial?.specialization ?? "");
  const [lookup, setLookup] = useState<LookupResult>(
    initial ? { wowClass: initial.wowClass, itemLevel: initial.itemLevel } : null,
  );

  const resolvedClass = mode === "edit" ? (initial?.wowClass ?? null) : lookup?.wowClass ?? null;
  const resolvedItemLevel = mode === "edit" ? (initial?.itemLevel ?? null) : lookup?.itemLevel ?? null;
  const specs = useMemo(
    () => (resolvedClass ? specializationsForClass(resolvedClass) : []),
    [resolvedClass],
  );
  const derivedRole = specs.find((spec) => spec.name === specialization)?.role ?? specs[0]?.role;

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setOpen(false);
      setError(null);
      setSuccess(null);
      setIdentity(initial ? { name: initial.name, realm: initial.realm, region: initial.region } : EMPTY_IDENTITY);
      setSpecialization(initial?.specialization ?? "");
      setLookup(initial ? { wowClass: initial.wowClass, itemLevel: initial.itemLevel } : null);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [open, initial]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
  }

  function updateIdentity(patch: Partial<typeof identity>) {
    setIdentity((current) => ({ ...current, ...patch }));
    if (mode === "create") {
      // Any identity change invalidates a prior lookup; the User must look
      // up again so Class/Item Level always match what is being submitted.
      setLookup(null);
      setSpecialization("");
    }
  }

  function runLookup(event?: { preventDefault(): void }) {
    event?.preventDefault();
    setError(null);
    setLookingUp(true);
    void lookupCharacterAction(identity).then((result) => {
      setLookingUp(false);
      if (!result.ok || !result.data) {
        setError(result.message);
        return;
      }
      setLookup(result.data as LookupResult);
      setSpecialization((current) => current || "");
    });
  }

  function submit(event?: { preventDefault(): void }) {
    event?.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result =
        mode === "create"
          ? await createCharacterAction({ ...identity, specialization })
          : await updateCharacterAction({
              characterId: initial?.id,
              ...identity,
              specialization,
            });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setSuccess(result.message);
      router.refresh();
      close();
    });
  }

  const readyToAdd = mode === "edit" || Boolean(lookup);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIdentity(initial ? { name: initial.name, realm: initial.realm, region: initial.region } : EMPTY_IDENTITY);
          setSpecialization(initial?.specialization ?? "");
          setLookup(initial ? { wowClass: initial.wowClass, itemLevel: initial.itemLevel } : null);
          setError(null);
          setSuccess(null);
          setOpen(true);
        }}
        className={
          triggerClassName ??
          "inline-flex h-8 items-center rounded-md bg-accent px-2 text-xs font-medium text-black hover:bg-[#d8b436]"
        }
      >
        {triggerLabel}
      </button>
      {open ? (
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          className="w-[min(100%,28rem)] max-h-[90vh] overflow-y-auto rounded-md border border-border bg-surface p-0 text-foreground backdrop:bg-black/60"
        >
          <div className="border-b border-border px-4 py-3">
            <h2 id={titleId} className="text-sm font-semibold">
              {mode === "create" ? "Add Character" : "Edit Character"}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {mode === "create"
                ? "Look up a character by Region / Realm / Name. Blizzard supplies Class and Item Level; you choose the specialization."
                : "Class and Item Level are Blizzard-authoritative and cannot be edited here."}
            </p>
          </div>
          <form className="space-y-3 px-4 py-4" onSubmit={mode === "create" && !lookup ? runLookup : submit}>
            {error ? (
              <p id={errorId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
                {error}
              </p>
            ) : null}
            {success ? (
              <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
                {success}
              </p>
            ) : null}
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Name</span>
              <input
                name="name"
                autoComplete="off"
                value={identity.name}
                onChange={(event) => updateIdentity({ name: event.target.value })}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Realm</span>
              <input
                name="realm"
                autoComplete="off"
                value={identity.realm}
                onChange={(event) => updateIdentity({ realm: event.target.value })}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Region</span>
              <select
                aria-label="Region"
                value={identity.region}
                onChange={(event) => updateIdentity({ region: event.target.value as WowRegion })}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              >
                {WOW_REGIONS.map((region) => (
                  <option key={region} value={region}>
                    {REGION_LABELS[region]}
                  </option>
                ))}
              </select>
            </label>

            {mode === "create" && !lookup ? (
              <Button type="submit" disabled={lookingUp || !identity.name.trim() || !identity.realm.trim()}>
                {lookingUp ? "Looking up…" : "Look up character"}
              </Button>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="mb-1 block text-xs text-muted">Class</span>
                    <p className="text-sm font-medium">
                      {resolvedClass ? CLASS_LABELS[resolvedClass] : "Unknown"}{" "}
                      <span className="text-xs font-normal text-muted">(Blizzard)</span>
                    </p>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-muted">Item level</span>
                    <p className="text-sm font-medium">
                      {typeof resolvedItemLevel === "number" ? resolvedItemLevel : "Unknown"}{" "}
                      <span className="text-xs font-normal text-muted">(Blizzard)</span>
                    </p>
                  </div>
                </div>
                <label className="block text-sm">
                  <span className="mb-1 block text-muted">Specialization</span>
                  <select
                    aria-label="Specialization"
                    value={specialization}
                    onChange={(event) => setSpecialization(event.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-surface px-2"
                  >
                    <option value="">Select…</option>
                    {specs.map((spec) => (
                      <option key={spec.name} value={spec.name}>
                        {spec.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-sm">
                  <span className="text-muted">Primary role </span>
                  <span className="font-medium">{derivedRole ?? "—"}</span>
                  <span className="mt-1 block text-xs text-muted">
                    Derived from specialization. Extra booster roles are granted separately through Booster Access.
                  </span>
                </p>
              </>
            )}

            <div className="flex justify-end gap-2 border-t border-border px-4 py-3 -mx-4 -mb-4 mt-4">
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              {mode === "create" && !lookup ? null : (
                <Button type="submit" disabled={pending || !readyToAdd || !specialization}>
                  {pending ? "Saving…" : mode === "create" ? "Add character" : "Save changes"}
                </Button>
              )}
            </div>
          </form>
        </dialog>
      ) : null}
    </>
  );
}
