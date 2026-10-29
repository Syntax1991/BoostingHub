import { isConcreteCharacterRole, type ConcreteCharacterRole } from "@/lib/character-roles";
import { requiresFreshRaidLockout } from "@/lib/raid-lockout-label";
import {
  bossCompositionWarnings,
  bossExceptionFingerprint,
  bossLockoutWarnings,
  effectiveBossRoster,
  normalizeBossExceptions,
  validateBossExceptions,
  type BossPlanIssue,
  type BossPlanSignup,
  type BossPlanSlot,
  type RosterBossException,
  type RunBoss,
} from "@/lib/roster-boss-plan";
import type { RunContentRaidSaveInfo } from "@/lib/run-content-lockouts";
import type { CharacterRole, ParticipationType, RunLootType, SignupStatus } from "@/models/enums";

/**
 * Roster Builder side of boss-specific exceptions: the boss range picker,
 * the per-slot Character / role choices for that range, staging edits into
 * the full DRAFT exception set, and the live per-boss warnings. Pure — the
 * server re-validates everything on Save / Update with the same lib rules.
 */

/** What the editor needs to know about a signup (a Roster view booster card fits). */
export type BossPlanEditorSignup = {
  id: string;
  userId: string;
  status: SignupStatus;
  participationType: ParticipationType;
  character: { id: string; name: string; realm: string } | null;
  characterActive: boolean;
  boosterApproved: boolean;
  assignableRoles: readonly CharacterRole[];
  scheduleConflicts?: readonly unknown[] | null;
  contentSaves?: readonly Pick<RunContentRaidSaveInfo, "sortOrder" | "raidSave">[] | null;
};

/** Selected boss range: from `anchor` to `end` in Run order (equal = one boss). */
export type BossRange = { anchor: string; end: string };

export function signupCharacterLabel(signup: Pick<BossPlanEditorSignup, "character">): string {
  return signup.character ? `${signup.character.name}-${signup.character.realm}` : "Unknown character";
}

