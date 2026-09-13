"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getSignupOptionsAction, setCharacterOffersAction, setLootbuddiesAction } from "@/controllers/signup.actions";
import { Button } from "@/components/ui/button";
import { DifficultyBadge } from "@/components/ui/badges";
import { formatDateTime } from "@/lib/datetime";
import {
  CHARACTER_ROLE_LABELS,
  CLASS_LABELS,
  DIFFICULTY_ABBREVIATIONS,
  LOOTBUDDY_MODE_LABELS,
  LOOTBUDDY_VERIFICATION_LABELS,
} from "@/lib/labels";
import {
  CHARACTER_ROLES,
  LOOTBUDDY_MODES,
  LOOTBUDDY_VERIFICATIONS,
  WOW_CLASSES,
  type CharacterRole,
  type LootbuddyMode,
  type LootbuddyVerification,
  type WowClass,
} from "@/models/enums";
import type { signupService } from "@/services/signup.service";

type SignupOptions = Awaited<ReturnType<typeof signupService.getSignupOptions>>;

type RaidSaveInfo = SignupOptions["booster"]["eligible"][number]["raidSave"];

type BoosterGroup = {
  characterId: string;
  characterName: string;
  realm: string;
  wowClass: WowClass;
  specialization: string | null;
  /** Every role this Character's class can perform — the role choice is bounded to this set, never just one. */
  roles: CharacterRole[];
  /** Specialization-derived default for a brand-new selection; null when specialization is missing/unrecognized. */
  defaultRole: CharacterRole | null;
  /** Informational raid-save progress for this run's raid/difficulty/reset — never affects selectability. */
  raidSave: RaidSaveInfo;
};

type LootbuddyEntry = {
  /** Present = an existing owned row being edited; absent = a new entry not yet saved. */
  signupId?: string;
  wowClass: WowClass;
  mode: LootbuddyMode;
  verification: LootbuddyVerification;
};

/** Canonical TANK/HEALER/DPS order for a role dropdown, regardless of a class's own spec-list order. */
function orderedRoles(roles: CharacterRole[]): CharacterRole[] {
  return CHARACTER_ROLES.filter((role) => roles.includes(role));
}

/** "HC 8/8 · Saved" — informational only, never a reason a Character can't be offered. */
function formatRaidSave(raidSave: RaidSaveInfo): string | null {
  if (!raidSave) return null;
  return `${DIFFICULTY_ABBREVIATIONS[raidSave.difficulty]} ${raidSave.bossesDefeated}/${raidSave.totalBossCount} · Saved`;
}

function groupBoosterOptions(eligible: SignupOptions["booster"]["eligible"]): BoosterGroup[] {
  return eligible.map((option) => ({
    characterId: option.characterId,
    characterName: option.characterName,
    realm: option.realm,
    wowClass: option.wowClass,
    specialization: option.specialization,
    roles: option.roles,
    defaultRole: option.defaultRole,
    raidSave: option.raidSave,
  }));
}

function toLootbuddyEntries(active: SignupOptions["activeLootbuddies"]): LootbuddyEntry[] {
  return active.map((item) => ({
    signupId: item.signupId,
    wowClass: item.wowClass ?? WOW_CLASSES[0],
    mode: item.mode,
    verification: item.verification,
  }));
}

/**
 * A User may hold BOOSTER participation and any number of LOOTBUDDY entries
 * on the same Run at once — the two sections below submit independently
 * (`setCharacterOffersAction` / `setLootbuddiesAction`), so saving one never
 * withdraws the other.
 */
