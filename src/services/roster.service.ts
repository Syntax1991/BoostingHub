import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCanManageRun, canManageRun } from "@/auth/authorization";
import { DomainError, RosterWarningConfirmationRequiredError } from "@/lib/errors";
import {
  EXTERNAL_BOOSTERS_MAX_PER_ROSTER,
  externalBoosterInputError,
  normalizeExternalBoosterInput as normalizeExternalEntry,
  type ExternalBooster,
  type ExternalBoosterInput,
} from "@/lib/external-booster";
import { isApprovedBooster } from "@/services/boosting-role.service";
import { lockoutService } from "@/services/lockout.service";
import { assertRunTransition, isSignupWindowOpen } from "@/services/run-state";
import { assertSignupTransition } from "@/services/signup-state";
import { validateRosterDraft, type RosterIssue, type RosterValidationResult } from "@/services/roster-validation";
import {
  evaluateRaidBuffCoverage,
  resolveBuffContributorClass,
  type RaidBuffCoverage,
  type RaidBuffParticipant,
} from "@/services/roster-raid-buffs";
import {
  assertCharacterSelectableForSchedule,
  assertRosterPublishableForSchedule,
  getScheduleConflictsForCharacter,
  getScheduleConflictsForCharacters,
  type CharacterScheduleConflict,
} from "@/services/character-schedule-conflict.service";
import {
  getRunCommitmentsForCharacters,
  type CharacterRunCommitment,
} from "@/services/character-run-commitment";
import { rosterRepository, type RosterSelection, type RosterSignupRow } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { userRepository } from "@/repositories/user.repository";
import { characterRepository } from "@/repositories/character.repository";
import { signupService } from "@/services/signup.service";
import { hasUnpublishedRosterChanges } from "@/services/roster-publish-state";
import { activityRepository } from "@/repositories/activity.repository";
import { runDomainEventService } from "@/services/run-domain-event.service";
import { isConcreteCharacterRole, isLegacyGenericDps, type ConcreteCharacterRole } from "@/lib/character-roles";
import { CHARACTER_ROLE_LABELS, CLASS_LABELS } from "@/lib/labels";
import { formatOfferedRoles } from "@/lib/offered-roles";
import {
  resolveEffectivePersistedSelectedRole,
  resolveSignupAssignableRoles,
  rosterRoleSectionsForSignup,
  unresolvedHistoricDpsMessage,
  type SignupAssignableRoleInput,
} from "@/lib/signup-assignable-roles";
import { rosterActionLabel } from "@/lib/run-routes";
import type { CharacterRole, ParticipationType, RaidDifficulty, RunLootType, RunStatus, SignupStatus, WowClass } from "@/models/enums";
import {
  projectRunContentLockouts,
  type RunContentRaidSaveInfo,
} from "@/lib/run-content-lockouts";
import type { RunRaidContentRecord } from "@/repositories/run.repository";
import {
  CLEAN_ROSTER_SELECTION_RISK,
  classifyRosterSelectionRisk,
  rosterWarningConfirmationMessage,
  unacknowledgedWarnings,
  type ConfirmedRosterWarning,
  type PendingRosterSelectionWarning,
  type RosterSelectionRisk,
  type RosterWarningAcknowledgement,
} from "@/services/roster-selection-risk";
import {
  resolveRosterWclPerformance,
  type WclPerformanceRaidSegment,
} from "@/services/character-wcl-performance.service";

/**
 * The roster stays editable until Start Run: Publish communicates the planned
 * lineup, Start (PUBLISHED → IN_PROGRESS) freezes the lineup that actually
 * raids. IN_PROGRESS / COMPLETED / CANCELLED are never editable here.
 */
const EDITABLE_RUN_STATUSES: readonly RunStatus[] = ["OPEN", "ROSTERING", "PUBLISHED"];

async function loadEditableRun(user: AuthenticatedUser, runId: string) {
  const run = await runRepository.findById(runId);
  if (!run) {
    throw new DomainError("NOT_FOUND", "Run was not found.", 404);
  }
  assertCanManageRun(user, run);
  if (!EDITABLE_RUN_STATUSES.includes(run.status)) {
    throw new DomainError("INVALID_ROSTER_SELECTION", "The roster is locked once the run has started.");
  }
  return run;
}

type InspectedSignup = RosterSignupRow & {
  draftSelected: boolean;
  characterActive: boolean;
  boosterApproved: boolean;
  /** Informational per-content lockouts — never roster blockers. */
  contentSaves: RunContentRaidSaveInfo[];
  issue: string | null;
  /** Derived schedule integrity conflicts — never auto-withdraw or auto-deselect. */
  scheduleConflicts: CharacterScheduleConflict[];
  /**
   * Shared CLEAN / WARNING / BLOCKED classification for NEWLY selecting this
   * signup (roster-selection-risk). Composed from scheduleConflicts +
   * contentSaves; BOOSTER Characters only.
   */
  selectionRisk: RosterSelectionRisk;
  /**
   * Informational other-Run reservations (draft-selected or published SELECTED).
   * Never blocks selection by itself — see scheduleConflicts for blockers.
   */
  runCommitments: CharacterRunCommitment[];
  /** Informational WCL Best/Avg per Run content × offered role. */
  wclPerformance: WclPerformanceRaidSegment[];
};

/**
 * One UI projection of a signup into a role (or lootbuddy) section.
 * Multi-role BOOSTERs produce one card per offered role — visual duplication is
 * intentional. Domain identity stays `signup.id` (one staged/persisted slot).
 */
type RosterSignupCard = InspectedSignup & {
  /** Section this card is rendered in; null for LOOTBUDDY and the Unassigned DPS row. */
  groupRole: CharacterRole | null;
  /** Concrete roles the Raid Lead may assign. Historic generic DPS is already resolved. */
  assignableRoles: ConcreteCharacterRole[];
  /** Ambiguous historic generic DPS projection. Not duplicated under Melee and Ranged. */
  unassignedDps: boolean;
};

function signupAssignmentInput(signup: RosterSignupRow): SignupAssignableRoleInput {
  return {
    offeredRoles: signup.offeredRoles,
    characterClass: signup.character?.wowClass ?? null,
    primarySpecialization: signup.character?.specialization ?? null,
    playableSpecs: signup.character?.playableSpecs ?? [],
  };
}

function assignableRolesForSignup(signup: RosterSignupRow): ConcreteCharacterRole[] {
  if (signup.participationType !== "BOOSTER") return [];
  return resolveSignupAssignableRoles(signupAssignmentInput(signup));
}

/** Read projection: historic stored DPS becomes its effective draft role. Does not write. */
function withEffectiveDraftRole(signup: RosterSignupRow): RosterSignupRow {
  if (!signup.selectedRole || !isLegacyGenericDps(signup.selectedRole)) return signup;
  return {
    ...signup,
    selectedRole: resolveEffectivePersistedSelectedRole({
      storedSelectedRole: signup.selectedRole,
      signup: signupAssignmentInput(signup),
    }),
  };
}

/**
 * Role written for one selected slot.
 * A submitted generic DPS is accepted only when that slot is already stored as
 * legacy DPS, and then only as the effective concrete (or unresolved) role.
 * Ambiguous historic DPS may stay selected with a null role on a draft save.
 * Publish still rejects that null. A brand-new DPS assignment is rejected.
 */
function resolveDraftWriteRole(
  signup: RosterSignupRow,
  requested: CharacterRole | null | undefined,
  persistedRole: CharacterRole | null | undefined,
  allowUnresolved: boolean,
): CharacterRole | null {
  if (requested && isLegacyGenericDps(requested)) {
    if (persistedRole != null && isLegacyGenericDps(persistedRole)) {
      return resolveEffectivePersistedSelectedRole({
        storedSelectedRole: requested,
        signup: signupAssignmentInput(signup),
      });
    }
  }
  if (
    requested == null &&
    allowUnresolved &&
    signup.participationType === "BOOSTER" &&
    needsHistoricDpsChoice(signup, null)
  ) {
    return null;
  }
  return resolveSelectedRole(signup, requested);
}

