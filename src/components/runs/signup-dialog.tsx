"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createBoosterSignupAction,
  createLootbuddySignupAction,
  getSignupOptionsAction,
} from "@/controllers/signup.actions";
import { Button } from "@/components/ui/button";
import { DifficultyBadge } from "@/components/ui/badges";
import { formatDateTime } from "@/lib/datetime";
import { CHARACTER_ROLE_LABELS, CLASS_LABELS, LOOTBUDDY_MODE_LABELS, LOOTBUDDY_VERIFICATION_LABELS } from "@/lib/labels";
import { LOOTBUDDY_MODES, LOOTBUDDY_VERIFICATIONS, type CharacterRole, type LootbuddyMode, type LootbuddyVerification } from "@/models/enums";
import type { signupService } from "@/services/signup.service";

type SignupOptions = Awaited<ReturnType<typeof signupService.getSignupOptions>>;
type Participation = "BOOSTER" | "LOOTBUDDY";

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
  const [characterRole, setCharacterRole] = useState("");
  const [lootbuddyCharacterId, setLootbuddyCharacterId] = useState("");
  const [isBackup, setIsBackup] = useState(false);
  const [mode, setMode] = useState<LootbuddyMode>("LOOT_ONLY");
  const [verification, setVerification] = useState<LootbuddyVerification>("NONE");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, startTransition] = useTransition();

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
    setCharacterRole(
      result.data.booster.eligible[0]
        ? `${result.data.booster.eligible[0].characterId}:${result.data.booster.eligible[0].role}`
        : "",
    );
    setLootbuddyCharacterId(result.data.lootbuddy.eligible[0]?.characterId ?? "");
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
      setIsBackup(false);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [dialogOpen]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result =
        participation === "BOOSTER"
          ? await createBoosterSignupAction(parseBoosterSelection(characterRole, isBackup, runId))
          : await createLootbuddySignupAction({
              runId,
              characterId: lootbuddyCharacterId,
              mode,
              verification,
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
                <span className="text-xs text-danger">Signups are closed.</span>
              ) : null}
            </div>
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted">Participation</legend>
              <div className="flex gap-2">
                <ParticipationToggle
                  label="Booster"
                  selected={participation === "BOOSTER"}
                  onSelect={() => setParticipation("BOOSTER")}
                />
                <ParticipationToggle
                  label="Lootbuddy"
                  selected={participation === "LOOTBUDDY"}
                  onSelect={() => setParticipation("LOOTBUDDY")}
                />
              </div>
            </fieldset>
            {participation === "BOOSTER" ? (
              <BoosterFields
                options={options.booster}
                value={characterRole}
                isBackup={isBackup}
                onValueChange={setCharacterRole}
                onBackupChange={setIsBackup}
              />
            ) : (
              <LootbuddyFields
                options={options.lootbuddy}
                characterId={lootbuddyCharacterId}
                mode={mode}
                verification={verification}
                onCharacterChange={setLootbuddyCharacterId}
                onModeChange={setMode}
                onVerificationChange={setVerification}
              />
            )}
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
            disabled={
              pending ||
              !options?.run.signupWindowOpen ||
              (participation === "BOOSTER" && !characterRole) ||
              (participation === "LOOTBUDDY" && !lootbuddyCharacterId)
            }
            onClick={submit}
          >
            {pending ? "Saving…" : "Sign up"}
          </Button>
        </div>
      </dialog>
      ) : null}
    </>
  );
}

function parseBoosterSelection(value: string, isBackup: boolean, runId: string) {
  const [characterId, role] = value.split(":");
  return {
    runId,
    characterId,
    role: role as CharacterRole,
    isBackup,
  };
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

function BoosterFields({
  options,
  value,
  isBackup,
  onValueChange,
  onBackupChange,
}: {
  options: SignupOptions["booster"];
  value: string;
  isBackup: boolean;
  onValueChange: (value: string) => void;
  onBackupChange: (value: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Character and role</span>
        {options.eligible.length === 0 ? (
          <p className="rounded-md border border-border px-3 py-2 text-sm text-muted">
            {options.ineligible.length === 0
              ? "No characters on this account yet. Signups need a character once character management is available."
              : "No eligible booster characters for this run. Switch to Lootbuddy or check access and lockouts."}
          </p>
        ) : (
          <select
            aria-label="Character and role"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            className="h-9 w-full max-w-full rounded-md border border-border bg-surface px-2"
          >
            {options.eligible.map((option) => (
              <option key={`${option.characterId}-${option.role}`} value={`${option.characterId}:${option.role}`}>
                {option.characterName}-{option.realm} · {CLASS_LABELS[option.wowClass]} · {CHARACTER_ROLE_LABELS[option.role]}
              </option>
            ))}
          </select>
        )}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isBackup}
          onChange={(event) => onBackupChange(event.target.checked)}
          aria-label="Backup signup"
        />
        Backup signup
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

function LootbuddyFields({
  options,
  characterId,
  mode,
  verification,
  onCharacterChange,
  onModeChange,
  onVerificationChange,
}: {
  options: SignupOptions["lootbuddy"];
  characterId: string;
  mode: LootbuddyMode;
  verification: LootbuddyVerification;
  onCharacterChange: (value: string) => void;
  onModeChange: (value: LootbuddyMode) => void;
  onVerificationChange: (value: LootbuddyVerification) => void;
}) {
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Character</span>
        {options.eligible.length === 0 ? (
          <p className="rounded-md border border-border px-3 py-2 text-sm text-muted">
            {options.ineligible.length === 0
              ? "No characters on this account yet. Signups need a character once character management is available."
              : "No loot-eligible characters available for this run."}
          </p>
        ) : (
          <select
            aria-label="Lootbuddy character"
            value={characterId}
            onChange={(event) => onCharacterChange(event.target.value)}
            className="h-9 w-full max-w-full rounded-md border border-border bg-surface px-2"
          >
            {options.eligible.map((option) => (
              <option key={option.characterId} value={option.characterId}>
                {option.characterName}-{option.realm} · {CLASS_LABELS[option.wowClass]}
              </option>
            ))}
          </select>
        )}
      </label>
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
