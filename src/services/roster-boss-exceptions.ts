import { isConcreteCharacterRole, type ConcreteCharacterRole } from "@/lib/character-roles";
import { DomainError } from "@/lib/errors";
import { isRosterBossExceptionsEnabled } from "@/lib/feature-flags";
import { requiresFreshRaidLockout } from "@/lib/raid-lockout-label";
import {
  bossCompositionWarnings,
  bossLockoutWarnings,
  effectiveBossRoster,
  normalizeBossExceptions,
  plannedRunBosses,
  validateBossExceptions,
  type BossPlanSignup,
  type BossPlanSlot,
  type RosterBossException,
  type RunBoss,
} from "@/lib/roster-boss-plan";
import { resolveSignupAssignableRoles } from "@/lib/signup-assignable-roles";
import type { CharacterRole, RaidDifficulty, RunLootType } from "@/models/enums";
import type { RosterSignupRow } from "@/repositories/roster.repository";
import type { RunRaidContentRecord } from "@/repositories/run.repository";
import { isApprovedBooster } from "@/services/boosting-role.service";
import { getScheduleConflictsForCharacters } from "@/services/character-schedule-conflict.service";
import { lockoutService } from "@/services/lockout.service";

/**
 * Server side of boss-specific roster exceptions: builds the pure plan inputs
 * (lib/roster-boss-plan) from the Run and its signups, runs the hard rules and
 * collects the warnings. Feature-gated: while the switch is off, any boss
 * exception input is refused and existing Runs behave exactly as before.
 */

type BossPlanRun = {
  id: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  scheduledStartAt: string;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  contents: RunRaidContentRecord[];
};

export function runPlannedBosses(run: Pick<BossPlanRun, "contents">): RunBoss[] {
  return plannedRunBosses(
    run.contents.map((content) => ({
      id: content.id,
      raidName: content.raidName,
      raidShortName: content.raidShortName ?? null,
      sortOrder: content.sortOrder,
      plannedBossCount: content.plannedBossCount,
      bosses: content.bosses,
    })),
  );
}

/**
 * The request's boss exceptions, or undefined when the client sent none
 * (older clients / feature off — the saved draft exceptions then stay). With
 * the feature off a non-empty set is refused.
 */
export function requestedBossExceptions(
  value: readonly RosterBossException[] | undefined,
): RosterBossException[] | undefined {
  if (value === undefined) return undefined;
  if (!isRosterBossExceptionsEnabled()) {
    if (value.length === 0) return undefined;
    throw new DomainError("INVALID_ROSTER_SELECTION", "Boss-specific roster assignments are not enabled.");
  }
  return [...value];
}

function characterLabel(signup: RosterSignupRow): string {
  return signup.character ? `${signup.character.name}-${signup.character.realm}` : signup.userName;
}

function bossPlanSignup(signup: RosterSignupRow, scheduleConflictCount: number): BossPlanSignup {
  const character = signup.character;
  const assignableRoles: ConcreteCharacterRole[] =
    signup.participationType === "BOOSTER" && character
      ? resolveSignupAssignableRoles({
          offeredRoles: signup.offeredRoles,
          characterClass: character.wowClass,
          primarySpecialization: character.specialization,
          playableSpecs: character.playableSpecs,
        }).filter((role): role is ConcreteCharacterRole => isConcreteCharacterRole(role))
      : [];
  return {
    id: signup.id,
    userId: signup.userId,
    status: signup.status,
    participationType: signup.participationType,
    characterId: character?.id ?? null,
    characterLabel: characterLabel(signup),
    characterActive: signup.participationType === "LOOTBUDDY" && !character ? true : Boolean(character?.isActive),
    boosterApproved:
      signup.participationType !== "BOOSTER" || !character ? true : isApprovedBooster({ isBooster: character.ownerIsBooster }),
    assignableRoles,
    scheduleConflictCount,
  };
}

export type BossPlanEvaluation = {
  bosses: RunBoss[];
  /** Normalized exceptions of the selected slots (default-restating rows dropped). */
  exceptions: RosterBossException[];
  issues: ReturnType<typeof validateBossExceptions>;
  /** Same shape as roster validation warnings (no signupId: they are per boss range, not per slot). */
  warnings: Array<{ code: string; message: string; signupId?: string }>;
  /** Alternate Characters the plan plays — reserved like selected Characters. */
  alternateCharacterIds: string[];
};

