"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { saveExternalBoostersAction } from "@/controllers/roster.actions";
import { Button } from "@/components/ui/button";
import { ClassIcon } from "@/components/ui/badges";
import { CHARACTER_ROLE_LABELS, CLASS_COLORS, CLASS_LABELS } from "@/lib/labels";
import {
  EXTERNAL_BOOSTERS_MAX_PER_ROSTER,
  EXTERNAL_BOOSTER_NAME_MAX_LENGTH,
  externalBoosterInputError,
  type ExternalBooster,
} from "@/lib/external-booster";
import {
  appendStagedExternalBooster,
  applyStagedExternalBoosterEdit,
  externalBoostersStagedUnchanged,
  preferredRoleForClass,
  removeStagedExternalBooster,
  roleAfterTypeChange,
  stagedExternalBoostersForSave,
  toStagedExternalBoosters,
  type StagedExternalBooster,
} from "@/lib/external-booster-staging";
import { rolesForClass } from "@/lib/wow-specializations";
import { WOW_CLASSES, type CharacterRole, type ParticipationType, type WowClass } from "@/models/enums";

type EditDraft = {
  name: string;
  wowClass: WowClass;
  kind: ParticipationType;
  role: CharacterRole;
};

/**
 * Boosters without a website account (e.g. in-house helpers): edited here and
 * saved on their own. They count toward the role targets and show up as
 * `@name <class>` in the Discord roster and Final Setup — no DMs, attendance
 * or payouts. Saving reloads the page, so unsaved Roster builder edits are lost.
 */
