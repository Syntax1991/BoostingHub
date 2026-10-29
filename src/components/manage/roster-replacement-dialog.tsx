"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClassIcon } from "@/components/ui/badges";
import { LockoutIcon, RoleIcon, WarningIcon } from "@/components/ui/ops-icons";
import { SpecIcon } from "@/components/ui/spec-icon";
import { isDpsRole, type ConcreteCharacterRole } from "@/lib/character-roles";
import { CHARACTER_ROLE_LABELS, CLASS_COLORS } from "@/lib/labels";
import { formatSignupTileLockoutShort } from "@/lib/run-content-lockouts";
import {
  rankReplacementCandidates,
  replacementSignupStateLabel,
  staffingBucket,
  type ReplacementCandidate,
} from "@/lib/roster-replacement";
import { resolveDisplaySpecForSelectedRole } from "@/lib/signup-offered-specs";
import { wclPercentileColor } from "@/lib/wcl-performance-display";
import type { CharacterRole, RaidDifficulty } from "@/models/enums";
import type { rosterService } from "@/services/roster.service";

type RosterView = Awaited<ReturnType<typeof rosterService.getRosterManagementView>>;
type SignupRow = RosterView["boosters"][number];

/**
 * Tank / Healer / DPS — one DPS choice for the Raid Lead: Melee and Ranged
 * candidates both fill a DPS slot (rankReplacementCandidates), each keeping
 * its own concrete DPS role.
 */
function roleChoices(dpsRole: ConcreteCharacterRole): Array<{ role: ConcreteCharacterRole; icon: CharacterRole; label: string }> {
  return [
    { role: "TANK", icon: "TANK", label: CHARACTER_ROLE_LABELS.TANK },
    { role: "HEALER", icon: "HEALER", label: CHARACTER_ROLE_LABELS.HEALER },
    { role: dpsRole, icon: "DPS", label: CHARACTER_ROLE_LABELS.DPS },
  ];
}

export type ReplacementTarget = {
  /** The draft slot being replaced; null when filling an empty slot / a withdrawn pick's freed slot. */
  signupId: string | null;
  userId: string | null;
  /** e.g. "Synmist-Antonidas" or "Healer slot". */
  label: string;
  reasons: string[];
};

function candidateSpec(signup: SignupRow, role: CharacterRole): string | null {
  if (!signup.character) return null;
  return resolveDisplaySpecForSelectedRole(
    {
      wowClass: signup.character.wowClass,
      primarySpecialization: signup.character.specialization,
      playableSpecs: signup.character.playableSpecs,
      offeredRoles: signup.assignableRoles.length > 0 ? signup.assignableRoles : signup.offeredRoles,
    },
    role,
  );
}

function candidateNotes(candidate: ReplacementCandidate<SignupRow>): Array<{ text: string; tone: "warning" | "danger" | "muted" }> {
  const notes: Array<{ text: string; tone: "warning" | "danger" | "muted" }> = [];
  const { signup } = candidate;
  for (const conflict of signup.scheduleConflicts) notes.push({ text: conflict.message || "Schedule conflict", tone: "danger" });
  if (candidate.plannedElsewhere) notes.push({ text: "Planned on another Run", tone: "warning" });
  if (!candidate.playsRequiredRole) notes.push({ text: `Plays ${CHARACTER_ROLE_LABELS[candidate.role]}`, tone: "muted" });
  if (signup.syncHealth && signup.syncHealth !== "HEALTHY") {
    notes.push({ text: signup.syncHealth === "STALE" ? "Sync stale" : "No fresh sync", tone: "muted" });
  }
  return notes;
}

/**
 * Find replacement: ranked CURRENT signups for one slot. Choosing a
 * candidate only stages it in the Roster Builder draft (the caller handles
 * the usual saved-Character confirmation); Save / Update stays explicit.
 */