/**
 * Evaluates a boss plan for the given slot selection: hard issues (Save /
 * Update / Publish refuse them) and acknowledgeable warnings (per-boss
 * composition, boss-exact lockouts of alternate assignments). One batched
 * schedule-conflict read for the alternate Characters; everything else is in
 * memory. No exceptions → no work, no warnings.
 */
export async function evaluateBossPlan(input: {
  run: BossPlanRun;
  signups: readonly RosterSignupRow[];
  /** Selected slot → assigned role (LOOTBUDDY: null). */
  selections: ReadonlyMap<string, CharacterRole | null>;
  externalRoles: readonly (CharacterRole | null)[];
  exceptions: readonly RosterBossException[];
}): Promise<BossPlanEvaluation> {
  const bosses = runPlannedBosses(input.run);
  const signupsById = new Map(input.signups.map((signup) => [signup.id, signup]));
  const slots = new Map<string, BossPlanSlot>();
  for (const [signupId, role] of input.selections) {
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
  const exceptions = normalizeBossExceptions(
    input.exceptions.filter((row) => slots.has(row.slotSignupId)),
    slots,
  );
  if (exceptions.length === 0) {
    return { bosses, exceptions, issues: [], warnings: [], alternateCharacterIds: [] };
  }

  const alternateSignups = [...new Set(exceptions.map((row) => row.playSignupId).filter((id): id is string => id != null))]
    .map((id) => signupsById.get(id))
    .filter((signup): signup is RosterSignupRow => signup != null);
  const alternateCharacters = alternateSignups
    .filter((signup) => signup.character)
    .map((signup) => ({ id: signup.character!.id, name: signup.character!.name, region: signup.character!.region }));
  const conflictsByCharacter =
    alternateCharacters.length > 0
      ? await getScheduleConflictsForCharacters({
          targetRunId: input.run.id,
          scheduledStartAt: input.run.scheduledStartAt,
          difficulty: input.run.difficulty,
          characters: alternateCharacters,
        })
      : new Map();

  const planSignups = new Map<string, BossPlanSignup>();
  for (const signup of input.signups) {
    const conflicts = signup.character ? (conflictsByCharacter.get(signup.character.id)?.length ?? 0) : 0;
    planSignups.set(signup.id, bossPlanSignup(signup, alternateSignups.includes(signup) ? conflicts : 0));
  }
  const issues = validateBossExceptions({ bosses, slots, signups: planSignups, exceptions });

  const effective = effectiveBossRoster({
    bosses,
    slots: [...slots.values()],
    exceptions,
    characterBySignupId: new Map(input.signups.map((signup) => [signup.id, signup.character?.id ?? null])),
  });
  const raidIdByContentId = new Map(input.run.contents.map((content) => [content.id, content.raidId]));
  const fresh = requiresFreshRaidLockout(input.run.lootType);
  const characterById = new Map(
    input.signups.filter((signup) => signup.character).map((signup) => [signup.character!.id, signup.character!]),
  );
  const warnings = [
    ...bossCompositionWarnings({
      bosses,
      effective,
      externalRoles: input.externalRoles,
      targets: { tanks: input.run.desiredTankCount, healers: input.run.desiredHealerCount, dps: input.run.desiredDpsCount },
    }),
    ...(fresh
      ? bossLockoutWarnings({
          bosses,
          effective,
          characterLabelBySignupId: new Map(input.signups.map((signup) => [signup.id, characterLabel(signup)])),
          isSavedOnBoss: (characterId, boss) => {
            const character = characterById.get(characterId);
            const raidId = raidIdByContentId.get(boss.runRaidContentId);
            if (!character || !raidId) return false;
            const lockout = lockoutService.findExactLockout(character.lockouts, {
              raidId,
              difficulty: input.run.difficulty,
              resetIdentifier: lockoutService.getResetIdentifierForRun(character.region, input.run.scheduledStartAt),
            });
            // A full clear is saved on every boss, even from an older sync without boss ids.
            return Boolean(lockout && (lockout.isComplete || lockout.killedBossIds?.includes(boss.raidBossId)));
          },
        })
      : []),
  ].map((warning) => ({ code: warning.code, message: warning.message }));

  return {
    bosses,
    exceptions,
    issues,
    warnings,
    alternateCharacterIds: alternateCharacters.map((character) => character.id),
  };
}

/** Save / Update / Publish refuse a plan with hard issues — the first one is reported. */
export function assertBossPlanValid(evaluation: Pick<BossPlanEvaluation, "issues">): void {
  const issue = evaluation.issues[0];
  if (issue) throw new DomainError("INVALID_ROSTER_SELECTION", issue.message);
}
