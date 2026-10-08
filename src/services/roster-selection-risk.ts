/**
 * Shared roster selection risk — the ONE classification of "may this Character
 * be newly selected into this Run?" used by the manual roster, Add Player,
 * Auto Build and Update Roster.
 *
 * Pure composition of two existing authorities; never queries anything:
 * - `scheduleConflicts` (character-schedule-conflict): cross-Run reservation
 *   (PR #218) and weekly unavailability — hard, never overrideable.
 * - `contentSaves` (run-content-lockouts): per-RunRaidContent lockout labels,
 *   whose `label.attention` already encodes the Run's loot-type semantics
 *   (a SAVED Run never flags existing progress).
 *
 * CLEAN   → select normally.
 * WARNING → known saved / fully-saved content the label authority marks as
 *           attention-worthy; needs an explicit, server-validated
 *           acknowledgement. "Unknown" lockout state is CLEAN here (it may
 *           still render yellow in the UI) — it means "not verified", and
 *           prompting on it would be confirmation noise.
 * BLOCKED → any schedule conflict. Always wins over WARNING.
 *
 * Safe for client imports (types + pure functions only).
 */

import type { RunContentRaidSaveInfo } from "@/lib/run-content-lockouts";
import type { CharacterScheduleConflict } from "@/services/character-schedule-conflict";

export type RosterSelectionRiskLevel = "CLEAN" | "WARNING" | "BLOCKED";

export const ROSTER_SELECTION_WARNING_TYPES = ["LOCKOUT_ATTENTION"] as const;
export type RosterSelectionWarningType = (typeof ROSTER_SELECTION_WARNING_TYPES)[number];

/** One affected RunRaidContent — Bundle Runs yield one entry per saved content, never a sum. */
export type RosterSelectionWarningContent = {
  raidId: string;
  raidName: string;
  sortOrder: number;
  kind: "saved" | "fully_saved";
  bossesDefeated: number;
  totalBossCount: number;
  /** Canonical label text, e.g. "HC 6/8 · Saved". */
  labelText: string;
};

export type RosterSelectionWarning = {
  type: RosterSelectionWarningType;
  /** Ordered by RunRaidContent.sortOrder. */
  contents: RosterSelectionWarningContent[];
  /**
   * Stable identity of the warning state that was shown to the Raid Lead.
   * Changes whenever the affected contents or their progress change, so an
   * acknowledgement of "6/8" never covers "8/8" or an additional raid.
   */
  fingerprint: string;
};

export type RosterSelectionRisk = {
  level: RosterSelectionRiskLevel;
  blockers: CharacterScheduleConflict[];
  warnings: RosterSelectionWarning[];
};

/** Request-scoped acknowledgement of one warning. Never persisted. */
export type RosterWarningAcknowledgement = {
  type: RosterSelectionWarningType;
  fingerprint: string;
};

/** Acknowledgement addressed to one roster signup (Save / Update / Auto Build Apply). */
export type ConfirmedRosterWarning = RosterWarningAcknowledgement & { signupId: string };

/** A warning the server still needs confirmed — enough for the UI to render the dialog. */
export type PendingRosterSelectionWarning = {
  /** Null for Add Player before the signup exists. */
  signupId: string | null;
  characterId: string | null;
  /** e.g. "Synmist-Antonidas". */
  characterLabel: string;
  warning: RosterSelectionWarning;
};

export const CLEAN_ROSTER_SELECTION_RISK: RosterSelectionRisk = {
  level: "CLEAN",
  blockers: [],
  warnings: [],
};

function isKnownSavedAttention(
  row: RunContentRaidSaveInfo,
): row is RunContentRaidSaveInfo & { raidSave: NonNullable<RunContentRaidSaveInfo["raidSave"]> } {
  return (
    row.label.attention &&
    row.raidSave != null &&
    (row.label.kind === "saved" || row.label.kind === "fully_saved")
  );
}

function lockoutFingerprint(
  rows: ReadonlyArray<RunContentRaidSaveInfo & { raidSave: NonNullable<RunContentRaidSaveInfo["raidSave"]> }>,
): string {
  const parts = rows.map((row) =>
    [
      row.raidId,
      row.raidSave.difficulty,
      row.raidSave.resetIdentifier,
      row.label.kind,
      `${row.raidSave.bossesDefeated}/${row.raidSave.totalBossCount}`,
    ].join(":"),
  );
  return `LOCKOUT_ATTENTION|${parts.join(";")}`;
}

/** Per-content lockout warning for a Character on this Run, or null when nothing needs confirmation. */
export function lockoutAttentionWarning(
  contentSaves: readonly RunContentRaidSaveInfo[],
): RosterSelectionWarning | null {
  const affected = [...contentSaves]
    .filter(isKnownSavedAttention)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.raidId.localeCompare(b.raidId));
  if (affected.length === 0) return null;
  return {
    type: "LOCKOUT_ATTENTION",
    contents: affected.map((row) => ({
      raidId: row.raidId,
      // Full raid name for confirmation dialogs ("The Tidebound Grotto"), not
      // the compact card label — the content's DB Raid name.
      raidName: row.raidFullName,
      sortOrder: row.sortOrder,
      kind: row.label.kind === "fully_saved" ? "fully_saved" : "saved",
      bossesDefeated: row.raidSave.bossesDefeated,
      totalBossCount: row.raidSave.totalBossCount,
      labelText: row.label.text,
    })),
    fingerprint: lockoutFingerprint(affected),
  };
}

export function classifyRosterSelectionRisk(input: {
  scheduleConflicts: readonly CharacterScheduleConflict[];
  contentSaves: readonly RunContentRaidSaveInfo[];
}): RosterSelectionRisk {
  const warning = lockoutAttentionWarning(input.contentSaves);
  const warnings = warning ? [warning] : [];
  if (input.scheduleConflicts.length > 0) {
    return { level: "BLOCKED", blockers: [...input.scheduleConflicts], warnings };
  }
  if (warnings.length > 0) {
    return { level: "WARNING", blockers: [], warnings };
  }
  return CLEAN_ROSTER_SELECTION_RISK;
}

/**
 * Warnings of `risk` that the given acknowledgements do not cover exactly
 * (same type AND same fingerprint). Acknowledgements that match no current
 * warning are stale and simply ignored. BLOCKED is not handled here — callers
 * reject blockers first, and no acknowledgement can ever lift them.
 */
export function unacknowledgedWarnings(
  risk: RosterSelectionRisk,
  acknowledgements: readonly RosterWarningAcknowledgement[],
): RosterSelectionWarning[] {
  return risk.warnings.filter(
    (warning) =>
      !acknowledgements.some(
        (ack) => ack.type === warning.type && ack.fingerprint === warning.fingerprint,
      ),
  );
}

/** "6/8 saved" / "8/8 fully saved" — compact progress for confirmation dialogs. */
export function formatWarningContentProgress(content: RosterSelectionWarningContent): string {
  return `${content.bossesDefeated}/${content.totalBossCount} ${content.kind === "fully_saved" ? "fully saved" : "saved"}`;
}

export function rosterWarningConfirmationMessage(pending: readonly PendingRosterSelectionWarning[]): string {
  if (pending.length === 1) {
    const only = pending[0]!;
    const detail = only.warning.contents
      .map((content) => `${content.raidName} ${formatWarningContentProgress(content)}`)
      .join(", ");
    return `${only.characterLabel} already has lockout progress for this Run (${detail}). Confirm the selection to continue.`;
  }
  return `${pending.length} roster selections have lockout progress for this Run and need confirmation.`;
}
