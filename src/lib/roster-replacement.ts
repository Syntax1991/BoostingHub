import type { CharacterSyncHealth } from "@/lib/blizzard/sync-health";
import { isDpsRole, type ConcreteCharacterRole } from "@/lib/character-roles";
import { wclPerformanceMetricValue, type WclPerformanceRaidSegment } from "@/lib/wcl-performance-display";
import type { CharacterRole, ParticipationType, SignupStatus } from "@/models/enums";
import type { RosterSelectionRisk } from "@/services/roster-selection-risk";
import type { RunStaffingShortage } from "@/lib/run-staffing";

/**
 * Smart Replacement for the Roster Builder: why a draft slot needs a
 * replacement, and which CURRENT signups fit it best. Pure — it only reads the
 * flags the roster view model already carries (selection risk, schedule
 * conflicts, Character state, Blizzard sync health, cached WCL); it never
 * re-derives eligibility and never queries anything.
 */

/** The roster view-model fields this module reads (a subset of a roster signup card). */
export type ReplacementSignupInput = {
  id: string;
  userId: string;
  status: SignupStatus;
  participationType: ParticipationType;
  isBackup: boolean;
  assignableRoles: readonly ConcreteCharacterRole[];
  character: {
    name: string;
    realm: string;
    primaryRole: CharacterRole;
    offspecRoles: readonly CharacterRole[];
    itemLevel: number | null;
  } | null;
  characterActive: boolean;
  boosterApproved: boolean;
  scheduleConflicts: readonly { message: string }[];
  runCommitments: readonly unknown[];
  selectionRisk: RosterSelectionRisk;
  /** Null for characterless rows; NEVER_SYNCED / STALE / ERROR rank below HEALTHY. */
  syncHealth: CharacterSyncHealth | null;
  wclPerformance: WclPerformanceRaidSegment[];
};

export type ReplacementReasonKind = "WITHDRAWN" | "SAVED" | "SCHEDULE_CONFLICT" | "INACTIVE" | "BOOSTER_REVOKED";

export type ReplacementReason = { kind: ReplacementReasonKind; label: string };

/**
 * Existing roster warnings on a draft-selected BOOSTER slot where a
 * replacement is the natural fix — the same conditions the slot warning icon,
 * validation and preflight already report. No new blocker semantics.
 */
export function rosterReplacementReasons(signup: ReplacementSignupInput): ReplacementReason[] {
  if (signup.participationType !== "BOOSTER") return [];
  const reasons: ReplacementReason[] = [];
  if (signup.selectionRisk.warnings.length > 0) {
    const labels = signup.selectionRisk.warnings.flatMap((warning) =>
      warning.contents.map((content) => `${content.raidName} ${content.labelText}`),
    );
    reasons.push({ kind: "SAVED", label: labels.length > 0 ? `Saved: ${labels.join(", ")}` : "Saved" });
  }
  if (signup.scheduleConflicts.length > 0) {
    reasons.push({
      kind: "SCHEDULE_CONFLICT",
      label: signup.scheduleConflicts.map((row) => row.message).join(" · ") || "Schedule conflict",
    });
  }
  if (!signup.characterActive) reasons.push({ kind: "INACTIVE", label: "Character is inactive" });
  else if (!signup.boosterApproved) reasons.push({ kind: "BOOSTER_REVOKED", label: "Owner no longer has the Booster role" });
  return reasons;
}

export type ReplacementCandidate<T extends ReplacementSignupInput = ReplacementSignupInput> = {
  signup: T;
  /** The role the candidate takes when chosen: the required role when it can play it. */
  role: ConcreteCharacterRole;
  /** False when the candidate cannot play the required role (shown only with "Same role only" off). */
  playsRequiredRole: boolean;
  /** Hard schedule conflict — listed only with "Show risky", never selectable. */
  blocked: boolean;
  /** Saved on this Run's content — selectable after the usual confirmation. */
  saved: boolean;
  /** Draft-selected / published on another Run in the same raid ID (informational). */
  plannedElsewhere: boolean;
  /** Best Perf. Avg for the role from the cached WCL performance; null = no cached data. */
  wclBest: number | null;
};

function syncRank(health: CharacterSyncHealth | null): number {
  if (health === "HEALTHY") return 0;
  if (health === "STALE") return 1;
  return 2;
}

function fitRank(signup: ReplacementSignupInput, role: CharacterRole): number {
  if (signup.character?.primaryRole === role) return 0;
  if (signup.character?.offspecRoles.includes(role)) return 1;
  return 2;
}

/**
 * The role a candidate takes: the required role when it can play it. A DPS
 * slot is one group — Melee and Ranged both fill it — so a DPS candidate
 * keeps its own concrete DPS role (primary first), never a guessed one.
 */
function candidateRole(signup: ReplacementSignupInput, required: ConcreteCharacterRole): ConcreteCharacterRole | null {
  if (signup.assignableRoles.includes(required)) return required;
  const primary = signup.assignableRoles.find((role) => role === signup.character?.primaryRole);
  if (isDpsRole(required)) {
    const dps = signup.assignableRoles.filter(isDpsRole);
    if (dps.length > 0) return dps.find((role) => role === primary) ?? dps[0]!;
  }
  return primary ?? signup.assignableRoles[0] ?? null;
}

function compareNullableDesc(left: number | null, right: number | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right - left;
}

