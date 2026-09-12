"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getSignupOptionsAction, setCharacterOffersAction } from "@/controllers/signup.actions";
import { Button } from "@/components/ui/button";
import { DifficultyBadge } from "@/components/ui/badges";
import { formatDateTime } from "@/lib/datetime";
import { CHARACTER_ROLE_LABELS, CLASS_LABELS, LOOTBUDDY_MODE_LABELS, LOOTBUDDY_VERIFICATION_LABELS } from "@/lib/labels";
import {
  CHARACTER_ROLES,
  LOOTBUDDY_MODES,
  LOOTBUDDY_VERIFICATIONS,
  type CharacterRole,
  type LootbuddyMode,
  type LootbuddyVerification,
  type WowClass,
} from "@/models/enums";
import type { signupService } from "@/services/signup.service";

type SignupOptions = Awaited<ReturnType<typeof signupService.getSignupOptions>>;
type Participation = "BOOSTER" | "LOOTBUDDY";

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
};

/** Canonical TANK/HEALER/DPS order for a role dropdown, regardless of a class's own spec-list order. */
function orderedRoles(roles: CharacterRole[]): CharacterRole[] {
  return CHARACTER_ROLES.filter((role) => roles.includes(role));
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
  }));
}

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
  const [participation, setParticipation] = useState<Participation>("BOOSTER");
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(new Set());
  const [roleByCharacterId, setRoleByCharacterId] = useState<Record<string, CharacterRole>>({});
  const [mode, setMode] = useState<LootbuddyMode>("LOOT_ONLY");
  const [verification, setVerification] = useState<LootbuddyVerification>("NONE");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, startTransition] = useTransition();

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
    setParticipation(result.data.activeOffer.participationType ?? "BOOSTER");
    setSelectedCharacterIds(new Set(result.data.activeOffer.characterIds));
    // Existing persisted RunSignup.role wins over the specialization default —
    // the User explicitly chose this role for this Run; reopening the dialog
    // must never silently revert it.
    setRoleByCharacterId({ ...result.data.activeOffer.roleByCharacterId } as Record<string, CharacterRole>);
    setMode(result.data.activeOffer.lootbuddyMode ?? "LOOT_ONLY");
    setVerification(result.data.activeOffer.lootbuddyVerification ?? "NONE");
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
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [dialogOpen]);

  function switchParticipation(next: Participation) {
    setParticipation(next);
    setSelectedCharacterIds(new Set());
  }

  function toggleCharacter(characterId: string) {
    setSelectedCharacterIds((current) => {
      const next = new Set(current);
      if (next.has(characterId)) {
        next.delete(characterId);
      } else {
        next.add(characterId);
      }
      return next;
    });
  }

  /**
   * When a Character first becomes selected, initialize its role from the
   * specialization-derived default — never from class order, never a single
   * global role. A Character re-checked after being unchecked keeps whatever
   * role it already had in this dialog session.
   */
  function toggleBoosterCharacter(characterId: string) {
    toggleCharacter(characterId);
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

  function selectAllEligibleLootbuddy() {
    if (!options) return;
    setSelectedCharacterIds(new Set(options.lootbuddy.eligible.map((option) => option.characterId)));
  }

  function submit() {
    setError(null);

    if (participation === "BOOSTER") {
      const missingRole = [...selectedCharacterIds].find((characterId) => !roleByCharacterId[characterId]);
      if (missingRole) {
        const group = boosterGroups.find((item) => item.characterId === missingRole);
        setError(`Choose a role for ${group?.characterName ?? "the selected character"}.`);
        return;
      }
    }

    startTransition(async () => {
      const offers = [...selectedCharacterIds].map((characterId) => ({
        characterId,
        ...(participation === "BOOSTER" ? { role: roleByCharacterId[characterId] } : {}),
      }));

      const result = await setCharacterOffersAction({
        runId,
        participationType: participation,
        offers,
        ...(participation === "LOOTBUDDY" ? { lootbuddyMode: mode, lootbuddyVerification: verification } : {}),
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setSuccess(result.message);
      router.refresh();
      window.setTimeout(() => closeDialog(), 600);
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
        className="fixed left-1/2 top-[8vh] m-0 w-[min(32rem,calc(100vw-2rem))] max-h-[min(84vh,40rem)] -translate-x-1/2 overflow-y-auto rounded-md border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/60"
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
          <div className="space-y-4 px-4 py-4">
            <div className="flex items-center gap-2">
              <DifficultyBadge difficulty={options.run.difficulty} />
              {!options.run.signupWindowOpen ? (
                <span className="text-xs text-danger">Signups are closed. You may still remove offers.</span>
              ) : null}
            </div>
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted">Participation</legend>
              <div className="flex gap-2">
                <ParticipationToggle
                  label="Booster"
                  selected={participation === "BOOSTER"}
                  onSelect={() => switchParticipation("BOOSTER")}
                />
                <ParticipationToggle
                  label="Lootbuddy"
                  selected={participation === "LOOTBUDDY"}
                  onSelect={() => switchParticipation("LOOTBUDDY")}
                />
              </div>
              <p className="text-xs text-muted">
                You may hold only one active participation type on this run. Switching replaces your current offers.
              </p>
            </fieldset>
            {participation === "BOOSTER" ? (
              <BoosterCharacterChecklist
                groups={boosterGroups}
                ineligible={options.booster.ineligible}
                selected={selectedCharacterIds}
                roleByCharacterId={roleByCharacterId}
                onToggle={toggleBoosterCharacter}
                onRoleChange={setBoosterRole}
                onSelectAll={selectAllEligibleBooster}
              />
            ) : (
              <LootbuddyChecklist
                options={options.lootbuddy}
                selected={selectedCharacterIds}
                onToggle={toggleCharacter}
                onSelectAll={selectAllEligibleLootbuddy}
                mode={mode}
                verification={verification}
                onModeChange={setMode}
                onVerificationChange={setVerification}
              />
            )}
            {selectedCharacterIds.size === 0 ? (
              <p className="text-xs text-muted">No characters selected — submitting will clear your signup on this run.</p>
            ) : null}
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
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || !options || (selectedCharacterIds.size > 0 && !options.run.signupWindowOpen)}
            onClick={submit}
          >
            {pending ? "Saving…" : "Save offers"}
          </Button>
        </div>
      </dialog>
      ) : null}
    </>
  );
}

function ParticipationToggle({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`h-8 rounded-md border px-3 text-sm ${
        selected ? "border-accent bg-accent/15 text-accent" : "border-border text-muted hover:bg-surface-raised"
      }`}
    >
      {label}
    </button>
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
            : "No eligible booster characters for this run. Switch to Lootbuddy or check access and lockouts."}
        </p>
      ) : (
        <ul className="space-y-2">
          {groups.map((group) => {
            const isChecked = selected.has(group.characterId);
            const currentRole = roleByCharacterId[group.characterId];
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
                  <span className="truncate">
                    {group.characterName}-{group.realm} · {CLASS_LABELS[group.wowClass]}
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

function LootbuddyChecklist({
  options,
  selected,
  onToggle,
  onSelectAll,
  mode,
  verification,
  onModeChange,
  onVerificationChange,
}: {
  options: SignupOptions["lootbuddy"];
  selected: Set<string>;
  onToggle: (characterId: string) => void;
  onSelectAll: () => void;
  mode: LootbuddyMode;
  verification: LootbuddyVerification;
  onModeChange: (value: LootbuddyMode) => void;
  onVerificationChange: (value: LootbuddyVerification) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">Characters to offer</span>
        {options.eligible.length > 1 ? (
          <button type="button" className="text-xs text-accent hover:underline" onClick={onSelectAll}>
            Select all eligible
          </button>
        ) : null}
      </div>
      {options.eligible.length === 0 ? (
        <p className="rounded-md border border-border px-3 py-2 text-sm text-muted">
          {options.ineligible.length === 0
            ? "No characters on this account yet. Add one on the Characters page, then come back to sign up."
            : "No loot-eligible characters available for this run."}
        </p>
      ) : (
        <ul className="space-y-2">
          {options.eligible.map((option) => (
            <li key={option.characterId} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <label className="flex flex-1 min-w-0 items-center gap-2 text-sm">
                <input type="checkbox" checked={selected.has(option.characterId)} onChange={() => onToggle(option.characterId)} />
                <span className="truncate">
                  {option.characterName}-{option.realm} · {CLASS_LABELS[option.wowClass]}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Mode</span>
        <select
          aria-label="Lootbuddy mode"
          value={mode}
          onChange={(event) => onModeChange(event.target.value as LootbuddyMode)}
          className="h-9 w-full rounded-md border border-border bg-surface px-2"
        >
          {LOOTBUDDY_MODES.map((value) => (
            <option key={value} value={value}>
              {LOOTBUDDY_MODE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Verification metadata</span>
        <select
          aria-label="Lootbuddy verification metadata"
          value={verification}
          onChange={(event) => onVerificationChange(event.target.value as LootbuddyVerification)}
          className="h-9 w-full rounded-md border border-border bg-surface px-2"
        >
          {LOOTBUDDY_VERIFICATIONS.map((value) => (
            <option key={value} value={value}>
              {LOOTBUDDY_VERIFICATION_LABELS[value]}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-muted">
          Access/Trial is signup metadata in this phase, not an approval workflow.
        </span>
      </label>
      {options.ineligible.length > 0 ? (
        <details className="text-xs text-muted">
          <summary>{options.ineligible.length} character{options.ineligible.length === 1 ? "" : "s"} unavailable</summary>
          <ul className="mt-2 space-y-1">
            {options.ineligible.map((item) => (
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