/** The planned bosses inside the range, in Run order (contiguous across Bundle contents). */
export function bossesInRange(bosses: readonly RunBoss[], range: BossRange | null): RunBoss[] {
  if (!range) return [];
  const from = bosses.findIndex((boss) => boss.key === range.anchor);
  const to = bosses.findIndex((boss) => boss.key === range.end);
  if (from < 0 || to < 0) return [];
  return bosses.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/**
 * Range picker click, like a date range picker: with one boss selected a
 * click on another boss extends the range to it; otherwise (nothing selected,
 * a range already selected, or the same boss again) the click selects just
 * that boss.
 */
export function nextBossRange(current: BossRange | null, clickedKey: string): BossRange {
  if (current && current.anchor === current.end && current.anchor !== clickedKey) {
    return { anchor: current.anchor, end: clickedKey };
  }
  return { anchor: clickedKey, end: clickedKey };
}

export type SlotCharacterChoice = {
  /** null = the slot's own Character. */
  playSignupId: string | null;
  label: string;
  roles: ConcreteCharacterRole[];
  /** The plan's current pick, no longer offered (alternate became ineligible) — shown, not choosable. */
  unavailable?: boolean;
};

/**
 * Characters a slot can play: its own, then every other signed-up Booster
 * Character of the same player that the server would accept (not withdrawn,
 * active, Booster role, no schedule conflict, not itself a roster slot — so a
 * player is never double-booked).
 */
export function slotCharacterChoices(
  slot: BossPlanEditorSignup,
  signups: readonly BossPlanEditorSignup[],
  stagedSlotIds: ReadonlySet<string>,
): SlotCharacterChoice[] {
  const concrete = (roles: readonly CharacterRole[]) =>
    roles.filter((role): role is ConcreteCharacterRole => isConcreteCharacterRole(role));
  const alternates = signups.filter(
    (other) =>
      other.id !== slot.id &&
      other.userId === slot.userId &&
      other.participationType === "BOOSTER" &&
      other.status !== "WITHDRAWN" &&
      other.character != null &&
      other.characterActive &&
      other.boosterApproved &&
      (other.scheduleConflicts?.length ?? 0) === 0 &&
      !stagedSlotIds.has(other.id) &&
      concrete(other.assignableRoles).length > 0,
  );
  return [
    { playSignupId: null, label: signupCharacterLabel(slot), roles: concrete(slot.assignableRoles) },
    ...alternates
      .map((other) => ({ playSignupId: other.id, label: signupCharacterLabel(other), roles: concrete(other.assignableRoles) }))
      .sort((left, right) => left.label.localeCompare(right.label, "en-US")),
  ];
}

/** A slot can deviate at all: another Character, or more than one role on its own. */
export function slotHasBossChoices(choices: readonly SlotCharacterChoice[]): boolean {
  return choices.length > 1 || (choices[0]?.roles.length ?? 0) > 1;
}

/**
 * Slots the Boss plan lists: every slot that can deviate, plus every slot
 * that already deviates even when nothing else is choosable now (its
 * alternate became ineligible) — so it can still be seen and reset.
 */
export function bossPlanRows<Slot extends { signup: BossPlanEditorSignup }>(input: {
  slots: readonly Slot[];
  signups: readonly BossPlanEditorSignup[];
  stagedSlotIds: ReadonlySet<string>;
  exceptions: readonly RosterBossException[];
}): Array<{ slot: Slot; choices: SlotCharacterChoice[] }> {
  return input.slots
    .map((slot) => ({ slot, choices: slotCharacterChoices(slot.signup, input.signups, input.stagedSlotIds) }))
    .filter(
      (row) =>
        slotHasBossChoices(row.choices) || input.exceptions.some((exception) => exception.slotSignupId === row.slot.signup.id),
    );
}

export type SlotAssignment = { playSignupId: string | null; role: CharacterRole | null };

function sameBoss(row: RosterBossException, boss: RunBoss): boolean {
  return row.runRaidContentId === boss.runRaidContentId && row.raidBossId === boss.raidBossId;
}

/**
 * What the slot plays on the range: one assignment when every boss agrees
 * (the default where it has no exception), "MIXED" otherwise.
 */
export function rangeAssignment(input: {
  exceptions: readonly RosterBossException[];
  slotSignupId: string;
  slotRole: CharacterRole | null;
  range: readonly RunBoss[];
}): SlotAssignment | "MIXED" {
  let result: SlotAssignment | null = null;
  for (const boss of input.range) {
    const row = input.exceptions.find((candidate) => candidate.slotSignupId === input.slotSignupId && sameBoss(candidate, boss));
    const assignment: SlotAssignment = row ? { playSignupId: row.playSignupId, role: row.role } : { playSignupId: null, role: input.slotRole };
    if (result && (result.playSignupId !== assignment.playSignupId || result.role !== assignment.role)) return "MIXED";
    result = assignment;
  }
  return result ?? { playSignupId: null, role: input.slotRole };
}

/**
 * The choices as the selects show them for the range: a saved pick that is
 * no longer offered (alternate deactivated, lost the Booster role, got a
 * schedule conflict; or a role the Character no longer offers) stays visible
 * and marked, so the select never silently shows another Character. The
 * plan's hard issue explains it; Reset or another pick fixes it.
 */
export function choicesWithCurrent(
  choices: readonly SlotCharacterChoice[],
  current: SlotAssignment | "MIXED",
  signups: readonly BossPlanEditorSignup[],
): SlotCharacterChoice[] {
  if (current === "MIXED") return [...choices];
  const role = current.role && isConcreteCharacterRole(current.role) ? current.role : null;
  const index = choices.findIndex((choice) => choice.playSignupId === current.playSignupId);
  if (index < 0) {
    const signup = signups.find((row) => row.id === current.playSignupId);
    return [
      ...choices,
      {
        playSignupId: current.playSignupId,
        label: `${signup ? signupCharacterLabel(signup) : "Other Character"} (not available)`,
        roles: role ? [role] : [],
        unavailable: true,
      },
    ];
  }
  const choice = choices[index]!;
  if (!role || choice.roles.includes(role)) return [...choices];
  return choices.map((row, position) => (position === index ? { ...row, roles: [...row.roles, role] } : row));
}

/**
 * Sets the slot's assignment for every boss of the range: its exceptions
 * there are replaced; an assignment equal to the slot's default leaves no row
 * (the normal roster stays the baseline).
 */
export function applyRangeAssignment(input: {
  exceptions: readonly RosterBossException[];
  slotSignupId: string;
  slotRole: CharacterRole | null;
  range: readonly RunBoss[];
  assignment: { playSignupId: string | null; role: CharacterRole };
}): RosterBossException[] {
  const kept = input.exceptions.filter(
    (row) => row.slotSignupId !== input.slotSignupId || !input.range.some((boss) => sameBoss(row, boss)),
  );
  const isDefault = input.assignment.playSignupId == null && input.assignment.role === input.slotRole;
  if (isDefault) return kept;
  return [
    ...kept,
    ...input.range.map((boss) => ({
      slotSignupId: input.slotSignupId,
      runRaidContentId: boss.runRaidContentId,
      raidBossId: boss.raidBossId,
      playSignupId: input.assignment.playSignupId,
      role: input.assignment.role,
    })),
  ];
}

/** Back to the normal roster for this slot on the range (all bosses when range is omitted). */
export function resetSlotBosses(
  exceptions: readonly RosterBossException[],
  slotSignupId: string,
  range?: readonly RunBoss[],
): RosterBossException[] {
  return exceptions.filter(
    (row) => row.slotSignupId !== slotSignupId || (range != null && !range.some((boss) => sameBoss(row, boss))),
  );
}

/**
 * The DRAFT set sent with Save / Update: exceptions of staged Booster slots
 * only, minus rows the staged roster made meaningless (the alternate became a
 * slot itself or left the signups, the boss is no longer planned), normalized
 * so a row restating the slot's current role disappears.
 */
export function bossExceptionsPayload(input: {
  exceptions: readonly RosterBossException[];
  staged: ReadonlyMap<string, CharacterRole | null>;
  signups: readonly BossPlanEditorSignup[];
  bosses: readonly RunBoss[];
}): RosterBossException[] {
  const signupsById = new Map(input.signups.map((signup) => [signup.id, signup]));
  const plannedKeys = new Set(input.bosses.map((boss) => boss.key));
  const slots = new Map<string, { role: CharacterRole | null }>();
  for (const [signupId, role] of input.staged) {
    if (signupsById.get(signupId)?.participationType === "BOOSTER") slots.set(signupId, { role });
  }
  return normalizeBossExceptions(
    input.exceptions.filter(
      (row) =>
        slots.has(row.slotSignupId) &&
        plannedKeys.has(`${row.runRaidContentId}:${row.raidBossId}`) &&
        (row.playSignupId == null || (signupsById.has(row.playSignupId) && !input.staged.has(row.playSignupId))),
    ),
    slots,
  );
}

/** Local boss plan edits differ from the saved draft plan. */
export function bossPlanIsDirty(payload: readonly RosterBossException[], savedDraft: readonly RosterBossException[]): boolean {
  return bossExceptionFingerprint(payload) !== bossExceptionFingerprint(savedDraft);
}

export type LiveBossPlanEvaluation = {
  issues: BossPlanIssue[];
  /** Same messages the server reports with the roster validation. */
  warnings: Array<{ code: string; message: string; bossKeys: string[] }>;
};

/**
 * Live per-boss check of the staged plan with the server's rules: hard issues
 * (Update / Publish are refused) and acknowledgeable warnings — per-boss
 * Tank / Healer / DPS shortfalls and boss-exact lockouts of the Character
 * that plays a boss. Nothing for a plan without exceptions.
 */
export function evaluateLiveBossPlan(input: {
  bosses: readonly RunBoss[];
  payload: readonly RosterBossException[];
  staged: ReadonlyMap<string, CharacterRole | null>;
  signups: readonly BossPlanEditorSignup[];
  externalRoles: readonly (CharacterRole | null)[];
  targets: { tanks: number; healers: number; dps: number };
  lootType: RunLootType;
}): LiveBossPlanEvaluation {
  if (input.payload.length === 0) return { issues: [], warnings: [] };
  const signupsById = new Map(input.signups.map((signup) => [signup.id, signup]));
  const slots = new Map<string, BossPlanSlot>();
  for (const [signupId, role] of input.staged) {
    const signup = signupsById.get(signupId);
    if (!signup || signup.status === "WITHDRAWN") continue;
    slots.set(signupId, {
      signupId,
      userId: signup.userId,
      participationType: signup.participationType,
      characterId: signup.character?.id ?? null,
      role: signup.participationType === "BOOSTER" ? role : null,
    });
  }
  const planSignups = new Map<string, BossPlanSignup>(
    input.signups.map((signup) => [
      signup.id,
      {
        id: signup.id,
        userId: signup.userId,
        status: signup.status,
        participationType: signup.participationType,
        characterId: signup.character?.id ?? null,
        characterLabel: signupCharacterLabel(signup),
        characterActive: signup.characterActive,
        boosterApproved: signup.boosterApproved,
        assignableRoles: signup.assignableRoles.filter((role): role is ConcreteCharacterRole => isConcreteCharacterRole(role)),
        scheduleConflictCount: signup.scheduleConflicts?.length ?? 0,
      },
    ]),
  );
  const issues = validateBossExceptions({ bosses: input.bosses, slots, signups: planSignups, exceptions: input.payload });
  const effective = effectiveBossRoster({
    bosses: input.bosses,
    slots: [...slots.values()],
    exceptions: input.payload,
    characterBySignupId: new Map(input.signups.map((signup) => [signup.id, signup.character?.id ?? null])),
  });
  const signupByCharacterId = new Map(
    input.signups.filter((signup) => signup.character).map((signup) => [signup.character!.id, signup]),
  );
  const warnings = [
    ...bossCompositionWarnings({ bosses: input.bosses, effective, externalRoles: input.externalRoles, targets: input.targets }),
    ...(requiresFreshRaidLockout(input.lootType)
      ? bossLockoutWarnings({
          bosses: input.bosses,
          effective,
          characterLabelBySignupId: new Map(input.signups.map((signup) => [signup.id, signupCharacterLabel(signup)])),
          isSavedOnBoss: (characterId, boss) => {
            const save = signupByCharacterId
              .get(characterId)
              ?.contentSaves?.find((row) => row.sortOrder === boss.contentOrder)?.raidSave;
            // A full clear is saved on every boss, even from an older sync without boss ids.
            return Boolean(save && (save.isComplete || save.killedBossIds?.includes(boss.raidBossId)));
          },
        })
      : []),
  ].map((warning) => ({ code: warning.code, message: warning.message, bossKeys: warning.bossKeys }));
  return { issues, warnings };
}