function effectiveSelectionMap(
  signups: RosterSignupRow[],
  selections: Array<{ signupId: string; selectedRole: CharacterRole | null }>,
): Map<string, CharacterRole | null> {
  const byId = new Map(signups.map((signup) => [signup.id, signup]));
  const effective = new Map<string, CharacterRole | null>();
  for (const selection of selections) {
    const signup = byId.get(selection.signupId);
    if (!signup || !selection.selectedRole || !isLegacyGenericDps(selection.selectedRole)) {
      effective.set(selection.signupId, selection.selectedRole);
      continue;
    }
    effective.set(
      selection.signupId,
      resolveEffectivePersistedSelectedRole({
        storedSelectedRole: selection.selectedRole,
        signup: signupAssignmentInput(signup),
      }),
    );
  }
  return effective;
}

/**
 * Role-section cards from the same assignable-role result the server validates.
 * A modern hybrid still appears under every concrete offered role. Historic
 * generic DPS with one resolved subtype is placed in that bucket. Two subtypes
 * produce a single Unassigned DPS card plus any non-DPS offered role.
 */
function projectSignupCards(candidates: InspectedSignup[]): {
  boosters: RosterSignupCard[];
  tanks: RosterSignupCard[];
  healers: RosterSignupCard[];
  meleeDps: RosterSignupCard[];
  rangedDps: RosterSignupCard[];
  unassignedDps: RosterSignupCard[];
  dps: RosterSignupCard[];
  lootbuddies: RosterSignupCard[];
} {
  const boosters: RosterSignupCard[] = [];
  const tanks: RosterSignupCard[] = [];
  const healers: RosterSignupCard[] = [];
  const meleeDps: RosterSignupCard[] = [];
  const rangedDps: RosterSignupCard[] = [];
  const unassignedDps: RosterSignupCard[] = [];
  const lootbuddies: RosterSignupCard[] = [];

  for (const item of candidates) {
    if (item.participationType === "LOOTBUDDY") {
      lootbuddies.push({ ...item, groupRole: null, assignableRoles: [], unassignedDps: false });
      continue;
    }
    if (item.participationType !== "BOOSTER") continue;
    const { assignableRoles, sections } = rosterRoleSectionsForSignup(signupAssignmentInput(item));
    boosters.push({ ...item, groupRole: null, assignableRoles, unassignedDps: false });
    for (const section of sections) {
      if (section === "UNASSIGNED_DPS") {
        unassignedDps.push({ ...item, groupRole: null, assignableRoles, unassignedDps: true });
      } else if (section === "TANK") {
        tanks.push({ ...item, groupRole: "TANK", assignableRoles, unassignedDps: false });
      } else if (section === "HEALER") {
        healers.push({ ...item, groupRole: "HEALER", assignableRoles, unassignedDps: false });
      } else if (section === "MELEE_DPS") {
        meleeDps.push({ ...item, groupRole: "MELEE_DPS", assignableRoles, unassignedDps: false });
      } else if (section === "RANGED_DPS") {
        rangedDps.push({ ...item, groupRole: "RANGED_DPS", assignableRoles, unassignedDps: false });
      }
    }
  }

  return {
    boosters,
    tanks,
    healers,
    meleeDps,
    rangedDps,
    unassignedDps,
    dps: [...meleeDps, ...rangedDps, ...unassignedDps],
    lootbuddies,
  };
}

/** Prefer character name; characterless Lootbuddy falls back to Class label. */
function asPlayerName(player: { name?: unknown }): string {
  return typeof player.name === "string" && player.name ? player.name : "Unknown player";
}

function participationLabel(input: {
  character: { name: string; realm: string } | null;
  lootbuddyClass: WowClass | null;
}): string {
  if (input.character) {
    return `${input.character.name}-${input.character.realm}`;
  }
  if (input.lootbuddyClass) {
    return CLASS_LABELS[input.lootbuddyClass];
  }
  return "Unknown character";
}

function resolvedLootbuddyClass(signup: RosterSignupRow): WowClass | null {
  return signup.lootbuddyClass ?? signup.character?.wowClass ?? null;
}

/**
 * The Raid Lead's role assignment for one slot being selected. A BOOSTER slot
 * must end up with exactly one concrete assignable role. A single resolved
 * role fills itself in, including a historic generic DPS offer whose spec
 * determines Melee or Ranged. Generic DPS is never written. A LOOTBUDDY slot
 * has no booster role at all.
 */
function resolveSelectedRole(
  signup: RosterSignupRow,
  requested: CharacterRole | null | undefined,
): CharacterRole | null {
  const label = participationLabel(signup);
  if (signup.participationType !== "BOOSTER") {
    if (requested) {
      throw new DomainError(
        "INVALID_ROSTER_SELECTION",
        `${label} is a lootbuddy entry and cannot be assigned a booster role.`,
      );
    }
    return null;
  }

  const assignable = assignableRolesForSignup(signup);
  const role = requested ?? (assignable.length === 1 ? assignable[0]! : null);
  if (!role) {
    if (rosterRoleSectionsForSignup(signupAssignmentInput(signup)).sections.includes("UNASSIGNED_DPS")) {
      throw new DomainError("INVALID_ROSTER_SELECTION", unresolvedHistoricDpsMessage(label));
    }
    throw new DomainError(
      "INVALID_ROSTER_SELECTION",
      signup.offeredRoles.length === 0
        ? `${label} offered no role and cannot be rostered as a booster.`
        : `Choose a role for ${label} — offered ${formatOfferedRoles(signup.offeredRoles)}.`,
    );
  }
  if (!isConcreteCharacterRole(role)) {
    throw new DomainError(
      "INVALID_ROSTER_SELECTION",
      `Generic DPS cannot be assigned for ${label}. Choose Melee DPS or Ranged DPS.`,
    );
  }
  if (!assignable.includes(role)) {
    throw new DomainError(
      "INVALID_ROSTER_SELECTION",
      `${label} cannot be assigned as ${CHARACTER_ROLE_LABELS[role]}.`,
    );
  }
  return role;
}

/** Publish planning: a unique assignable role resolves itself; ambiguity stays unset for validation. */
function plannedSelectedRole(
  signup: RosterSignupRow,
  requested: CharacterRole | null | undefined,
): CharacterRole | null {
  if (signup.participationType !== "BOOSTER") return null;
  if (requested) return resolveSelectedRole(signup, requested);
  const assignable = assignableRolesForSignup(signup);
  return assignable.length === 1 ? assignable[0]! : null;
}

function needsHistoricDpsChoice(signup: RosterSignupRow, selectedRole: CharacterRole | null): boolean {
  if (signup.participationType !== "BOOSTER") return false;
  if (selectedRole && isConcreteCharacterRole(selectedRole)) return false;
  return rosterRoleSectionsForSignup(signupAssignmentInput(signup)).sections.includes("UNASSIGNED_DPS");
}

function inspectSignup(
  signup: RosterSignupRow,
  run: {
    difficulty: RaidDifficulty;
    scheduledStartAt: string;
    lootType: RunLootType;
    contents: Array<
      Pick<RunRaidContentRecord, "raidId" | "raidName" | "sortOrder" | "plannedBossCount" | "totalBossCount" | "bosses">
    >;
  },
): Omit<
  InspectedSignup,
  "draftSelected" | "scheduleConflicts" | "selectionRisk" | "runCommitments" | "wclPerformance"
> {
  if (run.contents.length === 0) {
    throw new DomainError("VALIDATION_FAILED", "Run has no configured raid contents.");
  }
  const character = signup.character;
  const contents = run.contents;
  const contentSaves =
    character == null
      ? projectRunContentLockouts({
          contents,
          difficulty: run.difficulty,
          lootType: run.lootType,
          findSave: () => null,
        })
      : projectRunContentLockouts({
          contents,
          difficulty: run.difficulty,
          lootType: run.lootType,
          findSave: (content) => {
            const matchingLockout = lockoutService.findExactLockout(character.lockouts, {
              raidId: content.raidId,
              difficulty: run.difficulty,
              resetIdentifier: lockoutService.getResetIdentifierForRun(character.region, run.scheduledStartAt),
            });
            return matchingLockout
              ? lockoutService.toRaidSaveInfo(matchingLockout, content.totalBossCount)
              : null;
          },
        });
  const boosterApproved =
    signup.participationType !== "BOOSTER" || signup.offeredRoles.length === 0 || !character
      ? signup.participationType !== "BOOSTER"
      : isApprovedBooster({ isBooster: character.ownerIsBooster });
  // Characterless Lootbuddy has no Character row — "active" is vacuously true.
  // Legacy Character-backed Lootbuddy still respects Character.isActive.
  const characterActive =
    signup.participationType === "LOOTBUDDY" && !character ? true : Boolean(character?.isActive);
  let issue: string | null = null;
  if (signup.status === "WITHDRAWN") issue = "Withdrawn";
  else if (!characterActive) issue = "Character is inactive.";
  else if (signup.participationType === "BOOSTER" && !boosterApproved) {
    issue = "Owner no longer has the Booster role.";
  }

  return {
    ...signup,
    characterActive,
    boosterApproved,
    contentSaves,
    issue,
  };
}