/**
 * Ranked replacement candidates for one slot, from the Run's CURRENT signups.
 *
 * Never offered: the slot itself, anything already in the draft, Lootbuddies,
 * withdrawn rows, inactive Characters, owners without the Booster role, and
 * Users who already hold another draft Booster slot (picking them would
 * silently move that slot — one selected Booster per User). The target's own
 * User stays eligible: swapping to their other Character is a valid fix.
 *
 * Order: plays the required role → no schedule conflict → not planned on
 * another Run → not saved → fresh Blizzard data → direct role fit (primary,
 * then preferred offspec) → cached WCL Best Perf. Avg → item level → name /
 * id. WCL only orders; it never excludes.
 */
export function rankReplacementCandidates<T extends ReplacementSignupInput>(input: {
  signups: readonly T[];
  requiredRole: ConcreteCharacterRole;
  /** Draft selection (signupId → role) the replacement is applied to. */
  staged: ReadonlyMap<string, CharacterRole | null>;
  /** Slot being replaced; omitted when filling an empty slot. */
  target?: { signupId: string; userId: string } | null;
  sameRoleOnly: boolean;
  includeBlocked: boolean;
}): ReplacementCandidate<T>[] {
  const byId = new Map(input.signups.map((signup) => [signup.id, signup]));
  const usersWithOtherSlot = new Set<string>();
  for (const signupId of input.staged.keys()) {
    if (signupId === input.target?.signupId) continue;
    const row = byId.get(signupId);
    if (row?.participationType === "BOOSTER") usersWithOtherSlot.add(row.userId);
  }

  const candidates: ReplacementCandidate<T>[] = [];
  for (const signup of input.signups) {
    if (signup.participationType !== "BOOSTER" || !signup.character) continue;
    if (signup.status === "WITHDRAWN") continue;
    if (signup.id === input.target?.signupId || input.staged.has(signup.id)) continue;
    if (!signup.characterActive || !signup.boosterApproved) continue;
    if (usersWithOtherSlot.has(signup.userId)) continue;
    const role = candidateRole(signup, input.requiredRole);
    if (!role) continue;
    const playsRequiredRole = staffingBucket(role) === staffingBucket(input.requiredRole);
    if (input.sameRoleOnly && !playsRequiredRole) continue;
    const blocked = signup.scheduleConflicts.length > 0;
    if (blocked && !input.includeBlocked) continue;
    candidates.push({
      signup,
      role,
      playsRequiredRole,
      blocked,
      saved: signup.selectionRisk.warnings.length > 0,
      plannedElsewhere: signup.runCommitments.length > 0,
      wclBest: wclPerformanceMetricValue(signup.wclPerformance, role, "best"),
    });
  }

  return candidates.sort(
    (left, right) =>
      Number(!left.playsRequiredRole) - Number(!right.playsRequiredRole) ||
      Number(left.blocked) - Number(right.blocked) ||
      Number(left.plannedElsewhere) - Number(right.plannedElsewhere) ||
      Number(left.saved) - Number(right.saved) ||
      syncRank(left.signup.syncHealth) - syncRank(right.signup.syncHealth) ||
      fitRank(left.signup, left.role) - fitRank(right.signup, right.role) ||
      compareNullableDesc(left.wclBest, right.wclBest) ||
      compareNullableDesc(left.signup.character!.itemLevel, right.signup.character!.itemLevel) ||
      left.signup.character!.name.localeCompare(right.signup.character!.name, "en-US") ||
      left.signup.character!.realm.localeCompare(right.signup.character!.realm, "en-US") ||
      left.signup.id.localeCompare(right.signup.id),
  );
}

/** Composition bucket a concrete booster role fills (Melee and Ranged both fill DPS). */
export function staffingBucket(role: CharacterRole): "tanks" | "healers" | "dps" {
  if (role === "TANK") return "tanks";
  if (role === "HEALER") return "healers";
  return "dps";
}

/**
 * The role a withdrawn pick's replacement should fill: the slot's role is gone
 * with the withdrawal, so take the first role the player offered whose bucket
 * is still short in the draft. Null once no such bucket is short — the slot
 * has been refilled and the withdrawal no longer needs action.
 */
export function withdrawnPickOpenRole(
  assignableRoles: readonly ConcreteCharacterRole[],
  missing: Pick<RunStaffingShortage, "tanks" | "healers" | "dps">,
): ConcreteCharacterRole | null {
  return assignableRoles.find((role) => missing[staffingBucket(role)] > 0) ?? null;
}

/** Signup state shown on a candidate row. */
export function replacementSignupStateLabel(signup: Pick<ReplacementSignupInput, "status" | "isBackup">): string {
  const state =
    signup.status === "SELECTED" ? "Published" : signup.status === "NOT_SELECTED" ? "Not selected" : "Signed up";
  return signup.isBackup ? `${state} · Backup` : state;
}

/** Late Fill: within this many hours of the scheduled start, open slots are presented as urgent replacements. */
export const LATE_FILL_WINDOW_HOURS = 24;

/**
 * Late Fill is a presentation mode, not a Run state: the Run is still
 * OPEN / ROSTERING / PUBLISHED, just close to (or past) its start time.
 */
export function isLateFillWindow(scheduledStartAt: string, now: Date): boolean {
  return new Date(scheduledStartAt).getTime() - now.getTime() <= LATE_FILL_WINDOW_HOURS * 60 * 60 * 1000;
}
