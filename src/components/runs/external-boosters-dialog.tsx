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
  normalizeExternalBoosterName,
  type ExternalBooster,
  type ExternalBoosterInput,
} from "@/lib/external-booster";
import { rolesForClass } from "@/lib/wow-specializations";
import { WOW_CLASSES, type CharacterRole, type ParticipationType, type WowClass } from "@/models/enums";

type StagedBooster = ExternalBoosterInput & { key: string };

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
  const [staged, setStaged] = useState<StagedBooster[]>(() =>
    boosters.map(({ id, ...booster }) => ({ ...booster, key: id })),
  );
  const [name, setName] = useState("");
  const [wowClass, setWowClass] = useState<WowClass>("MAGE");
  const [kind, setKind] = useState<ParticipationType>("BOOSTER");
  const [role, setRole] = useState<CharacterRole>("DPS");
  const classRoles = rolesForClass(wowClass);

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
    const roles = rolesForClass(next);
    if (!roles.includes(role)) setRole(roles.includes("DPS") ? "DPS" : roles[0]!);
  }

  function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    setStaged((previous) => [
      ...previous,
      { ...input, name: normalizeExternalBoosterName(name), key: crypto.randomUUID() },
    ]);
    setName("");
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveExternalBoostersAction({
        runId,
        version: rosterVersion,
        externalBoosters: staged.map((booster) => ({
          name: booster.name,
          wowClass: booster.wowClass,
          participationType: booster.participationType ?? "BOOSTER",
          role: booster.role,
        })),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      close();
      window.location.reload();
    });
  }

  const unchanged =
    staged.length === boosters.length &&
    staged.every(
      (booster, index) =>
        booster.name === boosters[index]!.name &&
        booster.wowClass === boosters[index]!.wowClass &&
        (booster.participationType ?? "BOOSTER") === boosters[index]!.participationType &&
        booster.role === boosters[index]!.role,
    );

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
            {staged.map((booster) => (
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
                <Button
                  type="button"
                  variant="ghost"
                  className="ml-auto h-8"
                  disabled={pending}
                  onClick={() => setStaged((previous) => previous.filter((item) => item.key !== booster.key))}
                >
                  Remove
                </Button>
              </li>
            ))}
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
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Class</span>
            <select
              value={wowClass}
              onChange={(event) => changeClass(event.target.value as WowClass)}
              className="h-9 w-full rounded-md border border-border bg-surface-raised px-2"
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
          <Button type="submit" variant="secondary" disabled={pending}>
            Add
          </Button>
        </form>
        <p className="text-xs text-muted">Saving reloads the page. Save open Roster changes first.</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button type="button" variant="secondary" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={pending || unchanged}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </dialog>
  );
}