/**
 * Per-RunRaidContent lockouts of a roster signup against this Run — the same
 * projection the roster cards use, exported so Auto Build feeds the shared
 * selection risk from identical data instead of a private lockout rule.
 */
export function projectRosterSignupContentSaves(
  signup: RosterSignupRow,
  run: Parameters<typeof inspectSignup>[1],
): RunContentRaidSaveInfo[] {
  return inspectSignup(signup, run).contentSaves;
}

/**
 * Composition and draft validation count the Raid Lead's draft assignment
 * (`selectedRole`) — never the volunteered `offeredRoles`, which would
 * double-count a hybrid across two buckets. Published projections use
 * `publishedRole` instead (see getPublishedRosterView).
 */
function asMember(row: InspectedSignup) {
  return {
    signupId: row.id,
    userId: row.userId,
    userName: row.userName,
    characterName: participationLabel(row),
    participationType: row.participationType,
    selectedRole: row.selectedRole,
    status: row.status,
    characterActive: row.characterActive,
    boosterApproved: row.boosterApproved,
    requiresConcreteDpsChoice: needsHistoricDpsChoice(row, row.selectedRole),
  };
}

/** Maps a draft-selected signup into the pure Class Buff Checker participant shape. */
function normalizeExternalBoosterInput(input: ExternalBoosterInput): ExternalBoosterInput {
  const error = externalBoosterInputError(input);
  if (error) throw new DomainError("INVALID_ROSTER_SELECTION", error);
  return normalizeExternalEntry(input);
}

function externalBoosterRaidBuffParticipant(booster: ExternalBooster): RaidBuffParticipant {
  return {
    signupId: `external:${booster.id}`,
    userName: booster.name,
    participationType: booster.participationType,
    lootbuddyMode: null,
    wowClass: booster.wowClass,
    characterName: booster.name,
  };
}

function asRaidBuffParticipant(row: InspectedSignup): RaidBuffParticipant {
  return {
    signupId: row.id,
    userName: row.userName,
    participationType: row.participationType,
    lootbuddyMode: row.lootbuddyMode,
    wowClass: resolveBuffContributorClass({
      participationType: row.participationType,
      lootbuddyMode: row.lootbuddyMode,
      lootbuddyClass: row.lootbuddyClass,
      characterWowClass: row.character?.wowClass ?? null,
    }),
    characterName: row.character?.name ?? null,
  };
}

type NewSelectionWarningCheck = {
  /** Null for Add Player before the signup exists. */
  signupId: string | null;
  characterId: string;
  characterLabel: string;
  contentSaves: RunContentRaidSaveInfo[];
  acknowledgements: readonly RosterWarningAcknowledgement[];
};

/**
 * Server-side warning acknowledgement for NEW roster selections. Callers run
 * this only AFTER their hard schedule-conflict assertion (BLOCKED always wins
 * and can never be acknowledged) and BEFORE the repository write, whose
 * in-transaction reservation re-read (PR #218) stays the final authority.
 * The current warning is recomputed here; an acknowledgement counts only when
 * its type and fingerprint match that current state. Nothing is persisted.
 */
function assertNewSelectionWarningsConfirmed(picks: readonly NewSelectionWarningCheck[]): void {
  const pending: PendingRosterSelectionWarning[] = [];
  for (const pick of picks) {
    const risk = classifyRosterSelectionRisk({ scheduleConflicts: [], contentSaves: pick.contentSaves });
    for (const warning of unacknowledgedWarnings(risk, pick.acknowledgements)) {
      pending.push({
        signupId: pick.signupId,
        characterId: pick.characterId,
        characterLabel: pick.characterLabel,
        warning,
      });
    }
  }
  if (pending.length === 0) return;
  pending.sort(
    (a, b) =>
      a.characterLabel.localeCompare(b.characterLabel) ||
      (a.characterId ?? "").localeCompare(b.characterId ?? ""),
  );
  throw new RosterWarningConfirmationRequiredError(rosterWarningConfirmationMessage(pending), pending);
}

function acknowledgementsForSignup(
  confirmedWarnings: readonly ConfirmedRosterWarning[] | undefined,
  signupId: string,
): RosterWarningAcknowledgement[] {
  return (confirmedWarnings ?? []).filter((row) => row.signupId === signupId);
}

/**
 * Authoritative validation of a roster selection against the CURRENT Run —
 * difficulty, schedule/reset, content, composition — for Publish and Update:
 * WITHDRAWN rows excluded, active Character, owner Booster role, assigned role
 * offered, weekly availability and cross-Run reservations (hard blockers),
 * composition warnings acknowledgeable, one selected Booster per User, legal
 * signup status transitions. Returns the publish payload; throws on blockers.
 */
