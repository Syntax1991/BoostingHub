"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCharactersAction,
  lookupCharactersFromRaiderIoAction,
  updateCharacterAction,
} from "@/controllers/character.actions";
import { Button } from "@/components/ui/button";
import { CHARACTER_ROLE_LABELS, CLASS_LABELS, REGION_LABELS } from "@/lib/labels";
import { availableRoles, remainingSpecsForClass } from "@/lib/character-capabilities";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { RAIDER_IO_BULK_MAX } from "@/lib/map-with-concurrency";
import {
  WOW_REGIONS,
  type CharacterRole,
  type WowClass,
  type WowRegion,
} from "@/models/enums";
import { specializationsForClass } from "@/lib/wow-specializations";

type FormMode = "create" | "edit";

type CharacterFormValues = {
  id?: string;
  name: string;
  realm: string;
  region: WowRegion;
  wowClass: WowClass;
  specialization: string;
  playableSpecs: string[];
  offspecRoles: CharacterRole[];
  itemLevel: number | null;
};

type LookupStatus = "idle" | "pending" | "resolved" | "error";
type CreateStatus = "idle" | "pending" | "added" | "error";

export type CreateRow = {
  id: string;
  url: string;
  /** URL that produced the current resolved preview (for skip-relookup). */
  resolvedUrl: string | null;
  lookupStatus: LookupStatus;
  lookupError: string | null;
  name: string | null;
  realm: string | null;
  region: WowRegion | null;
  wowClass: WowClass | null;
  itemLevel: number | null;
  alreadyOwned: boolean;
  specialization: string;
  playableSpecs: string[];
  offspecRoles: CharacterRole[];
  createStatus: CreateStatus;
  createError: string | null;
};

const EMPTY_IDENTITY = { name: "", realm: "", region: "EU" as WowRegion };

function newRowId() {
  return crypto.randomUUID();
}

export function emptyRow(id?: string): CreateRow {
  return {
    id: id ?? newRowId(),
    url: "",
    resolvedUrl: null,
    lookupStatus: "idle",
    lookupError: null,
    name: null,
    realm: null,
    region: null,
    wowClass: null,
    itemLevel: null,
    alreadyOwned: false,
    specialization: "",
    playableSpecs: [],
    offspecRoles: [],
    createStatus: "idle",
    createError: null,
  };
}

function offspecOptionsFor(input: {
  wowClass: WowClass | null;
  specialization: string;
  playableSpecs: readonly string[];
}): CharacterRole[] {
  if (!input.wowClass || !input.specialization) return [];
  const roles = availableRoles({
    wowClass: input.wowClass,
    specialization: input.specialization,
    playableSpecs: input.playableSpecs,
  });
  const primary =
    specializationsForClass(input.wowClass).find((spec) => spec.name === input.specialization)
      ?.role ?? null;
  return roles.filter((role) => role !== primary);
}

function pruneOffspecRoles(
  roles: readonly CharacterRole[],
  allowed: readonly CharacterRole[],
): CharacterRole[] {
  const allowedSet = new Set(allowed);
  return roles.filter((role) => allowedSet.has(role));
}

/** Unused trailing input: blank URL and no lookup/create lifecycle worth keeping. */
export function isUnusedEmptyCreateRow(row: CreateRow): boolean {
  return (
    row.url.trim() === "" &&
    row.lookupStatus === "idle" &&
    row.createStatus === "idle" &&
    row.resolvedUrl === null &&
    row.name === null &&
    row.lookupError === null &&
    row.createError === null
  );
}

/**
 * Keep exactly one trailing empty URL row when under the bulk max.
 * Never zero rows, never more than RAIDER_IO_BULK_MAX, never multiple trailing empties.
 */
export function normalizeCreateRows(rows: CreateRow[]): CreateRow[] {
  const kept = rows.filter((row) => !isUnusedEmptyCreateRow(row));
  if (kept.length === 0) {
    const reusable = rows.find(isUnusedEmptyCreateRow);
    return [reusable ?? emptyRow()];
  }

  const capped = kept.slice(0, RAIDER_IO_BULK_MAX);
  if (capped.length >= RAIDER_IO_BULK_MAX) return capped;

  const last = capped[capped.length - 1]!;
  if (last.url.trim() === "") return capped;

  const reusable = rows.find(isUnusedEmptyCreateRow);
  return [...capped, reusable ?? emptyRow()];
}