export function RunSignupButton({
  runId,
  signupWindowOpen,
  ownSignupCount,
}: {
  runId: string;
  signupWindowOpen: boolean;
  ownSignupCount: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();
  const [options, setOptions] = useState<SignupOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(new Set());
  const [roleByCharacterId, setRoleByCharacterId] = useState<Record<string, CharacterRole>>({});
  const [lootbuddies, setLootbuddies] = useState<LootbuddyEntry[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [boosterPending, startBoosterTransition] = useTransition();
  const [lootbuddyPending, startLootbuddyTransition] = useTransition();

  const boosterGroups = useMemo(
    () => (options ? groupBoosterOptions(options.booster.eligible) : []),
    [options],
  );

  async function openDialog() {
    setError(null);
    setSuccess(null);
    setDialogOpen(true);
    const result = await getSignupOptionsAction({ runId });
    if (!result.ok || !result.data) {
      setError(result.message);
      return;
    }
    setOptions(result.data);
    setSelectedCharacterIds(new Set(result.data.activeBoosterOffers.characterIds));
    // Existing persisted RunSignup.role wins over the specialization default —
    // the User explicitly chose this role for this Run; reopening the dialog
    // must never silently revert it.
    setRoleByCharacterId({ ...result.data.activeBoosterOffers.roleByCharacterId } as Record<string, CharacterRole>);
    setLootbuddies(toLootbuddyEntries(result.data.activeLootbuddies));
  }

  function closeDialog() {
    dialogRef.current?.close();
    setDialogOpen(false);
  }

  useEffect(() => {
    if (!dialogOpen) return;
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setDialogOpen(false);
      setOptions(null);
      setError(null);
      setSuccess(null);
      setSelectedCharacterIds(new Set());
      setRoleByCharacterId({});
      setLootbuddies([]);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [dialogOpen]);

  /**
   * When a Character first becomes selected, initialize its role from the
   * specialization-derived default — never from class order, never a single
   * global role. A Character re-checked after being unchecked keeps whatever
   * role it already had in this dialog session.
   */
  function toggleBoosterCharacter(characterId: string) {
    setSelectedCharacterIds((current) => {
      const next = new Set(current);
      if (next.has(characterId)) {
        next.delete(characterId);
      } else {
        next.add(characterId);
      }
      return next;
    });
    setRoleByCharacterId((current) => {
      if (current[characterId]) return current;
      const group = boosterGroups.find((item) => item.characterId === characterId);
      return group?.defaultRole ? { ...current, [characterId]: group.defaultRole } : current;
    });
  }

  function setBoosterRole(characterId: string, role: CharacterRole) {
    setRoleByCharacterId((current) => ({ ...current, [characterId]: role }));
  }

  /** Each newly-selected Character is initialized independently: its own existing role or its own specialization default — never one role for the whole batch. */
  function selectAllEligibleBooster() {
    setSelectedCharacterIds(new Set(boosterGroups.map((group) => group.characterId)));
    setRoleByCharacterId((current) => {
      const next = { ...current };
      for (const group of boosterGroups) {
        if (!next[group.characterId] && group.defaultRole) {
          next[group.characterId] = group.defaultRole;
        }
      }
      return next;
    });
  }

  function submitBooster() {
    setError(null);
    const missingRole = [...selectedCharacterIds].find((characterId) => !roleByCharacterId[characterId]);
    if (missingRole) {
      const group = boosterGroups.find((item) => item.characterId === missingRole);
      setError(`Choose a role for ${group?.characterName ?? "the selected character"}.`);
      return;
    }

    startBoosterTransition(async () => {
      const offers = [...selectedCharacterIds].map((characterId) => ({
        characterId,
        role: roleByCharacterId[characterId],
      }));
      const result = await setCharacterOffersAction({ runId, offers });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message);
      router.refresh();
    });
  }

  function addLootbuddy() {
    setLootbuddies((current) => [...current, { wowClass: WOW_CLASSES[0], mode: "LOOT_ONLY", verification: "NONE" }]);
  }

  function removeLootbuddy(index: number) {
    setLootbuddies((current) => current.filter((_, i) => i !== index));
  }

  function updateLootbuddy(index: number, patch: Partial<LootbuddyEntry>) {
    setLootbuddies((current) => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  }

  function submitLootbuddies() {
    setError(null);
    startLootbuddyTransition(async () => {
      const result = await setLootbuddiesAction({
        runId,
        lootbuddies: lootbuddies.map((entry) => ({
          signupId: entry.signupId,
          wowClass: entry.wowClass,
          mode: entry.mode,
          verification: entry.verification,
        })),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message);
      router.refresh();
    });
  }

  const label = ownSignupCount > 0 ? `Signed ×${ownSignupCount}` : "Sign up";

  return (
    <>
      {signupWindowOpen ? (
        <Button type="button" variant={ownSignupCount > 0 ? "secondary" : "primary"} className="h-8 px-2 text-xs" onClick={() => void openDialog()}>
          {label}
        </Button>
      ) : ownSignupCount > 0 ? (
        <span className="text-xs text-muted">{label}</span>
      ) : (
        <span className="text-xs text-muted">Closed</span>
      )}
      {dialogOpen ? (
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="fixed left-1/2 top-[8vh] m-0 w-[min(34rem,calc(100vw-2rem))] max-h-[min(84vh,44rem)] -translate-x-1/2 overflow-y-auto rounded-md border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/60"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold">
            Sign up
          </h2>
          {options ? (
            <p className="mt-1 truncate text-sm text-muted">
              {options.run.title} · {options.run.raidName} · {formatDateTime(options.run.scheduledStartAt)}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">Loading options…</p>
          )}
        </div>
        {options ? (
          <div className="space-y-5 px-4 py-4">
            <div className="flex items-center gap-2">
              <DifficultyBadge difficulty={options.run.difficulty} />
              {!options.run.signupWindowOpen ? (
                <span className="text-xs text-danger">Signups are closed. You may still remove offers.</span>
              ) : null}
            </div>

            <section className="space-y-3 rounded-md border border-border p-3">
              <h3 className="text-sm font-semibold">Booster</h3>
              <BoosterCharacterChecklist
                groups={boosterGroups}
                ineligible={options.booster.ineligible}
                selected={selectedCharacterIds}
                roleByCharacterId={roleByCharacterId}
                onToggle={toggleBoosterCharacter}
                onRoleChange={setBoosterRole}
                onSelectAll={selectAllEligibleBooster}
              />
              {selectedCharacterIds.size === 0 ? (
                <p className="text-xs text-muted">No characters selected — saving will clear your booster signup on this run.</p>
              ) : null}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={boosterPending || (selectedCharacterIds.size > 0 && !options.run.signupWindowOpen)}
                  onClick={submitBooster}
                >
                  {boosterPending ? "Saving…" : "Save Booster Offers"}
                </Button>
              </div>
            </section>

            <section className="space-y-3 rounded-md border border-border p-3">
              <h3 className="text-sm font-semibold">Lootbuddies</h3>
              <p className="text-xs text-muted">No character required — coexists with your Booster signup above.</p>
              <LootbuddyEntryEditor
                entries={lootbuddies}
                onAdd={addLootbuddy}
                onRemove={removeLootbuddy}
                onChange={updateLootbuddy}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={lootbuddyPending || (lootbuddies.some((entry) => !entry.signupId) && !options.run.signupWindowOpen)}
                  onClick={submitLootbuddies}
                >
                  {lootbuddyPending ? "Saving…" : "Save Lootbuddies"}
                </Button>
              </div>
            </section>

            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            {success ? (
              <p role="status" className="text-sm text-success">
                {success}
              </p>
            ) : null}
          </div>
        ) : error ? (
          <p role="alert" className="px-4 py-4 text-sm text-danger">
            {error}
          </p>
        ) : (
          <p className="px-4 py-4 text-sm text-muted">Loading…</p>
        )}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={closeDialog}>
            Close
          </Button>
        </div>
      </dialog>
      ) : null}
    </>
  );
}

function BoosterCharacterChecklist({
  groups,
  ineligible,
  selected,
  roleByCharacterId,
  onToggle,
  onRoleChange,
  onSelectAll,
}: {
  groups: BoosterGroup[];
  ineligible: SignupOptions["booster"]["ineligible"];
  selected: Set<string>;
  roleByCharacterId: Record<string, CharacterRole>;
  onToggle: (characterId: string) => void;
  onRoleChange: (characterId: string, role: CharacterRole) => void;
  onSelectAll: () => void;
}) {
  // Already-selected-elsewhere is shown inline (visible but disabled) rather
  // than tucked into the collapsed "unavailable" details below — the User
  // should see which of their characters is double-booked, and where,
  // without hunting for it. Every other ineligibility reason stays collapsed.
  const reservationBlocked = ineligible.filter((item) => item.reason === "ALREADY_SELECTED_OTHER_RUN");
  const otherIneligible = ineligible.filter((item) => item.reason !== "ALREADY_SELECTED_OTHER_RUN");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">Characters to offer</span>
        {groups.length > 1 ? (
          <button type="button" className="text-xs text-accent hover:underline" onClick={onSelectAll}>
            Select all eligible
          </button>
        ) : null}
      </div>
      {groups.length === 0 && reservationBlocked.length === 0 ? (
        <p className="rounded-md border border-border px-3 py-2 text-sm text-muted">
          {ineligible.length === 0
            ? "No characters on this account yet. Add one on the Characters page, then come back to sign up."
            : "No eligible booster characters for this run. Check access and lockouts, or sign as a lootbuddy below."}
        </p>
      ) : (
        <ul className="space-y-2">
          {groups.map((group) => {
            const isChecked = selected.has(group.characterId);
            const currentRole = roleByCharacterId[group.characterId];
            const raidSaveLabel = formatRaidSave(group.raidSave);
            return (
              <li
                key={group.characterId}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                <label className="flex flex-1 min-w-0 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onToggle(group.characterId)}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">
                      {group.characterName}-{group.realm} · {CLASS_LABELS[group.wowClass]}
                    </span>
                    {raidSaveLabel ? <span className="text-xs text-muted">{raidSaveLabel}</span> : null}
                  </span>
                </label>
                <select
                  aria-label={`Role for ${group.characterName}`}
                  value={currentRole ?? ""}
                  disabled={!isChecked}
                  onChange={(event) => onRoleChange(group.characterId, event.target.value as CharacterRole)}
                  className="h-8 shrink-0 rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-50"
                >
                  {!currentRole ? (
                    <option value="" disabled>
                      Choose a role
                    </option>
                  ) : null}
                  {orderedRoles(group.roles).map((role) => (
                    <option key={role} value={role}>
                      {CHARACTER_ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
          {reservationBlocked.map((item) => (
            <li
              key={item.characterId}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-raised/50 px-3 py-2 opacity-75"
            >
              <div className="flex min-w-0 flex-1 flex-col text-sm">
                <span className="truncate">
                  {item.characterName}-{item.realm}
                </span>
                <span className="text-xs text-danger">
                  Unavailable — already selected for another run
                  {item.conflictingRunTitle ? `: ${item.conflictingRunTitle}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {otherIneligible.length > 0 ? (
        <details className="text-xs text-muted">
          <summary>{otherIneligible.length} character{otherIneligible.length === 1 ? "" : "s"} unavailable</summary>
          <ul className="mt-2 space-y-1">
            {otherIneligible.map((item) => (
              <li key={item.characterId}>
                {item.characterName}-{item.realm}: {item.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Characterless list editor — no Character selector, ever. Each row is a
 * distinct entry identified by its own array position (and, once saved, its
 * `signupId`); adding, editing, and removing one row never touches the
 * others.
 */
function LootbuddyEntryEditor({
  entries,
  onAdd,
  onRemove,
  onChange,
}: {
  entries: LootbuddyEntry[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, patch: Partial<LootbuddyEntry>) => void;
}) {
  return (
    <div className="space-y-2">
      {entries.length === 0 ? (
        <p className="rounded-md border border-border px-3 py-2 text-sm text-muted">
          No lootbuddy entries yet. Add one below — no character required.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry, index) => (
            <li key={entry.signupId ?? `new-${index}`} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
              <span className="w-4 shrink-0 text-xs text-muted">{index + 1}.</span>
              <label className="flex-1 min-w-[8rem] text-sm">
                <span className="sr-only">Class</span>
                <select
                  aria-label={`Class for lootbuddy ${index + 1}`}
                  value={entry.wowClass}
                  onChange={(event) => onChange(index, { wowClass: event.target.value as WowClass })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                >
                  {WOW_CLASSES.map((wowClass) => (
                    <option key={wowClass} value={wowClass}>
                      {CLASS_LABELS[wowClass]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex-1 min-w-[8rem] text-sm">
                <span className="sr-only">Mode</span>
                <select
                  aria-label={`Mode for lootbuddy ${index + 1}`}
                  value={entry.mode}
                  onChange={(event) => onChange(index, { mode: event.target.value as LootbuddyMode })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                >
                  {LOOTBUDDY_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {LOOTBUDDY_MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex-1 min-w-[8rem] text-sm">
                <span className="sr-only">Verification metadata</span>
                <select
                  aria-label={`Verification metadata for lootbuddy ${index + 1}`}
                  value={entry.verification}
                  onChange={(event) => onChange(index, { verification: event.target.value as LootbuddyVerification })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                >
                  {LOOTBUDDY_VERIFICATIONS.map((value) => (
                    <option key={value} value={value}>
                      {LOOTBUDDY_VERIFICATION_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                aria-label={`Remove lootbuddy ${index + 1}`}
                className="text-xs text-danger hover:underline"
                onClick={() => onRemove(index)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="text-xs text-accent hover:underline" onClick={onAdd}>
        + Add Lootbuddy
      </button>
    </div>
  );
}