async function planAuthoritativeRoster(
  run: NonNullable<Awaited<ReturnType<typeof runRepository.findById>>>,
  roster: { selectedSignupIds: string[]; externalBoosters: ExternalBooster[] },
  signups: RosterSignupRow[],
  selections: Map<string, CharacterRole | null>,
  acknowledgeWarnings: boolean,
) {
  const knownIds = new Set(signups.map((signup) => signup.id));
  for (const signupId of selections.keys()) {
    if (!knownIds.has(signupId)) {
      throw new DomainError("NOT_FOUND", "Signup was not found.", 404);
    }
    if (signups.find((signup) => signup.id === signupId)?.status === "WITHDRAWN") {
      throw new DomainError("SIGNUP_WITHDRAWN", "Withdrawn signups cannot be selected.");
    }
  }
  const inspected = signups.map((signup) => ({
    ...inspectSignup(signup, run),
    // The role being accepted comes from the given selection (Update sends the
    // manager's current roles). A requested role must be one the offer
    // volunteered; a single-role offer resolves itself; otherwise null, which
    // validateRosterDraft reports as a missing-role blocker.
    selectedRole: !selections.has(signup.id)
      ? signup.selectedRole
      : plannedSelectedRole(signup, selections.get(signup.id)),
    draftSelected: selections.has(signup.id),
    scheduleConflicts: [] as CharacterScheduleConflict[],
    // Not evaluated here: publish validation checks schedule conflicts itself below.
    selectionRisk: CLEAN_ROSTER_SELECTION_RISK,
    runCommitments: [] as CharacterRunCommitment[],
    wclPerformance: [],
  }));
  const selected = inspected.filter(
    (item) => item.draftSelected && item.status !== "WITHDRAWN",
  );
  const validation = validateRosterDraft({
    runStatus: run.status,
    selected: selected.map(asMember),
    targets: {
      tanks: run.desiredTankCount,
      healers: run.desiredHealerCount,
      dps: run.desiredDpsCount,
      lootbuddies: run.desiredLootbuddyCount,
    },
    externalBoosters: roster.externalBoosters,
  });

  if (!validation.canPublish) {
    throw new DomainError(
      "ROSTER_VALIDATION_FAILED",
      validation.blockers[0]?.message ?? "This roster cannot be published.",
    );
  }
  if (validation.warnings.length > 0 && !acknowledgeWarnings) {
    throw new DomainError(
      "ROSTER_VALIDATION_FAILED",
      "Acknowledge composition warnings before publishing.",
    );
  }

  // Cross-Run Character reservation + weekly unavailability for every selected
  // BOOSTER at publish time. Existing draft selection is preserved even when
  // conflicted — publish is the hard stop.
  const selectedCharacters = selected
    .filter((item) => item.participationType === "BOOSTER" && item.character)
    .map((item) => ({
      id: item.character!.id,
      name: item.character!.name,
      region: item.character!.region,
    }));
  if (selectedCharacters.length > 0) {
    const conflictsByCharacter = await getScheduleConflictsForCharacters({
      targetRunId: run.id,
      scheduledStartAt: run.scheduledStartAt,
      difficulty: run.difficulty,
      characters: selectedCharacters,
    });
    const conflicted = selected
      .filter((item) => item.participationType === "BOOSTER" && item.character)
      .map((item) => ({
        characterId: item.character!.id,
        characterLabel: `${item.character!.name}-${item.character!.realm}`,
        conflicts: conflictsByCharacter.get(item.character!.id) ?? [],
      }))
      .filter((row) => row.conflicts.length > 0);
    assertRosterPublishableForSchedule(conflicted);
  }

  const notSelectedIds = inspected
    .filter((item) => item.status !== "WITHDRAWN" && !item.draftSelected)
    .map((item) => item.id);

  for (const item of selected) {
    if (item.status !== "SELECTED" && item.status !== "WITHDRAWN") {
      assertSignupTransition(item.status, "SELECTED");
    }
  }
  for (const item of inspected) {
    if (item.status !== "WITHDRAWN" && !item.draftSelected && item.status !== "NOT_SELECTED") {
      assertSignupTransition(item.status, "NOT_SELECTED");
    }
  }

  let nextStatus: RunStatus = run.status;
  if (run.status === "OPEN") {
    assertRunTransition("OPEN", "ROSTERING");
    assertRunTransition("ROSTERING", "PUBLISHED");
    nextStatus = "PUBLISHED";
  } else if (run.status === "ROSTERING") {
    assertRunTransition("ROSTERING", "PUBLISHED");
    nextStatus = "PUBLISHED";
  }

  const selectedSelections = selected.map((item) => ({
    signupId: item.id,
    // LOOTBUDDY slots publish with null publishedRole; BOOSTER slots carry
    // their assigned role (resolved against the offer by resolveSelectedRole).
    selectedRole: item.participationType === "BOOSTER" ? item.selectedRole : null,
  }));

  const boosterByUser = new Map<string, string>();
  for (const item of selected) {
    if (item.participationType !== "BOOSTER") continue;
    const prior = boosterByUser.get(item.userId);
    if (prior && prior !== item.id) {
      throw new DomainError(
        "INVALID_ROSTER_SELECTION",
        "A user can have at most one selected booster offer. Remove the duplicate before saving.",
      );
    }
    boosterByUser.set(item.userId, item.id);
  }

  return {
    validation,
    publish: {
      selectedSelections,
      selectedCharacterIds: selectedCharacters.map((row) => row.id),
      scheduledStartAt: run.scheduledStartAt,
      notSelectedSignupIds: notSelectedIds,
      fromStatus: run.status,
      runStatus: nextStatus,
    },
  };
}

/**
 * Roster orchestration. Draft selection is persisted on RunRosterEntry and is
 * not RunSignup.status. Publish copies the draft into SELECTED / NOT_SELECTED
 * and snapshots each BOOSTER's draft selectedRole onto RunSignup.publishedRole
 * in one transaction. Replacement-draft edits never mutate publishedRole until
 * Publish runs again.
 */