function identityKey(row: Pick<CreateRow, "name" | "realm" | "region">): string | null {
  if (!row.name || !row.realm || !row.region) return null;
  return `${row.region}|${normalizeCharacterIdentity(row.realm)}|${normalizeCharacterIdentity(row.name)}`;
}

function clearRowPreview(row: CreateRow): CreateRow {
  return {
    ...row,
    resolvedUrl: null,
    lookupStatus: "idle",
    lookupError: null,
    name: null,
    realm: null,
    region: null,
    wowClass: null,
    itemLevel: null,
    alreadyOwned: false,
    specialization: "",
    playableSpecs: [],
    offspecRoles: [],
    createStatus: row.createStatus === "added" ? "added" : "idle",
    createError: null,
  };
}

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
  const [createProgress, setCreateProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  // Edit mode state
  const [identity, setIdentity] = useState(
    initial ? { name: initial.name, realm: initial.realm, region: initial.region } : EMPTY_IDENTITY,
  );
  const [specialization, setSpecialization] = useState(initial?.specialization ?? "");
  const [playableSpecs, setPlayableSpecs] = useState<string[]>(initial?.playableSpecs ?? []);
  const [offspecRoles, setOffspecRoles] = useState<CharacterRole[]>(initial?.offspecRoles ?? []);

  // Create mode bulk rows — stable SSR id avoids crypto hydration mismatch.
  const [rows, setRows] = useState<CreateRow[]>(() => [emptyRow("create-row-0")]);

  const editClass = initial?.wowClass ?? null;
  const editItemLevel = initial?.itemLevel ?? null;
  const editSpecs = useMemo(
    () => (editClass ? specializationsForClass(editClass) : []),
    [editClass],
  );
  const editDerivedRole =
    editSpecs.find((spec) => spec.name === specialization)?.role ?? editSpecs[0]?.role;
  const editAdditionalOptions = useMemo(() => {
    if (!editClass || !specialization) return [];
    return remainingSpecsForClass(editClass, specialization).map((name) => {
      const role = editSpecs.find((spec) => spec.name === name)?.role;
      return { name, role };
    });
  }, [editClass, specialization, editSpecs]);
  const editOffspecOptions = useMemo(
    () =>
      offspecOptionsFor({
        wowClass: editClass,
        specialization,
        playableSpecs,
      }),
    [editClass, specialization, playableSpecs],
  );

  const batchDuplicateIds = useMemo(() => {
    const firstByKey = new Map<string, string>();
    const duplicates = new Set<string>();
    for (const row of rows) {
      if (row.createStatus === "added" || row.lookupStatus !== "resolved") continue;
      const key = identityKey(row);
      if (!key) continue;
      const first = firstByKey.get(key);
      if (first) duplicates.add(row.id);
      else firstByKey.set(key, row.id);
    }
    return duplicates;
  }, [rows]);

  const pendingCreateRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.lookupStatus === "resolved" &&
          row.createStatus !== "added" &&
          Boolean(row.specialization) &&
          !batchDuplicateIds.has(row.id) &&
          !row.alreadyOwned,
      ),
    [rows, batchDuplicateIds],
  );

  const readyToBulkAdd = pendingCreateRows.length > 0 && !lookingUp;

  function resetCreateRows() {
    setRows([emptyRow()]);
    setCreateProgress(null);
  }

  function resetFromInitial() {
    setIdentity(initial ? { name: initial.name, realm: initial.realm, region: initial.region } : EMPTY_IDENTITY);
    setSpecialization(initial?.specialization ?? "");
    setPlayableSpecs(initial?.playableSpecs ?? []);
    setOffspecRoles(initial?.offspecRoles ?? []);
    resetCreateRows();
  }

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setOpen(false);
      setError(null);
      setSuccess(null);
      resetFromInitial();
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when dialog opens / initial identity changes
  }, [open, initial]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
  }

  function updateRow(id: string, patch: Partial<CreateRow> | ((row: CreateRow) => CreateRow)) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) return row;
        return typeof patch === "function" ? patch(row) : { ...row, ...patch };
      }),
    );
  }

  function changeRowUrl(id: string, nextUrl: string) {
    setRows((current) => {
      const updated = current.map((row) => {
        if (row.id !== id) return row;
        if (row.createStatus === "added") return row;
        const trimmed = nextUrl;
        if (row.resolvedUrl !== null && trimmed.trim() === row.resolvedUrl.trim()) {
          return { ...row, url: trimmed };
        }
        return { ...clearRowPreview(row), url: trimmed };
      });
      return normalizeCreateRows(updated);
    });
  }

  function removeRow(id: string) {
    setRows((current) => normalizeCreateRows(current.filter((row) => row.id !== id)));
  }

  function changeRowPrimarySpec(id: string, next: string) {
    updateRow(id, (row) => {
      const playableSpecs = row.playableSpecs.filter(
        (spec) => spec.toLocaleLowerCase("en-US") !== next.toLocaleLowerCase("en-US"),
      );
      const allowed = offspecOptionsFor({
        wowClass: row.wowClass,
        specialization: next,
        playableSpecs,
      });
      return {
        ...row,
        specialization: next,
        playableSpecs,
        offspecRoles: pruneOffspecRoles(row.offspecRoles, allowed),
        createStatus: row.createStatus === "added" ? "added" : "idle",
        createError: null,
      };
    });
  }

  function toggleRowPlayableSpec(id: string, specName: string, checked: boolean) {
    updateRow(id, (row) => {
      const playableSpecs = checked
        ? row.playableSpecs.includes(specName)
          ? row.playableSpecs
          : [...row.playableSpecs, specName]
        : row.playableSpecs.filter((spec) => spec !== specName);
      const allowed = offspecOptionsFor({
        wowClass: row.wowClass,
        specialization: row.specialization,
        playableSpecs,
      });
      return {
        ...row,
        playableSpecs,
        offspecRoles: pruneOffspecRoles(row.offspecRoles, allowed),
        createStatus: row.createStatus === "added" ? "added" : "idle",
        createError: null,
      };
    });
  }

  function toggleRowOffspecRole(id: string, role: CharacterRole, checked: boolean) {
    updateRow(id, (row) => ({
      ...row,
      offspecRoles: checked
        ? row.offspecRoles.includes(role)
          ? row.offspecRoles
          : [...row.offspecRoles, role]
        : row.offspecRoles.filter((entry) => entry !== role),
      createStatus: row.createStatus === "added" ? "added" : "idle",
      createError: null,
    }));
  }

  function rowsNeedingLookup(list: CreateRow[]) {
    return list.filter((row) => {
      if (row.createStatus === "added") return false;
      const url = row.url.trim();
      if (!url) return false;
      if (row.lookupStatus === "resolved" && row.resolvedUrl?.trim() === url) return false;
      return true;
    });
  }

  async function runBulkLookup() {
    setError(null);
    const targets = rowsNeedingLookup(rows);
    if (targets.length === 0) return;

    setLookingUp(true);
    setRows((current) =>
      current.map((row) =>
        targets.some((target) => target.id === row.id)
          ? {
              ...row,
              lookupStatus: "pending",
              lookupError: null,
              createStatus: row.createStatus === "added" ? "added" : "idle",
              createError: null,
            }
          : row,
      ),
    );

    const result = await lookupCharactersFromRaiderIoAction({
      urls: targets.map((row) => row.url.trim()),
    });
    setLookingUp(false);

    if (!result.ok || !result.results) {
      setError(result.message);
      setRows((current) =>
        current.map((row) =>
          targets.some((target) => target.id === row.id)
            ? { ...row, lookupStatus: "error", lookupError: result.message }
            : row,
        ),
      );
      return;
    }

    const byUrlIndex = result.results;
    setRows((current) =>
      current.map((row) => {
        const targetIndex = targets.findIndex((target) => target.id === row.id);
        if (targetIndex < 0) return row;
        const item = byUrlIndex[targetIndex];
        if (!item) {
          return { ...row, lookupStatus: "error", lookupError: "Lookup failed." };
        }
        if (!item.ok) {
          return {
            ...clearRowPreview(row),
            url: row.url,
            lookupStatus: "error",
            lookupError: item.message,
          };
        }
        return {
          ...row,
          resolvedUrl: row.url.trim(),
          lookupStatus: "resolved",
          lookupError: null,
          name: item.data.name,
          realm: item.data.realm,
          region: item.data.region as WowRegion,
          wowClass: item.data.wowClass as WowClass,
          itemLevel: item.data.itemLevel,
          alreadyOwned: item.data.alreadyOwned,
          specialization: "",
          playableSpecs: [],
          offspecRoles: [],
          createStatus: "idle",
          createError: null,
        };
      }),
    );
  }

  function onRaiderIoKeyDown(event: { key: string; preventDefault(): void }) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (lookingUp || pending) return;
    void runBulkLookup();
  }

  function submitEdit(event?: { preventDefault(): void }) {
    event?.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await updateCharacterAction({
        characterId: initial?.id,
        ...identity,
        specialization,
        playableSpecs,
        offspecRoles,
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

  function submitCreate(event?: { preventDefault(): void }) {
    event?.preventDefault();
    setError(null);
    setSuccess(null);
    const toCreate = pendingCreateRows;
    if (toCreate.length === 0) return;

    startTransition(async () => {
      setCreateProgress({ done: 0, total: toCreate.length });
      setRows((current) =>
        current.map((row) =>
          toCreate.some((item) => item.id === row.id)
            ? { ...row, createStatus: "pending", createError: null }
            : row,
        ),
      );

      const result = await createCharactersAction({
        characters: toCreate.map((row) => ({
          clientId: row.id,
          name: row.name!,
          realm: row.realm!,
          region: row.region!,
          specialization: row.specialization,
          playableSpecs: row.playableSpecs,
          offspecRoles: row.offspecRoles,
        })),
      });

      if (!result.results) {
        setCreateProgress(null);
        setError(result.message);
        setRows((current) =>
          current.map((row) =>
            toCreate.some((item) => item.id === row.id)
              ? { ...row, createStatus: "error", createError: result.message }
              : row,
          ),
        );
        return;
      }

      setRows((current) =>
        current.map((row) => {
          const item = result.results!.find((entry) => entry.clientId === row.id);
          if (!item) return row;
          if (item.ok) {
            return { ...row, createStatus: "added", createError: null };
          }
          return { ...row, createStatus: "error", createError: item.message };
        }),
      );
      setCreateProgress({
        done: result.results.filter((entry) => entry.ok).length,
        total: toCreate.length,
      });

      const allOk = result.results.every((entry) => entry.ok);
      if (allOk) {
        setSuccess(result.message);
        router.refresh();
        close();
        return;
      }

      setError(result.message);
      router.refresh();
    });
  }

  function changeEditPrimarySpec(next: string) {
    setSpecialization(next);
    setPlayableSpecs((current) => {
      const nextPlayable = current.filter(
        (spec) => spec.toLocaleLowerCase("en-US") !== next.toLocaleLowerCase("en-US"),
      );
      setOffspecRoles((roles) =>
        pruneOffspecRoles(
          roles,
          offspecOptionsFor({
            wowClass: editClass,
            specialization: next,
            playableSpecs: nextPlayable,
          }),
        ),
      );
      return nextPlayable;
    });
  }

  function toggleEditPlayableSpec(specName: string, checked: boolean) {
    setPlayableSpecs((current) => {
      const nextPlayable = checked
        ? current.includes(specName)
          ? current
          : [...current, specName]
        : current.filter((spec) => spec !== specName);
      setOffspecRoles((roles) =>
        pruneOffspecRoles(
          roles,
          offspecOptionsFor({
            wowClass: editClass,
            specialization,
            playableSpecs: nextPlayable,
          }),
        ),
      );
      return nextPlayable;
    });
  }

  function toggleEditOffspecRole(role: CharacterRole, checked: boolean) {
    setOffspecRoles((current) => {
      if (checked) {
        return current.includes(role) ? current : [...current, role];
      }
      return current.filter((entry) => entry !== role);
    });
  }

  const addButtonLabel =
    pendingCreateRows.length <= 1
      ? "Add character"
      : `Add ${pendingCreateRows.length} characters`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          resetFromInitial();
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
          className="w-[min(36rem,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto rounded-md border border-border bg-surface p-0 text-foreground backdrop:bg-black/60"
        >
          <div className="border-b border-border px-4 py-3">
            <h2 id={titleId} className="text-sm font-semibold">
              {mode === "create" ? "Add Character" : "Edit Character"}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {mode === "create"
                ? "Paste one or more Raider.IO character links. Blizzard supplies Name, Realm, Class and Item Level; you choose specializations per character."
                : "Class and Item Level are Blizzard-authoritative and cannot be edited here."}
            </p>
          </div>

          {mode === "create" ? (
            <form
              className="space-y-3 px-4 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (readyToBulkAdd) submitCreate(event);
                else void runBulkLookup();
              }}
            >
              {error ? (
                <p
                  id={errorId}
                  role="alert"
                  className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
                >
                  {error}
                </p>
              ) : null}
              {success ? (
                <p
                  role="status"
                  className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm"
                >
                  {success}
                </p>
              ) : null}
              {createProgress ? (
                <p className="text-xs text-muted" role="status">
                  Adding characters… {createProgress.done}/{createProgress.total}
                </p>
              ) : null}

              <ul className="space-y-4">
                {rows.map((row, index) => {
                  const isDuplicate = batchDuplicateIds.has(row.id);
                  const specs = row.wowClass ? specializationsForClass(row.wowClass) : [];
                  const additionalOptions =
                    row.wowClass && row.specialization
                      ? remainingSpecsForClass(row.wowClass, row.specialization).map((name) => {
                          const role = specs.find((spec) => spec.name === name)?.role;
                          return { name, role };
                        })
                      : [];
                  const derivedRole =
                    specs.find((spec) => spec.name === row.specialization)?.role ??
                    specs[0]?.role;
                  const statusLabel =
                    row.createStatus === "added"
                      ? "Added"
                      : row.createStatus === "pending"
                        ? "Adding…"
                        : row.createStatus === "error"
                          ? "Error"
                          : row.lookupStatus === "pending"
                            ? "Looking up…"
                            : row.lookupStatus === "resolved"
                              ? "Ready"
                              : row.lookupStatus === "error"
                                ? "Error"
                                : null;

                  return (
                    <li
                      key={row.id}
                      className="space-y-2 border-b border-border pb-4 last:border-b-0 last:pb-0"
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-2 w-5 shrink-0 text-xs text-muted">{index + 1}.</span>
                        <label className="min-w-0 flex-1 block text-sm">
                          {index === 0 ? (
                            <span className="mb-1 block text-muted">Raider.IO character link</span>
                          ) : (
                            <span className="sr-only">Raider.IO character link {index + 1}</span>
                          )}
                          <input
                            name={`raiderIoUrl-${row.id}`}
                            autoComplete="off"
                            placeholder="Paste Raider.IO character link"
                            value={row.url}
                            disabled={row.createStatus === "added" || lookingUp || pending}
                            onChange={(event) => changeRowUrl(row.id, event.target.value)}
                            onKeyDown={onRaiderIoKeyDown}
                            aria-invalid={Boolean(row.lookupError || row.createError)}
                            className="h-9 w-full rounded-md border border-border bg-surface px-2"
                          />
                        </label>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={
                            lookingUp ||
                            pending ||
                            (rows.length === 1 && !row.url.trim() && row.lookupStatus === "idle")
                          }
                          onClick={() => removeRow(row.id)}
                          className="mt-0 shrink-0"
                        >
                          Remove
                        </Button>
                      </div>

                      {statusLabel ? (
                        <p className="pl-7 text-xs text-muted">{statusLabel}</p>
                      ) : null}

                      {row.lookupError ? (
                        <p role="alert" className="pl-7 text-sm text-danger">
                          {row.lookupError}
                        </p>
                      ) : null}
                      {row.createError ? (
                        <p role="alert" className="pl-7 text-sm text-danger">
                          {row.createError}
                        </p>
                      ) : null}
                      {isDuplicate ? (
                        <p role="alert" className="pl-7 text-sm text-danger">
                          This character is already included in this batch.
                        </p>
                      ) : null}
                      {row.alreadyOwned && row.lookupStatus === "resolved" ? (
                        <p role="status" className="pl-7 text-sm text-muted">
                          Already added to your account.
                        </p>
                      ) : null}

                      {row.lookupStatus === "resolved" && row.name && row.realm && row.region ? (
                        <div className="space-y-2 pl-7">
                          <p className="text-sm font-medium">
                            {row.name}-{row.realm} · {row.region}
                          </p>
                          <p className="text-sm">
                            {row.wowClass ? CLASS_LABELS[row.wowClass] : "Unknown"} ·{" "}
                            {typeof row.itemLevel === "number" ? row.itemLevel : "Unknown"} ilvl
                            <span className="text-xs text-muted"> (Blizzard)</span>
                          </p>
                          <p className="text-xs text-muted">
                            Identity from Raider.IO link · verified by Blizzard
                          </p>

                          {row.createStatus !== "added" ? (
                            <>
                              <label className="block text-sm">
                                <span className="mb-1 block text-muted">Primary specialization</span>
                                <select
                                  aria-label={`Primary specialization for ${row.name}`}
                                  value={row.specialization}
                                  disabled={isDuplicate || row.alreadyOwned || pending}
                                  onChange={(event) =>
                                    changeRowPrimarySpec(row.id, event.target.value)
                                  }
                                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                                >
                                  <option value="">Select…</option>
                                  {specs.map((spec) => (
                                    <option key={spec.name} value={spec.name}>
                                      {spec.name} — {CHARACTER_ROLE_LABELS[spec.role]}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {row.specialization && additionalOptions.length > 0 ? (
                                <fieldset className="space-y-2">
                                  <legend className="text-sm text-muted">
                                    Other playable specializations
                                  </legend>
                                  <ul className="space-y-1.5">
                                    {additionalOptions.map((option) => {
                                      const checked = row.playableSpecs.includes(option.name);
                                      return (
                                        <li key={option.name}>
                                          <label className="flex items-center gap-2 text-sm">
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              disabled={
                                                isDuplicate || row.alreadyOwned || pending
                                              }
                                              onChange={(event) =>
                                                toggleRowPlayableSpec(
                                                  row.id,
                                                  option.name,
                                                  event.target.checked,
                                                )
                                              }
                                            />
                                            <span>
                                              {option.name}
                                              {option.role ? (
                                                <span className="text-muted">
                                                  {" "}
                                                  — {CHARACTER_ROLE_LABELS[option.role]}
                                                </span>
                                              ) : null}
                                            </span>
                                          </label>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </fieldset>
                              ) : null}
                              <p className="text-sm">
                                <span className="text-muted">Primary role </span>
                                <span className="font-medium">
                                  {derivedRole ? CHARACTER_ROLE_LABELS[derivedRole] : "—"}
                                </span>
                              </p>
                              {(() => {
                                const options = offspecOptionsFor({
                                  wowClass: row.wowClass,
                                  specialization: row.specialization,
                                  playableSpecs: row.playableSpecs,
                                });
                                if (options.length === 0) return null;
                                return (
                                  <fieldset className="space-y-2">
                                    <legend className="text-sm text-muted">Offspec roles</legend>
                                    <ul className="space-y-1.5">
                                      {options.map((role) => {
                                        const checked = row.offspecRoles.includes(role);
                                        return (
                                          <li key={role}>
                                            <label className="flex items-center gap-2 text-sm">
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                disabled={
                                                  isDuplicate || row.alreadyOwned || pending
                                                }
                                                onChange={(event) =>
                                                  toggleRowOffspecRole(
                                                    row.id,
                                                    role,
                                                    event.target.checked,
                                                  )
                                                }
                                              />
                                              <span>{CHARACTER_ROLE_LABELS[role]}</span>
                                            </label>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </fieldset>
                                );
                              })()}
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={lookingUp || pending || rowsNeedingLookup(rows).length === 0}
                  onClick={() => void runBulkLookup()}
                >
                  {lookingUp ? "Looking up…" : "Look up characters"}
                </Button>
              </div>
              {rows.length >= RAIDER_IO_BULK_MAX && rows.every((row) => row.url.trim() !== "") ? (
                <p className="text-xs text-muted">Maximum {RAIDER_IO_BULK_MAX} characters per batch.</p>
              ) : null}

              <div className="flex justify-end gap-2 border-t border-border px-4 py-3 -mx-4 -mb-4 mt-4">
                <Button type="button" variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || !readyToBulkAdd}>
                  {pending ? "Adding…" : addButtonLabel}
                </Button>
              </div>
            </form>
          ) : (
            <form className="space-y-3 px-4 py-4" onSubmit={submitEdit}>
              {error ? (
                <p
                  id={errorId}
                  role="alert"
                  className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
                >
                  {error}
                </p>
              ) : null}
              {success ? (
                <p
                  role="status"
                  className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm"
                >
                  {success}
                </p>
              ) : null}

              <label className="block text-sm">
                <span className="mb-1 block text-muted">Name</span>
                <input
                  name="name"
                  autoComplete="off"
                  value={identity.name}
                  onChange={(event) =>
                    setIdentity((current) => ({ ...current, name: event.target.value }))
                  }
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Realm</span>
                <input
                  name="realm"
                  autoComplete="off"
                  value={identity.realm}
                  onChange={(event) =>
                    setIdentity((current) => ({ ...current, realm: event.target.value }))
                  }
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Region</span>
                <select
                  aria-label="Region"
                  value={identity.region}
                  onChange={(event) =>
                    setIdentity((current) => ({
                      ...current,
                      region: event.target.value as WowRegion,
                    }))
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="mb-1 block text-xs text-muted">Class</span>
                  <p className="text-sm font-medium">
                    {editClass ? CLASS_LABELS[editClass] : "Unknown"}{" "}
                    <span className="text-xs font-normal text-muted">(Blizzard)</span>
                  </p>
                </div>
                <div>
                  <span className="mb-1 block text-xs text-muted">Item level</span>
                  <p className="text-sm font-medium">
                    {typeof editItemLevel === "number" ? editItemLevel : "Unknown"}{" "}
                    <span className="text-xs font-normal text-muted">(Blizzard)</span>
                  </p>
                </div>
              </div>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Primary specialization</span>
                <select
                  aria-label="Primary specialization"
                  value={specialization}
                  onChange={(event) => changeEditPrimarySpec(event.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                >
                  <option value="">Select…</option>
                  {editSpecs.map((spec) => (
                    <option key={spec.name} value={spec.name}>
                      {spec.name} — {CHARACTER_ROLE_LABELS[spec.role]}
                    </option>
                  ))}
                </select>
              </label>
              {specialization && editAdditionalOptions.length > 0 ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm text-muted">Other playable specializations</legend>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-xs text-accent underline-offset-2 hover:underline"
                      onClick={() =>
                        setPlayableSpecs(editAdditionalOptions.map((option) => option.name))
                      }
                    >
                      Select all remaining specs
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted underline-offset-2 hover:underline"
                      onClick={() => setPlayableSpecs([])}
                    >
                      Clear additional
                    </button>
                  </div>
                  <ul className="space-y-1.5">
                    {editAdditionalOptions.map((option) => {
                      const checked = playableSpecs.includes(option.name);
                      return (
                        <li key={option.name}>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                toggleEditPlayableSpec(option.name, event.target.checked)
                              }
                            />
                            <span>
                              {option.name}
                              {option.role ? (
                                <span className="text-muted">
                                  {" "}
                                  — {CHARACTER_ROLE_LABELS[option.role]}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              ) : null}
              <p className="text-sm">
                <span className="text-muted">Primary role </span>
                <span className="font-medium">
                  {editDerivedRole ? CHARACTER_ROLE_LABELS[editDerivedRole] : "—"}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  Signup roles come only from the specializations you configure here, and only if
                  your account has the Booster role. Preferred offspecs guide Auto Build; they are
                  optional.
                </span>
              </p>
              {editOffspecOptions.length > 0 ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm text-muted">Offspec roles</legend>
                  <ul className="space-y-1.5">
                    {editOffspecOptions.map((role) => {
                      const checked = offspecRoles.includes(role);
                      return (
                        <li key={role}>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                toggleEditOffspecRole(role, event.target.checked)
                              }
                            />
                            <span>{CHARACTER_ROLE_LABELS[role]}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              ) : null}

              <div className="flex justify-end gap-2 border-t border-border px-4 py-3 -mx-4 -mb-4 mt-4">
                <Button type="button" variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || !specialization}>
                  {pending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>
          )}
        </dialog>
      ) : null}
    </>
  );
}
