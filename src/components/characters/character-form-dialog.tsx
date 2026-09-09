"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCharacterAction, updateCharacterAction } from "@/controllers/character.actions";
import { Button } from "@/components/ui/button";
import { CLASS_LABELS, REGION_LABELS } from "@/lib/labels";
import { WOW_CLASSES, WOW_REGIONS, type WowClass, type WowRegion } from "@/models/enums";
import { specializationsForClass } from "@/lib/wow-specializations";

type FormMode = "create" | "edit";

type CharacterFormValues = {
  id?: string;
  name: string;
  realm: string;
  region: WowRegion;
  wowClass: WowClass;
  specialization: string;
  itemLevel: number;
};

const EMPTY_FORM: CharacterFormValues = {
  name: "",
  realm: "",
  region: "EU",
  wowClass: "WARRIOR",
  specialization: "Arms",
  itemLevel: 0,
};

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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<CharacterFormValues>(initial ?? EMPTY_FORM);

  const specs = useMemo(() => specializationsForClass(form.wowClass), [form.wowClass]);
  const derivedRole = specs.find((spec) => spec.name === form.specialization)?.role ?? specs[0]?.role;

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setOpen(false);
      setError(null);
      setSuccess(null);
      setForm(initial ?? EMPTY_FORM);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [open, initial]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
  }

  function onClassChange(wowClass: WowClass) {
    const nextSpecs = specializationsForClass(wowClass);
    setForm((current) => ({
      ...current,
      wowClass,
      specialization: nextSpecs[0]?.name ?? "",
    }));
  }

  function submit(event?: { preventDefault(): void }) {
    event?.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result =
        mode === "create"
          ? await createCharacterAction({
              name: form.name,
              realm: form.realm,
              region: form.region,
              wowClass: form.wowClass,
              specialization: form.specialization,
              itemLevel: form.itemLevel,
            })
          : await updateCharacterAction({
              characterId: form.id,
              name: form.name,
              realm: form.realm,
              region: form.region,
              specialization: form.specialization,
              itemLevel: form.itemLevel,
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

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setForm(initial ?? EMPTY_FORM);
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
              Character data is manually maintained until Battle.net sync exists.
            </p>
          </div>
          <form className="space-y-3 px-4 py-4" onSubmit={submit}>
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
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
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
                value={form.realm}
                onChange={(event) => setForm((current) => ({ ...current, realm: event.target.value }))}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Region</span>
              <select
                aria-label="Region"
                value={form.region}
                onChange={(event) =>
                  setForm((current) => ({ ...current, region: event.target.value as WowRegion }))
                }
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              >
                {WOW_REGIONS.map((region) => (
                  <option key={region} value={region}>
                    {REGION_LABELS[region]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Class</span>
              <select
                aria-label="Class"
                value={form.wowClass}
                disabled={mode === "edit"}
                title={mode === "edit" ? "Class cannot be changed after creation." : undefined}
                onChange={(event) => onClassChange(event.target.value as WowClass)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {WOW_CLASSES.map((wowClass) => (
                  <option key={wowClass} value={wowClass}>
                    {CLASS_LABELS[wowClass]}
                  </option>
                ))}
              </select>
              {mode === "edit" ? (
                <span className="mt-1 block text-xs text-muted">
                  Class is immutable after creation so BoosterAccess and signup history stay consistent.
                </span>
              ) : null}
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Specialization</span>
              <select
                aria-label="Specialization"
                value={form.specialization}
                onChange={(event) => setForm((current) => ({ ...current, specialization: event.target.value }))}
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              >
                {specs.map((spec) => (
                  <option key={spec.name} value={spec.name}>
                    {spec.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm">
              <span className="text-muted">Primary role </span>
              <span className="font-medium">{derivedRole}</span>
              <span className="mt-1 block text-xs text-muted">
                Derived from specialization. Extra booster roles are granted separately through BoosterAccess.
              </span>
            </p>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Item level (manual)</span>
              <input
                name="itemLevel"
                type="number"
                min={0}
                max={9999}
                value={form.itemLevel}
                onChange={(event) =>
                  setForm((current) => ({ ...current, itemLevel: Number(event.target.value) }))
                }
                className="h-9 w-full rounded-md border border-border bg-surface px-2"
              />
            </label>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3 -mx-4 -mb-4 mt-4">
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : mode === "create" ? "Add character" : "Save changes"}
              </Button>
            </div>
          </form>
        </dialog>
      ) : null}
    </>
  );
}