export function RosterReplacementDialog({
  target,
  initialRole,
  signups,
  staged,
  difficulty,
  onChoose,
  onClose,
}: {
  target: ReplacementTarget;
  initialRole: ConcreteCharacterRole;
  signups: SignupRow[];
  staged: ReadonlyMap<string, CharacterRole | null>;
  difficulty: RaidDifficulty;
  onChoose: (candidate: ReplacementCandidate<SignupRow>) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [role, setRole] = useState<ConcreteCharacterRole>(initialRole);
  const [sameRoleOnly, setSameRoleOnly] = useState(true);
  const [showRisky, setShowRisky] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const onDialogClose = () => onClose();
    dialog.addEventListener("close", onDialogClose);
    return () => dialog.removeEventListener("close", onDialogClose);
  }, [onClose]);

  const candidates = useMemo(
    () =>
      rankReplacementCandidates({
        signups,
        requiredRole: role,
        staged,
        target: target.signupId && target.userId ? { signupId: target.signupId, userId: target.userId } : null,
        sameRoleOnly,
        includeBlocked: showRisky,
      }),
    [signups, role, staged, target.signupId, target.userId, sameRoleOnly, showRisky],
  );

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[min(36rem,calc(100vw-2rem))] max-h-[min(44rem,calc(100vh-2rem))] overflow-y-auto rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-base font-semibold">
          {target.signupId ? `Replace ${target.label}` : `Fill ${target.label}`}
        </h2>
        {target.reasons.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-xs text-warning">
            {target.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <div role="group" aria-label="Required role" className="inline-flex rounded-md border border-border p-0.5">
            {roleChoices(isDpsRole(initialRole) ? initialRole : "RANGED_DPS").map((choice) => {
              const active = staffingBucket(role) === staffingBucket(choice.role);
              return (
                <button
                  key={choice.label}
                  type="button"
                  aria-pressed={active}
                  title={choice.label}
                  aria-label={choice.label}
                  onClick={() => setRole(choice.role)}
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-1 ${
                    active ? "bg-surface-raised text-foreground" : "text-muted hover:text-foreground"
                  }`}
                >
                  <RoleIcon role={choice.icon} size={16} />
                  <span className="hidden sm:inline">{choice.label}</span>
                </button>
              );
            })}
          </div>
          <label className="inline-flex items-center gap-1.5 text-muted">
            <input type="checkbox" checked={sameRoleOnly} onChange={(event) => setSameRoleOnly(event.target.checked)} />
            Same role only
          </label>
          <label className="inline-flex items-center gap-1.5 text-muted">
            <input type="checkbox" checked={showRisky} onChange={(event) => setShowRisky(event.target.checked)} />
            Show conflicted
          </label>
        </div>
      </div>

      {candidates.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">
          No current signup fits this slot{sameRoleOnly ? " in this role" : ""}. Use Add Booster for a player who did not sign up.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {candidates.map((candidate) => {
            const { signup } = candidate;
            const character = signup.character!;
            const spec = candidateSpec(signup, candidate.role);
            const lockoutShort = formatSignupTileLockoutShort(signup.contentSaves ?? [], difficulty);
            const notes = candidateNotes(candidate);
            return (
              <li key={signup.id}>
                <button
                  type="button"
                  disabled={candidate.blocked}
                  onClick={() => onChoose(candidate)}
                  className="flex w-full flex-col gap-0.5 px-4 py-2 text-left hover:bg-surface-raised/60 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ClassIcon wowClass={character.wowClass} size={20} />
                    <span
                      className="min-w-0 truncate text-sm font-semibold"
                      style={{ color: CLASS_COLORS[character.wowClass] }}
                    >
                      {character.name}-{character.realm}
                    </span>
                    {spec ? <SpecIcon wowClass={character.wowClass} specialization={spec} size={16} /> : null}
                    <RoleIcon role={candidate.role} size={16} />
                    <span className="min-w-0 flex-1" aria-hidden />
                    {character.itemLevel != null ? (
                      <span className="shrink-0 tabular-nums text-xs text-muted">{character.itemLevel}</span>
                    ) : null}
                    <span
                      className="w-14 shrink-0 text-right tabular-nums text-xs font-medium"
                      style={candidate.wclBest != null ? { color: wclPercentileColor(candidate.wclBest) } : undefined}
                      title="Warcraft Logs Best Perf. Avg (cached)"
                    >
                      {candidate.wclBest != null ? `WCL ${Math.round(candidate.wclBest)}` : <span className="text-muted/60">WCL —</span>}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-[26px] text-[11px] text-muted">
                    <span>{replacementSignupStateLabel(signup)}</span>
                    {lockoutShort ? (
                      <span className={`inline-flex items-center gap-1 ${candidate.saved ? "font-medium text-warning" : ""}`}>
                        <LockoutIcon attention={candidate.saved} label={candidate.saved ? "Saved" : "Lockout"} size={12} />
                        {lockoutShort}
                        {candidate.saved ? " · Saved" : ""}
                      </span>
                    ) : null}
                    {notes.map((note) => (
                      <span
                        key={note.text}
                        className={`inline-flex items-center gap-1 ${
                          note.tone === "danger" ? "text-danger" : note.tone === "warning" ? "text-warning" : ""
                        }`}
                      >
                        {note.tone !== "muted" ? <WarningIcon label={note.text} size={12} /> : null}
                        {note.text}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <p className="text-xs text-muted">Applies to the draft only — review, then Save / Update.</p>
        <Button type="button" size="sm" variant="ghost" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
      </div>
    </dialog>
  );
}