export function ExternalBoostersDialog({
  runId,
  rosterVersion,
  boosters,
  onClose,
}: {
  runId: string;
  rosterVersion: number;
  boosters: ExternalBooster[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedExternalBooster[]>(() => toStagedExternalBoosters(boosters));
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [name, setName] = useState("");
  const [wowClass, setWowClass] = useState<WowClass>("MAGE");
  const [kind, setKind] = useState<ParticipationType>("BOOSTER");
  const [role, setRole] = useState<CharacterRole>(() => preferredRoleForClass("MAGE"));
  const classRoles = rolesForClass(wowClass);
  const editClassRoles = editDraft ? rolesForClass(editDraft.wowClass) : [];

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

  function changeClass(next: WowClass) {
    setWowClass(next);
    setRole((current) => preferredRoleForClass(next, current));
  }

  function startEdit(booster: StagedExternalBooster) {
    if (pending || editingKey) return;
    setError(null);
    setEditingKey(booster.key);
    setEditDraft({
      name: booster.name,
      wowClass: booster.wowClass,
      kind: booster.participationType ?? "BOOSTER",
      role: booster.role ?? preferredRoleForClass(booster.wowClass),
    });
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditDraft(null);
    setError(null);
  }

  function changeEditClass(next: WowClass) {
    setEditDraft((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        wowClass: next,
        role: preferredRoleForClass(next, previous.kind === "BOOSTER" ? previous.role : null),
      };
    });
  }

  function changeEditKind(next: ParticipationType) {
    setEditDraft((previous) => {
      if (!previous) return previous;
      const nextRole = roleAfterTypeChange(next, previous.wowClass, previous.role);
      return {
        ...previous,
        kind: next,
        role: nextRole ?? preferredRoleForClass(previous.wowClass),
      };
    });
  }

  function applyEdit() {
    if (!editingKey || !editDraft) return;
    const input = {
      name: editDraft.name,
      wowClass: editDraft.wowClass,
      participationType: editDraft.kind,
      role: editDraft.kind === "LOOTBUDDY" ? null : editDraft.role,
    };
    const { next, error: problem } = applyStagedExternalBoosterEdit(staged, editingKey, input);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStaged(next);
    setEditingKey(null);
    setEditDraft(null);
  }

  function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingKey) {
      setError("Finish or cancel the open edit before adding another entry.");
      return;
    }
    const input = { name, wowClass, participationType: kind, role: kind === "LOOTBUDDY" ? null : role };
    const problem = externalBoosterInputError(input);
    if (problem) {
      setError(problem);
      return;
    }
    if (staged.length >= EXTERNAL_BOOSTERS_MAX_PER_ROSTER) {
      setError(`A roster can have at most ${EXTERNAL_BOOSTERS_MAX_PER_ROSTER} external boosters.`);
      return;
    }
    setError(null);
    setStaged((previous) => appendStagedExternalBooster(previous, input, crypto.randomUUID()));
    setName("");
  }

  function save() {
    if (editingKey) {
      setError("Finish or cancel the open edit before saving.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveExternalBoostersAction({
        runId,
        version: rosterVersion,
        externalBoosters: stagedExternalBoostersForSave(staged),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      close();
      window.location.reload();
    });
  }

  const unchanged = externalBoostersStagedUnchanged(staged, boosters);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(34rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/60"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          External boosters
        </h2>
        <p className="mt-1 text-xs text-muted">
          Boosters and lootbuddies without a website account. Boosters fill a Tank/Healer/DPS slot, lootbuddies count
          as lootbuddies. Both appear as @name with their class in the Discord roster and Final Setup. No DMs,
          attendance or payouts.
        </p>
      </div>
      <div className="space-y-3 px-4 py-4 text-sm">
        {error ? (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
            {error}
          </p>
        ) : null}
        {staged.length === 0 ? (
          <p className="text-muted">No external boosters yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {staged.map((booster) => {
              const isEditing = editingKey === booster.key && editDraft != null;
              if (isEditing && editDraft) {
                return (
                  <li key={booster.key} className="space-y-2 px-3 py-2">
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
                      <label className="block">
                        <span className="mb-1 block text-xs text-muted">Name (e.g. Discord name)</span>
                        <input
                          value={editDraft.name}
                          onChange={(event) =>
                            setEditDraft((previous) => (previous ? { ...previous, name: event.target.value } : previous))
                          }
                          maxLength={EXTERNAL_BOOSTER_NAME_MAX_LENGTH + 1}
                          className="h-9 w-full rounded-md border border-border bg-surface-raised px-2"
                          disabled={pending}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs text-muted">Class</span>
                        <select
                          value={editDraft.wowClass}
                          onChange={(event) => changeEditClass(event.target.value as WowClass)}
                          className="h-9 w-full rounded-md border border-border bg-surface-raised px-2"
                          disabled={pending}
                        >
                          {WOW_CLASSES.map((option) => (
                            <option key={option} value={option}>
                              {CLASS_LABELS[option]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs text-muted">Type</span>
                        <select
                          value={editDraft.kind}
                          onChange={(event) => changeEditKind(event.target.value as ParticipationType)}
                          className="h-9 w-full rounded-md border border-border bg-surface-raised px-2"
                          disabled={pending}
                        >
                          <option value="BOOSTER">Booster</option>
                          <option value="LOOTBUDDY">Lootbuddy</option>
                        </select>
                      </label>
                      {editDraft.kind === "BOOSTER" ? (
                        <label className="block">
                          <span className="mb-1 block text-xs text-muted">Role</span>
                          <select
                            value={editDraft.role}
                            onChange={(event) =>
                              setEditDraft((previous) =>
                                previous ? { ...previous, role: event.target.value as CharacterRole } : previous,
                              )
                            }
                            className="h-9 w-full rounded-md border border-border bg-surface-raised px-2"
                            disabled={pending}
                          >
                            {editClassRoles.map((option) => (
                              <option key={option} value={option}>
                                {CHARACTER_ROLE_LABELS[option]}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <span aria-hidden="true" />
                      )}
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="secondary" className="h-8" disabled={pending} onClick={cancelEdit}>
                        Cancel
                      </Button>
                      <Button type="button" className="h-8" disabled={pending} onClick={applyEdit}>
                        Apply
                      </Button>
                    </div>
                  </li>
                );
              }

              return (
                <li key={booster.key} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <ClassIcon wowClass={booster.wowClass} size={18} />
                  <span className="font-medium" style={{ color: CLASS_COLORS[booster.wowClass] }}>
                    @{booster.name}
                  </span>
                  <span className="text-muted">
                    {CLASS_LABELS[booster.wowClass]} ·{" "}
                    {booster.participationType === "LOOTBUDDY" || !booster.role
                      ? "Lootbuddy"
                      : CHARACTER_ROLE_LABELS[booster.role]}
                  </span>
                  <div className="ml-auto flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8"
                      disabled={pending || editingKey !== null}
                      onClick={() => startEdit(booster)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8"
                      disabled={pending || editingKey !== null}
                      onClick={() => {
                        setStaged((previous) => removeStagedExternalBooster(previous, booster.key));
                        setError(null);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Name (e.g. Discord name)</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={EXTERNAL_BOOSTER_NAME_MAX_LENGTH + 1}
              className="h-9 w-full rounded-md border border-border bg-surface-raised px-2"
              placeholder="dawn"
              disabled={pending || editingKey !== null}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Class</span>
            <select
              value={wowClass}
              onChange={(event) => changeClass(event.target.value as WowClass)}
              className="h-9 w-full rounded-md border border-border bg-surface-raised px-2"
              disabled={pending || editingKey !== null}
            >
              {WOW_CLASSES.map((option) => (
                <option key={option} value={option}>
                  {CLASS_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Type</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as ParticipationType)}
              className="h-9 w-full rounded-md border border-border bg-surface-raised px-2"
              disabled={pending || editingKey !== null}
            >
              <option value="BOOSTER">Booster</option>
              <option value="LOOTBUDDY">Lootbuddy</option>
            </select>
          </label>
          {kind === "BOOSTER" ? (
            <label className="block">
              <span className="mb-1 block text-xs text-muted">Role</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as CharacterRole)}
                className="h-9 w-full rounded-md border border-border bg-surface-raised px-2"
                disabled={pending || editingKey !== null}
              >
                {classRoles.map((option) => (
                  <option key={option} value={option}>
                    {CHARACTER_ROLE_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span aria-hidden="true" />
          )}
          <Button type="submit" variant="secondary" disabled={pending || editingKey !== null}>
            Add
          </Button>
        </form>
        <p className="text-xs text-muted">Saving reloads the page. Save open Roster changes first.</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button type="button" variant="secondary" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={pending || unchanged || editingKey !== null}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </dialog>
  );
}
