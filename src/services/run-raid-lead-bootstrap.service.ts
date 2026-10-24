import type { CharacterRole, RaidDifficulty, RunLootType } from "@/models/enums";
import { characterRepository } from "@/repositories/character.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { evaluateBoosterOptions, type EligibleBoosterOption } from "@/services/signup-eligibility";
import { withSignupEligibilityContext } from "@/services/signup-eligibility-context";

/**
 * Initial Booster signups of a NEW concrete Run: every eligible Character
 * owned by the Run's Raid Lead (`Run.raidLeadId` — never the creator, the
 * Schedule / Run Setup author or the acting user) gets a PENDING, non-backup
 * BOOSTER signup offering the roles a normal signup could offer.
 *
 * Eligibility is the normal booster rule set (`evaluateBoosterOptions`), minus
 * the signup-window check (this is initialization, not a public signup):
 * skipped are inactive Characters, Characters marked unavailable for the
 * difficulty this reset, Characters already selected on a colliding Run,
 * Characters with no performable role, and all Characters when the Raid Lead
 * lacks the Booster role. Nothing is selected, rostered or notified.
 *
 * Only Run creation calls this (manual / Run Setup / Schedule materialization);
 * attaching an existing Run or changing the Raid Lead later never does.
 */

export type InitialBoosterSignup = {
  userId: string;
  characterId: string;
  offeredRoles: CharacterRole[];
};

export type RaidLeadBootstrapRun = {
  raidLeadId: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  scheduledStartAt: string;
  contents: ReadonlyArray<{ raidId: string; sortOrder: number; plannedBossCount: number }>;
};

/** Which signups an eligible option becomes (pure; exported for tests). */
export function toInitialBoosterSignups(raidLeadId: string, eligible: readonly EligibleBoosterOption[]): InitialBoosterSignup[] {
  return eligible
    .filter((option) => option.roles.length > 0)
    .map((option) => ({ userId: raidLeadId, characterId: option.characterId, offeredRoles: [...option.roles] }));
}

/** Read-only planning for one new Run; the caller writes the rows in the Run's creation transaction. */
export async function planRaidLeadBoosterSignups(run: RaidLeadBootstrapRun): Promise<InitialBoosterSignup[]> {
  const owned = await characterRepository.listByUserId(run.raidLeadId);
  if (owned.length === 0) return [];

  const catalog = await raidRepository.loadCatalog();
  const raidById = new Map(catalog.raids.map((raid) => [raid.id, raid]));
  const contents = run.contents.map((content) => {
    const raid = raidById.get(content.raidId);
    return {
      raidId: content.raidId,
      raidName: raid?.name ?? content.raidId,
      sortOrder: content.sortOrder,
      plannedBossCount: content.plannedBossCount,
      totalBossCount: raid?.bosses.length ?? content.plannedBossCount,
      bosses: (raid?.bosses ?? []).map((boss) => ({ id: boss.id, name: boss.name, sortOrder: boss.sortOrder })),
    };
  });

  // The Run is not persisted yet: no own row to exclude from reservation conflicts.
  const pendingRunId = crypto.randomUUID();
  const characters = await withSignupEligibilityContext(owned, pendingRunId, run.scheduledStartAt, run.difficulty);
  const { eligible } = evaluateBoosterOptions(characters, {
    id: pendingRunId,
    difficulty: run.difficulty,
    status: "DRAFT",
    signupsOpen: false,
    scheduledStartAt: run.scheduledStartAt,
    lootType: run.lootType,
    contents,
  });
  return toInitialBoosterSignups(run.raidLeadId, eligible);
}