export const rosterService = {
  async listManagedRuns(user: AuthenticatedUser) {
    const runs = await runRepository.listManaged();
    return runs.filter((run) => canManageRun(user, run)).map((run) => ({
      id: run.id,
      title: run.title,
      productLabel: run.contentDisplay.productLabel,
      contentSummary: run.contentDisplay.summary,
      difficulty: run.difficulty,
      scheduledStartAt: run.scheduledStartAt,
      status: run.status,
      raidLeadId: run.raidLeadId,
      raidLeadName: run.raidLeadName,
      signupsOpen: run.signupsOpen,
      signupWindowOpen: isSignupWindowOpen(run.status, run.signupsOpen),
      signupCount: run.signups.filter((signup) => signup.status !== "WITHDRAWN").length,
      selectedCount: run.signups.filter((signup) => signup.status === "SELECTED").length,
      draftSelectedCount: run.roster?.draftSelectedCount ?? 0,
      publishedAt: run.roster?.publishedAt ?? null,
      desiredTankCount: run.desiredTankCount,
      desiredHealerCount: run.desiredHealerCount,
      desiredDpsCount: run.desiredDpsCount,
        desiredLootbuddyCount: run.desiredLootbuddyCount,
      actionLabel: rosterActionLabel(
        run.status,
        Boolean(run.roster),
        run.roster?.publishedAt ?? null,
        run.roster?.draftSelectedCount ?? 0,
      ),
    }));
  },

  /**
   * Participant-safe published roster. Uses live SELECTED signup rows and their
   * publishedRole snapshot — never mutable draft selection.
   * Does not call ensure(), so a USER view cannot create a roster row.
   */
  async getPublishedRosterView(runId: string) {
    const roster = await rosterRepository.findByRunId(runId);
    if (!roster?.publishedAt) {
      return null;
    }

    const signups = await rosterRepository.listSignups(runId);
    const members = signups
      .filter((signup) => signup.status === "SELECTED")
      .map((signup) => {
        const wowClass = resolvedLootbuddyClass(signup);
        return {
          signupId: signup.id,
          userName: signup.userName,
          characterName: signup.character?.name ?? (wowClass ? CLASS_LABELS[wowClass] : "Unknown character"),
          characterRealm: signup.character?.realm ?? "",
          wowClass,
          selectedRole: signup.publishedRole,
          participationType: signup.participationType,
          isBackup: signup.isBackup,
        };
      });

    return {
      publishedAt: roster.publishedAt,
      publishedByName: roster.publishedByName,
      members,
      /** Hand-added boosters without an account — shown alongside the members. */
      externalBoosters: roster.externalBoosters,
    };
  },

  async getRosterManagementView(user: AuthenticatedUser, runId: string) {
    const run = await runRepository.findById(runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    assertCanManageRun(user, run);

    const roster = await rosterRepository.ensure(runId);
    const signups = (await rosterRepository.listSignups(runId)).map(withEffectiveDraftRole);
    const boosterCharacters = signups
      .filter((signup) => signup.participationType === "BOOSTER" && signup.character)
      .map((signup) => ({
        id: signup.character!.id,
        name: signup.character!.name,
        region: signup.character!.region,
      }));
    const scheduleConflictsByCharacter = await getScheduleConflictsForCharacters({
      targetRunId: run.id,
      scheduledStartAt: run.scheduledStartAt,
      difficulty: run.difficulty,
      characters: boosterCharacters,
    });
    // Cross-run RESERVED/COMMITTED commitments: only other Runs in this Run's raid ID.
    const runCommitmentsByCharacter = await getRunCommitmentsForCharacters({
      characters: boosterCharacters,
      excludeRunId: run.id,
      targetScheduledStartAt: run.scheduledStartAt,
    });

    const wclBySignup = await resolveRosterWclPerformance({
      difficulty: run.difficulty,
      contents: run.contents,
      boosters: signups
        .filter((signup) => signup.participationType === "BOOSTER" && signup.character)
        .map((signup) => ({
          signupId: signup.id,
          offeredRoles: signup.offeredRoles,
          character: {
            id: signup.character!.id,
            wowClass: signup.character!.wowClass,
            specialization: signup.character!.specialization,
            primaryRole: signup.character!.primaryRole,
            warcraftLogsId: signup.character!.warcraftLogsId,
          },
        })),
    });

    const inspected = signups.map((signup) => {
      const base = inspectSignup(signup, run);
      const isBoosterCharacter = signup.participationType === "BOOSTER" && Boolean(signup.character);
      const scheduleConflicts = isBoosterCharacter
        ? (scheduleConflictsByCharacter.get(signup.character!.id) ?? [])
        : [];
      return {
      ...base,
      draftSelected: roster.selectedSignupIds.includes(signup.id),
      scheduleConflicts,
      selectionRisk: isBoosterCharacter
        ? classifyRosterSelectionRisk({ scheduleConflicts, contentSaves: base.contentSaves })
        : CLEAN_ROSTER_SELECTION_RISK,
      runCommitments:
        signup.participationType === "BOOSTER" && signup.character
          ? (runCommitmentsByCharacter.get(signup.character.id) ?? [])
          : [],
      wclPerformance: wclBySignup.get(signup.id) ?? [],
      };
    });

    // Draft slots whose signup was withdrawn must not count for composition or
    // Class Buffs (UI also hides WITHDRAWN candidates). Entry cleanup on withdraw
    // is best-effort; this filter is the authoritative projection guard.
    const selected = inspected.filter(
      (item) => item.draftSelected && item.status !== "WITHDRAWN",
    );
    const validation = validateRosterDraft({
      runStatus: run.status,
      selected: selected.map(asMember),
      targets: {
        tanks: run.desiredTankCount,
        healers: run.desiredHealerCount,
        dps: run.desiredDpsCount,
        lootbuddies: run.desiredLootbuddyCount,
      },
      externalBoosters: roster.externalBoosters,
    });
    const composition = validation.composition;
    const raidBuffCoverage: RaidBuffCoverage = evaluateRaidBuffCoverage([
      ...selected.map(asRaidBuffParticipant),
      ...roster.externalBoosters.map(externalBoosterRaidBuffParticipant),
    ]);
    const canEdit = EDITABLE_RUN_STATUSES.includes(run.status);
    const publishedSelection = inspected.filter((item) => item.status === "SELECTED");
    // WITHDRAWN is a dead end (no outgoing transition) and must never appear as a
    // candidate. NOT_SELECTED stays here deliberately: a raid lead re-editing a
    // published roster can still re-select someone who wasn't picked last time.
    const candidates = inspected.filter((item) => item.status !== "WITHDRAWN");
    const projected = projectSignupCards(candidates);

    return {
      run: {
        id: run.id,
        title: run.title,
        productLabel: run.contentDisplay.productLabel,
        contentSummary: run.contentDisplay.summary,
        difficulty: run.difficulty,
        lootType: run.lootType,
        scheduledStartAt: run.scheduledStartAt,
        status: run.status,
        raidLeadName: run.raidLeadName,
        notes: run.notes,
        signupsOpen: run.signupsOpen,
        signupWindowOpen: isSignupWindowOpen(run.status, run.signupsOpen),
        desiredTankCount: run.desiredTankCount,
        desiredHealerCount: run.desiredHealerCount,
        desiredDpsCount: run.desiredDpsCount,
        desiredLootbuddyCount: run.desiredLootbuddyCount,
        activeSignupCount: inspected.filter((item) => item.status !== "WITHDRAWN").length,
        publishedSelectedCount: publishedSelection.length,
        backupCount: inspected.filter((item) => item.isBackup && item.status !== "WITHDRAWN").length,
        lootbuddyCount: inspected.filter((item) => item.participationType === "LOOTBUDDY" && item.status !== "WITHDRAWN").length,
      },
      roster: {
        id: roster.id,
        state: roster.state,
        version: roster.version,
        publishedAt: roster.publishedAt,
        publishedByName: roster.publishedByName,
        canEdit,
        // Version 1 + empty draft means the published selection was never copied into
        // the draft. Later empty drafts (after the raidlead deselected everyone) keep a
        // higher version so Publish remains available.
        externalBoosters: roster.externalBoosters,
        needsPublishSeed:
          Boolean(roster.publishedAt) &&
          roster.selectedSignupIds.length === 0 &&
          publishedSelection.length > 0 &&
          roster.version === 1,
        /** A roster-relevant Run setting changed since Publish / Update Roster. */
        runChangedSinceAck: roster.runChangedSinceAck,
        /** Latest explicit Publish Roster intent — sent back by Publish (repost) for compare-and-set. */
        postRevision: roster.postRevision,
        /** Saved draft or Run settings differ from the accepted roster — Update Roster before Start. */
        hasUnpublishedChanges: hasUnpublishedRosterChanges({
          publishedAt: roster.publishedAt,
          version: roster.version,
          runChangedSinceAck: roster.runChangedSinceAck,
          draft: roster.selections,
          signups,
        }),
      },
      composition,
      raidBuffCoverage,
      validation,
      /**
       * Canonical unique BOOSTER candidates (one card per RunSignup).
       * Role sections below are visual projections and may repeat the same id.
       */
      boosters: projected.boosters,
      groups: {
        tanks: projected.tanks,
        healers: projected.healers,
        meleeDps: projected.meleeDps,
        rangedDps: projected.rangedDps,
        /**
         * Historic generic DPS that resolves to both Melee and Ranged.
         * Resolved subtypes are already in meleeDps / rangedDps.
         * `legacyDps` is the same list for older consumers.
         */
        unassignedDps: projected.unassignedDps,
        legacyDps: projected.unassignedDps,
        /** Aggregate of concrete DPS sections plus ambiguous historic rows. */
        dps: projected.dps,
        lootbuddies: projected.lootbuddies,
      },
      summary: {
        tanks: composition.tanks.selected,
        healers: composition.healers.selected,
        meleeDps:
          selected.filter((row) => row.selectedRole === "MELEE_DPS").length +
          roster.externalBoosters.filter((b) => b.participationType === "BOOSTER" && b.role === "MELEE_DPS")
            .length,
        rangedDps:
          selected.filter((row) => row.selectedRole === "RANGED_DPS").length +
          roster.externalBoosters.filter((b) => b.participationType === "BOOSTER" && b.role === "RANGED_DPS")
            .length,
        legacyDps:
          selected.filter((row) => needsHistoricDpsChoice(row, row.selectedRole)).length +
          roster.externalBoosters.filter((b) => b.participationType === "BOOSTER" && b.role === "DPS").length,
        dps: composition.dps.selected,
        lootbuddies: composition.lootbuddies,
        boosters: composition.boosterTotal,
        total: composition.total,
      },
    };
  },

  async setDraftSelection(
    user: AuthenticatedUser,
    input: {
      runId: string;
      signupId: string;
      selected: boolean;
      version: number;
      /** Omit for a single-role offer (auto-resolved) and for LOOTBUDDY. */
      selectedRole?: CharacterRole | null;
      /** Acknowledged selection warnings (see assertNewSelectionWarningsConfirmed). */
      confirmedWarnings?: ConfirmedRosterWarning[];
    },
  ) {
    const run = await runRepository.findById(input.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    assertCanManageRun(user, run);
    if (!EDITABLE_RUN_STATUSES.includes(run.status)) {
      throw new DomainError("INVALID_ROSTER_SELECTION", "This run cannot be rostered in its current state.");
    }

    const roster = await rosterRepository.ensure(input.runId);
    await rosterRepository.assertVersion(roster, input.version);

    const signupRecord = await signupRepository.findById(input.signupId);
    if (!signupRecord) {
      throw new DomainError("NOT_FOUND", "Signup was not found.", 404);
    }
    if (signupRecord.run.id !== input.runId) {
      throw new DomainError("INVALID_ROSTER_SELECTION", "That signup does not belong to this run.");
    }

    const signups = await rosterRepository.listSignups(input.runId);
    const signup = signups.find((item) => item.id === input.signupId);
    if (!signup) {
      throw new DomainError("NOT_FOUND", "Signup was not found.", 404);
    }
    if (signup.status === "WITHDRAWN") {
      throw new DomainError("SIGNUP_WITHDRAWN", "Withdrawn signups cannot be selected.");
    }

    // Cross-Run Character reservation + weekly unavailability for NEW draft
    // selection only. Already-selected conflicted Characters stay selected;
    // publish revalidates. Deselecting never needs this check.
    const alreadyDraftSelected = roster.selectedSignupIds.includes(input.signupId);
    if (
      input.selected &&
      !alreadyDraftSelected &&
      signup.participationType === "BOOSTER" &&
      signup.character
    ) {
      const scheduleConflicts = await getScheduleConflictsForCharacter({
        targetRunId: input.runId,
        scheduledStartAt: run.scheduledStartAt,
        difficulty: run.difficulty,
        character: {
          id: signup.character.id,
          name: signup.character.name,
          region: signup.character.region,
        },
      });
      assertCharacterSelectableForSchedule(
        `${signup.character.name}-${signup.character.realm}`,
        scheduleConflicts,
      );
      // No server action exposes this single-slot path today; it is gated all
      // the same so it can never become a warning-confirmation bypass.
      if (signup.status !== "SELECTED") {
        assertNewSelectionWarningsConfirmed([
          {
            signupId: signup.id,
            characterId: signup.character.id,
            characterLabel: `${signup.character.name}-${signup.character.realm}`,
            contentSaves: inspectSignup(signup, run).contentSaves,
            acknowledgements: acknowledgementsForSignup(input.confirmedWarnings, signup.id),
          },
        ]);
      }
    }

    /**
     * A User holds at most one selected BOOSTER participation per run —
     * selecting a second Booster offer replaces the previous draft row
     * instead of stacking two slots. LOOTBUDDY entries are independently
     * selectable and never replace each other or the User's Booster row (a
     * User may simultaneously have Booster participation and any number of
     * selected Lootbuddy entries) — see docs/features/signups.md.
     */
    const replaceSignupIds =
      input.selected && signup.participationType === "BOOSTER"
        ? signups
            .filter((item) => item.userId === signup.userId && item.participationType === "BOOSTER")
            .map((item) => item.id)
        : [];

    const persistedRole = roster.selections.find((selection) => selection.signupId === input.signupId)?.selectedRole;
    await rosterRepository.setSignupSelected({
      rosterId: roster.id,
      expectedVersion: input.version,
      signupId: input.signupId,
      selected: input.selected,
      selectedRole: input.selected
        ? resolveDraftWriteRole(signup, input.selectedRole, persistedRole, false)
        : null,
      replaceSignupIds,
      characterId: signup.participationType === "BOOSTER" ? (signup.character?.id ?? null) : null,
      targetRunId: input.runId,
      scheduledStartAt: run.scheduledStartAt,
    });

    if (run.status === "OPEN") {
      assertRunTransition("OPEN", "ROSTERING");
      await runRepository.updateStatus(run.id, "ROSTERING");
      await activityRepository.create({
        userId: user.id,
        type: "ROSTERING_STARTED",
        message: `Started rostering ${run.title}.`,
      });
    }
  },

  /**
   * Persist a complete draft selection in one mutation. Each selection names
   * the role the Raid Lead is assigning that slot — the decision that drives
   * composition, publish, and attendance. A BOOSTER slot must resolve
   * to exactly one of its offered roles (a single-role offer resolves itself);
   * a LOOTBUDDY slot must carry none. Validates every requested signup before
   * writing; rejects malformed same-user Booster batches instead of silently
   * normalizing. OPEN → ROSTERING only when the saved selection is non-empty.
   */
  /**
   * External Boosters dialog (Run header): saves the roster's full external
   * booster set on its own, without touching the signup draft. Allowed while
   * the roster is editable; after Start use Replace on the Attendance tab.
   */
  async saveExternalBoosters(
    user: AuthenticatedUser,
    input: { runId: string; version: number; externalBoosters: ExternalBoosterInput[] },
  ) {
    const run = await runRepository.findById(input.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    assertCanManageRun(user, run);
    if (!EDITABLE_RUN_STATUSES.includes(run.status)) {
      throw new DomainError("INVALID_ROSTER_SELECTION", "External boosters can only be changed before the run starts.");
    }
    const externalBoosters = input.externalBoosters.map(normalizeExternalBoosterInput);
    if (externalBoosters.length > EXTERNAL_BOOSTERS_MAX_PER_ROSTER) {
      throw new DomainError(
        "INVALID_ROSTER_SELECTION",
        `A roster can have at most ${EXTERNAL_BOOSTERS_MAX_PER_ROSTER} external boosters.`,
      );
    }
    const roster = await rosterRepository.ensure(input.runId);
    await rosterRepository.replaceExternalBoosters(roster.id, input.version, externalBoosters);
    await runDomainEventService.record({
      runId: input.runId,
      actorUser: user,
      type: "EXTERNAL_BOOSTERS_UPDATED",
      summary: `External Boosters updated (${externalBoosters.length}).`,
      payload: { externalBoosterCount: externalBoosters.length },
    });
  },

  async saveDraftSelection(
    user: AuthenticatedUser,
    input: {
      runId: string;
      version: number;
      selections: Array<{ signupId: string; selectedRole: CharacterRole | null }>;
      /**
       * Full set of hand-added external boosters for this roster. Omitted by
       * older clients — the saved ones are then left untouched.
       */
      externalBoosters?: ExternalBoosterInput[];
      /**
       * Acknowledged selection warnings for NEWLY selected signups (manual
       * Save Roster and Auto Build Apply). Already-selected slots never need one.
       */
      confirmedWarnings?: ConfirmedRosterWarning[];
    },
  ) {
    const run = await runRepository.findById(input.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    assertCanManageRun(user, run);
    if (!EDITABLE_RUN_STATUSES.includes(run.status)) {
      throw new DomainError("INVALID_ROSTER_SELECTION", "This run cannot be rostered in its current state.");
    }

    const roster = await rosterRepository.ensure(input.runId);
    await rosterRepository.assertVersion(roster, input.version);

    const requested = new Map<string, CharacterRole | null>();
    for (const selection of input.selections) {
      const existing = requested.get(selection.signupId);
      if (requested.has(selection.signupId) && existing !== selection.selectedRole) {
        throw new DomainError(
          "INVALID_ROSTER_SELECTION",
          "The same signup was selected twice with different roles.",
        );
      }
      requested.set(selection.signupId, selection.selectedRole);
    }

    const externalBoosters = input.externalBoosters?.map(normalizeExternalBoosterInput);
    if (externalBoosters && externalBoosters.length > EXTERNAL_BOOSTERS_MAX_PER_ROSTER) {
      throw new DomainError(
        "INVALID_ROSTER_SELECTION",
        `A roster can have at most ${EXTERNAL_BOOSTERS_MAX_PER_ROSTER} external boosters.`,
      );
    }

    const selectedIds = [...requested.keys()];
    const signups = await rosterRepository.listSignups(input.runId);
    const byId = new Map(signups.map((item) => [item.id, item]));
    const persistedRole = new Map(roster.selections.map((selection) => [selection.signupId, selection.selectedRole]));
    const selectedRows: RosterSignupRow[] = [];
    const selections: RosterSelection[] = [];
    const contentSavesBySignupId = new Map<string, RunContentRaidSaveInfo[]>();

    for (const signupId of selectedIds) {
      const signup = byId.get(signupId);
      if (!signup) {
        const record = await signupRepository.findById(signupId);
        if (!record) {
          throw new DomainError("NOT_FOUND", "Signup was not found.", 404);
        }
        if (record.run.id !== input.runId) {
          throw new DomainError("INVALID_ROSTER_SELECTION", "That signup does not belong to this run.");
        }
        throw new DomainError("NOT_FOUND", "Signup was not found.", 404);
      }
      if (signup.status === "WITHDRAWN") {
        throw new DomainError("SIGNUP_WITHDRAWN", "Withdrawn signups cannot be selected.");
      }

      const inspected = inspectSignup(signup, run);
      if (!inspected.characterActive) {
        throw new DomainError("INVALID_ROSTER_SELECTION", inspected.issue ?? "Character is inactive.");
      }
      if (signup.participationType === "BOOSTER" && !inspected.boosterApproved) {
        throw new DomainError(
          "INVALID_ROSTER_SELECTION",
          inspected.issue ?? "Owner no longer has the Booster role.",
        );
      }
      selectedRows.push(signup);
      contentSavesBySignupId.set(signupId, inspected.contentSaves);
      selections.push({
        signupId,
        selectedRole: resolveDraftWriteRole(signup, requested.get(signupId), persistedRole.get(signupId), true),
      });
    }

    const boosterByUser = new Map<string, string>();
    for (const signup of selectedRows) {
      if (signup.participationType !== "BOOSTER") continue;
      const prior = boosterByUser.get(signup.userId);
      if (prior && prior !== signup.id) {
        throw new DomainError(
          "INVALID_ROSTER_SELECTION",
          "A user can have at most one selected booster offer. Remove the duplicate before saving.",
        );
      }
      boosterByUser.set(signup.userId, signup.id);
    }

    const previouslySelected = new Set(roster.selectedSignupIds);
    const newlySelectedCharacters = selectedRows
      .filter(
        (item) =>
          item.participationType === "BOOSTER" &&
          item.character &&
          !previouslySelected.has(item.id),
      )
      .map((item) => ({
        id: item.character!.id,
        name: item.character!.name,
        region: item.character!.region,
      }));
    if (newlySelectedCharacters.length > 0) {
      const conflictsByCharacter = await getScheduleConflictsForCharacters({
        targetRunId: input.runId,
        scheduledStartAt: run.scheduledStartAt,
        difficulty: run.difficulty,
        characters: newlySelectedCharacters,
      });
      for (const signup of selectedRows) {
        if (
          signup.participationType !== "BOOSTER" ||
          !signup.character ||
          previouslySelected.has(signup.id)
        ) {
          continue;
        }
        assertCharacterSelectableForSchedule(
          `${signup.character.name}-${signup.character.realm}`,
          conflictsByCharacter.get(signup.character.id) ?? [],
        );
      }
    }

    // WARNING gate — after the hard schedule assertion above, before the write.
    // A slot already in the saved draft (or already published SELECTED) was
    // accepted earlier and never re-prompts.
    assertNewSelectionWarningsConfirmed(
      selectedRows
        .filter(
          (signup) =>
            signup.participationType === "BOOSTER" &&
            signup.character &&
            !previouslySelected.has(signup.id) &&
            signup.status !== "SELECTED",
        )
        .map((signup) => ({
          signupId: signup.id,
          characterId: signup.character!.id,
          characterLabel: `${signup.character!.name}-${signup.character!.realm}`,
          contentSaves: contentSavesBySignupId.get(signup.id) ?? [],
          acknowledgements: acknowledgementsForSignup(input.confirmedWarnings, signup.id),
        })),
    );

    await rosterRepository.replaceSelectedSignupIds(roster.id, input.version, selections, {
      targetRunId: input.runId,
      scheduledStartAt: run.scheduledStartAt,
      // Repository race-check only newly added Characters (already-selected stay).
      selectedCharacterIds: newlySelectedCharacters.map((row) => row.id),
      // Save Roster already DMs players; Publish later only DMs what changed since.
      notify: { runId: input.runId, runTitle: run.title },
      externalBoosters,
    });

    if (run.status === "OPEN" && selectedIds.length > 0) {
      assertRunTransition("OPEN", "ROSTERING");
      await runRepository.updateStatus(run.id, "ROSTERING");
      await activityRepository.create({
        userId: user.id,
        type: "ROSTERING_STARTED",
        message: `Started rostering ${run.title}.`,
      });
    }
  },

  /** Add Player picker: bounded search over ACTIVE accounts for a Run the actor manages. */
  async searchPlayers(user: AuthenticatedUser, input: { runId: string; query: string }) {
    await loadEditableRun(user, input.runId);
    return userRepository.searchActivePlayers(input.query, 10);
  },

  /** Add Player: the chosen player's Characters, split by the normal signup eligibility rules. */
  async getManualAddOptions(user: AuthenticatedUser, input: { runId: string; userId: string }) {
    const run = await loadEditableRun(user, input.runId);
    const player = await userRepository.findById(input.userId);
    if (!player) {
      throw new DomainError("NOT_FOUND", "Player was not found.", 404);
    }
    const options = await signupService.listManagedBoosterOptions(run, input.userId);
    return {
      player: { id: input.userId, name: asPlayerName(player) },
      eligible: options.eligible.map((option) => ({
        characterId: option.characterId,
        characterName: option.characterName,
        realm: option.realm,
        wowClass: option.wowClass,
        specialization: option.specialization,
        roles: option.roles,
        defaultRole: option.defaultRole,
        /**
         * Same shared risk as the roster cards. Eligible options are never
         * BLOCKED — schedule-conflicted Characters are listed under `ineligible`.
         */
        selectionRisk: classifyRosterSelectionRisk({ scheduleConflicts: [], contentSaves: option.contentSaves }),
      })),
      ineligible: options.ineligible,
    };
  },

  /**
   * Add Player: rosters a registered User's Character as a normal BOOSTER
   * signup — never an External Booster — so commitments, reservations, My
   * Runs, notifications, Discord, Final Setup and attendance treat it
   * like any other pick. Eligibility is the self-signup rule set plus the
   * roster's schedule-conflict check (no Raid Lead bypass). The signup
   * (reused, role-extended or newly created) and the draft slot are written in
   * one transaction (rosterRepository.addManagedBoosterAtomic), replacing that
   * User's other Booster slot — a player holds at most one — with the same
   * Save Roster notifications. On any failure nothing is left behind. A
   * PUBLISHED Run stays PUBLISHED; Update Roster publishes the change.
   */
  async addRegisteredParticipant(
    user: AuthenticatedUser,
    input: {
      runId: string;
      version: number;
      userId: string;
      characterId: string;
      role: CharacterRole;
      /** Acknowledged selection warnings for this Character. */
      confirmedWarnings?: RosterWarningAcknowledgement[];
    },
  ) {
    const run = await loadEditableRun(user, input.runId);
    const roster = await rosterRepository.ensure(input.runId);
    await rosterRepository.assertVersion(roster, input.version);
    // A legacy published roster with an unseeded draft is seeded from its live
    // lineup inside the same transaction (addManagedBoosterAtomic).

    const candidate = await signupService.validateManagedBoosterCandidate({
      run,
      userId: input.userId,
      characterId: input.characterId,
      role: input.role,
    });
    const alreadyDraftSelected = candidate.existingSignupId
      ? roster.selectedSignupIds.includes(candidate.existingSignupId)
      : false;
    if (!alreadyDraftSelected) {
      const character = await characterRepository.findOwnedById(input.userId, input.characterId);
      if (character) {
        const scheduleConflicts = await getScheduleConflictsForCharacter({
          targetRunId: input.runId,
          scheduledStartAt: run.scheduledStartAt,
          difficulty: run.difficulty,
          character: { id: character.id, name: character.name, region: character.region },
        });
        assertCharacterSelectableForSchedule(`${character.name}-${character.realm}`, scheduleConflicts);
      }
      // WARNING gate — same semantics as Save Roster; an already published
      // (SELECTED) slot is not a new pick.
      if (candidate.existingSignupStatus !== "SELECTED") {
        assertNewSelectionWarningsConfirmed([
          {
            signupId: candidate.existingSignupId,
            characterId: input.characterId,
            characterLabel: `${candidate.characterName}-${candidate.characterRealm}`,
            contentSaves: candidate.contentSaves,
            acknowledgements: input.confirmedWarnings ?? [],
          },
        ]);
      }
    }

    const result = await rosterRepository.addManagedBoosterAtomic({
      rosterId: roster.id,
      expectedVersion: input.version,
      runId: input.runId,
      runTitle: run.title,
      scheduledStartAt: run.scheduledStartAt,
      userId: input.userId,
      characterId: input.characterId,
      role: input.role,
    });

    if (run.status === "OPEN") {
      assertRunTransition("OPEN", "ROSTERING");
      await runRepository.updateStatus(run.id, "ROSTERING");
      await activityRepository.create({
        userId: user.id,
        type: "ROSTERING_STARTED",
        message: `Started rostering ${run.title}.`,
      });
    }
    await activityRepository.create({
      userId: user.id,
      type: "ROSTER_PLAYER_ADDED",
      message: `${user.name} added ${candidate.characterName} to the roster of ${run.title} as ${CHARACTER_ROLE_LABELS[input.role]}.`,
    });
    return result;
  },

  async preparePublishedRosterForEditing(user: AuthenticatedUser, input: { runId: string; version: number }) {
    const view = await this.getRosterManagementView(user, input.runId);
    if (view.run.status !== "PUBLISHED") {
      throw new DomainError("INVALID_ROSTER_SELECTION", "Only a published roster can be prepared for replacement editing.");
    }
    if (view.roster.version !== input.version) {
      throw new DomainError("ROSTER_ALREADY_CHANGED", "This roster changed since you loaded it. Refresh and try again.");
    }
    const draft = await rosterRepository.findByRunIdFromId(view.roster.id);
    if (draft.selectedSignupIds.length > 0) {
      return;
    }
    const signups = await rosterRepository.listSignups(input.runId);
    // Seeds the replacement draft from the live published selection and its
    // publishedRole snapshot — never from a previously mutated draft role.
    // A historic generic published role is not copied forward. A single
    // concrete assignable role (resolved spec) fills itself in.
    const selections: RosterSelection[] = signups
      .filter((signup) => signup.status === "SELECTED")
      .map((signup) => {
        const assignable = assignableRolesForSignup(signup);
        return {
          signupId: signup.id,
          selectedRole:
            signup.participationType !== "BOOSTER"
              ? null
              : signup.publishedRole && isConcreteCharacterRole(signup.publishedRole)
                ? signup.publishedRole
                : assignable.length === 1
                  ? assignable[0]!
                  : null,
        };
      });
    await rosterRepository.replaceSelectedSignupIds(view.roster.id, input.version, selections);
  },

  async validateDraft(user: AuthenticatedUser, runId: string): Promise<RosterValidationResult> {
    const view = await this.getRosterManagementView(user, runId);
    return view.validation;
  },

  /**
   * Publish Roster.
   * - Never published: the first authoritative publication of the SAVED draft
   *   (validated against the CURRENT Run), Run → PUBLISHED, and one explicit
   *   post intent so the bot posts the first Discord roster message.
   * - Already published (API compatibility): accepts the saved draft like
   *   Update Roster — no new post intent. The roster UI uses updateRoster /
   *   repostRoster for published rosters instead.
   */
  async publishRoster(
    user: AuthenticatedUser,
    input: { runId: string; version: number; acknowledgeWarnings: boolean },
  ) {
    const run = await runRepository.findById(input.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    assertCanManageRun(user, run);
    if (run.status === "IN_PROGRESS" || run.status === "COMPLETED" || run.status === "CANCELLED") {
      throw new DomainError("INVALID_ROSTER_SELECTION", "This run cannot be rostered in its current state.");
    }

    const roster = await rosterRepository.ensure(input.runId);
    await rosterRepository.assertVersion(roster, input.version);
    const signups = await rosterRepository.listSignups(input.runId);

    const publishedSelection = signups.filter((signup) => signup.status === "SELECTED");
    if (
      roster.publishedAt &&
      roster.selectedSignupIds.length === 0 &&
      publishedSelection.length > 0 &&
      roster.version === 1
    ) {
      throw new DomainError(
        "INVALID_ROSTER_SELECTION",
        "Seed the draft from the published roster before publishing a replacement.",
      );
    }

    const plan = await planAuthoritativeRoster(
      run,
      roster,
      signups,
      effectiveSelectionMap(signups, roster.selections),
      input.acknowledgeWarnings,
    );

    await rosterRepository.publishAtomic({
      runId: run.id,
      rosterId: roster.id,
      expectedVersion: input.version,
      ...plan.publish,
      publisherId: user.id,
      runTitle: run.title,
    });
    await runDomainEventService.record({
      runId: run.id,
      actorUser: user,
      type: "ROSTER_PUBLISHED",
      summary: "Roster published.",
      payload: { selectedCount: plan.publish.selectedSelections.length },
    });

    return plan.validation;
  },

  /**
   * Update Roster — the one action for changing an already published roster:
   * the manager's current selection (roles included) is validated against the
   * CURRENT Run (difficulty, schedule, content, composition, access,
   * availability, reservations), saved into the draft and accepted as the
   * published roster in ONE transaction. Clears the "Run changed" flag, keeps
   * the Run PUBLISHED and bumps the version so the CURRENT Discord roster
   * message is edited in place — it never posts a new one. On any failure the
   * previous published roster, the draft and the dirty state stay as they were.
   */
  async updateRoster(
    user: AuthenticatedUser,
    input: {
      runId: string;
      version: number;
      selections: Array<{ signupId: string; selectedRole: CharacterRole | null }>;
      acknowledgeWarnings: boolean;
      /** Acknowledged selection warnings for picks NEW to the roster. */
      confirmedWarnings?: ConfirmedRosterWarning[];
    },
  ) {
    const run = await loadEditableRun(user, input.runId);
    const roster = await rosterRepository.ensure(input.runId);
    await rosterRepository.assertVersion(roster, input.version);
    if (!roster.publishedAt || run.status !== "PUBLISHED") {
      throw new DomainError(
        "INVALID_ROSTER_SELECTION",
        "Publish the roster first — Update Roster changes a published roster.",
      );
    }
    const signups = await rosterRepository.listSignups(input.runId);
    const requested = new Map<string, CharacterRole | null>();
    for (const selection of input.selections) {
      if (requested.has(selection.signupId) && requested.get(selection.signupId) !== selection.selectedRole) {
        throw new DomainError("INVALID_ROSTER_SELECTION", "The same signup was selected twice with different roles.");
      }
      requested.set(selection.signupId, selection.selectedRole);
    }
    const byId = new Map(signups.map((signup) => [signup.id, signup]));
    const persistedRole = new Map(roster.selections.map((selection) => [selection.signupId, selection.selectedRole]));
    const canonical = new Map<string, CharacterRole | null>();
    for (const [signupId, role] of requested) {
      const signup = byId.get(signupId);
      canonical.set(
        signupId,
        signup ? resolveDraftWriteRole(signup, role, persistedRole.get(signupId), true) : role,
      );
    }

    const plan = await planAuthoritativeRoster(run, roster, signups, canonical, input.acknowledgeWarnings);

    // WARNING gate for picks this Update newly introduces — after the plan's
    // hard blockers (schedule conflicts included), before the write. Slots that
    // are already in the saved draft or already published never re-prompt.
    const draftSelectedIds = new Set(roster.selectedSignupIds);
    assertNewSelectionWarningsConfirmed(
      signups
        .filter(
          (signup) =>
            canonical.has(signup.id) &&
            signup.participationType === "BOOSTER" &&
            signup.character &&
            signup.status !== "SELECTED" &&
            signup.status !== "WITHDRAWN" &&
            !draftSelectedIds.has(signup.id),
        )
        .map((signup) => ({
          signupId: signup.id,
          characterId: signup.character!.id,
          characterLabel: `${signup.character!.name}-${signup.character!.realm}`,
          contentSaves: inspectSignup(signup, run).contentSaves,
          acknowledgements: acknowledgementsForSignup(input.confirmedWarnings, signup.id),
        })),
    );

    await rosterRepository.updatePublishedAtomic({
      runId: run.id,
      rosterId: roster.id,
      expectedVersion: input.version,
      draftSelections: plan.publish.selectedSelections,
      ...plan.publish,
      publisherId: user.id,
      runTitle: run.title,
    });
    await runDomainEventService.record({
      runId: run.id,
      actorUser: user,
      type: "ROSTER_SELECTION_CHANGED",
      summary: "Published roster selection updated.",
      payload: { selectedCount: plan.publish.selectedSelections.length },
    });
    return plan.validation;
  },

  /**
   * Publish Roster on an already published, clean roster: asks the bot to
   * refresh the persistent Roster Discord message in place (Draft → Published
   * presentation / republish acknowledgement). Only records the intent —
   * postRevision + 1 with a compare-and-set on the expected version AND
   * postRevision — the bot edits (or creates once if missing). Never changes
   * membership/roles, never notifies players, never appends a second Roster
   * message. A roster with unpublished changes must be updated first.
   */
  async repostRoster(user: AuthenticatedUser, input: { runId: string; version: number; postRevision: number }) {
    const run = await loadEditableRun(user, input.runId);
    if (run.status !== "PUBLISHED") {
      throw new DomainError("INVALID_ROSTER_SELECTION", "Only a published roster can be posted again.");
    }
    const roster = await rosterRepository.ensure(input.runId);
    const result = await rosterRepository.requestRepostAtomic({
      rosterId: roster.id,
      runId: run.id,
      expectedVersion: input.version,
      expectedPostRevision: input.postRevision,
    });
    await activityRepository.create({
      userId: user.id,
      type: "ROSTER_POSTED",
      message: `${user.name} posted the roster of ${run.title} to Discord again.`,
    });
    return result;
  },
};

export type { RosterIssue };
export type RosterManagementView = Awaited<ReturnType<typeof rosterService.getRosterManagementView>>;
export type RosterSignupView = RosterManagementView["groups"]["tanks"][number];
export type { ParticipationType, CharacterRole, SignupStatus };
