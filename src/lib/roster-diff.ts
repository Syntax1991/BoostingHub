import {
  bossExceptionFingerprint,
  describeSlotBossPlan,
  type RosterBossException,
  type RunBoss,
} from "@/lib/roster-boss-plan";
import type { CharacterRole, ParticipationType } from "@/models/enums";

/**
 * Update Roster preview: what the current draft changes against the PUBLISHED
 * roster. Identity is the RunSignup (and, for a Booster Character swap, the
 * owning User under the one-Booster-per-User rule) — never row order.
 * External Boosters are live roster data, not draft data, so they never
 * appear here.
 */

export type RosterDiffMember = {
  signupId: string;
  userId: string;
  participationType: ParticipationType;
  /** Assigned Booster role; null for Lootbuddies. */
  role: CharacterRole | null;
  /** e.g. "Synmist-Antonidas", or the Lootbuddy class label. */
  label: string;
};

export type RosterDiffChange =
  | { kind: "ADDED"; member: RosterDiffMember }
  | { kind: "REMOVED"; member: RosterDiffMember }
  | { kind: "CHARACTER_CHANGED"; from: RosterDiffMember; to: RosterDiffMember }
  | { kind: "ROLE_CHANGED"; member: RosterDiffMember; fromRole: CharacterRole | null }
  /** Boss exceptions of a slot that stays on the roster changed; null = plays every boss by default. */
  | { kind: "BOSS_PLAN_CHANGED"; member: RosterDiffMember; before: string | null; after: string | null };

const KIND_ORDER: Record<RosterDiffChange["kind"], number> = {
  ADDED: 0,
  REMOVED: 1,
  CHARACTER_CHANGED: 2,
  ROLE_CHANGED: 3,
  BOSS_PLAN_CHANGED: 4,
};

function changeLabel(change: RosterDiffChange): string {
  return change.kind === "CHARACTER_CHANGED" ? change.from.label : change.member.label;
}

export function diffRoster(
  published: readonly RosterDiffMember[],
  draft: readonly RosterDiffMember[],
): RosterDiffChange[] {
  const publishedById = new Map(published.map((member) => [member.signupId, member]));
  const draftById = new Map(draft.map((member) => [member.signupId, member]));
  const changes: RosterDiffChange[] = [];

  for (const member of draft) {
    const before = publishedById.get(member.signupId);
    if (before && member.participationType === "BOOSTER" && before.role !== member.role) {
      changes.push({ kind: "ROLE_CHANGED", member, fromRole: before.role });
    }
  }

  const added = draft.filter((member) => !publishedById.has(member.signupId));
  const removed = published.filter((member) => !draftById.has(member.signupId));
  // A User holds at most one Booster slot: their removed + added Booster rows are one Character change.
  const removedBoosterByUser = new Map(
    removed.filter((member) => member.participationType === "BOOSTER").map((member) => [member.userId, member]),
  );
  const swappedOut = new Set<string>();
  for (const member of added) {
    const from = member.participationType === "BOOSTER" ? removedBoosterByUser.get(member.userId) : undefined;
    if (from && !swappedOut.has(from.signupId)) {
      swappedOut.add(from.signupId);
      changes.push({ kind: "CHARACTER_CHANGED", from, to: member });
    } else {
      changes.push({ kind: "ADDED", member });
    }
  }
  for (const member of removed) {
    if (!swappedOut.has(member.signupId)) changes.push({ kind: "REMOVED", member });
  }

  return changes.sort(
    (left, right) =>
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
      changeLabel(left).localeCompare(changeLabel(right), "en-US"),
  );
}

/**
 * Boss plan changes of slots on both sides (an added or removed slot is
 * already its own +/− line). Compares the canonical exception sets, so row
 * order never shows up as a change.
 */
export function diffBossPlans(input: {
  published: readonly RosterBossException[];
  draft: readonly RosterBossException[];
  /** Draft members by slot signup id — only slots also on the published roster are compared. */
  members: ReadonlyMap<string, RosterDiffMember>;
  publishedSlotIds: ReadonlySet<string>;
  bosses: readonly RunBoss[];
  characterLabelBySignupId: ReadonlyMap<string, string>;
}): RosterDiffChange[] {
  const changes: RosterDiffChange[] = [];
  for (const [slotSignupId, member] of input.members) {
    if (!input.publishedSlotIds.has(slotSignupId)) continue;
    const before = input.published.filter((row) => row.slotSignupId === slotSignupId);
    const after = input.draft.filter((row) => row.slotSignupId === slotSignupId);
    if (bossExceptionFingerprint(before) === bossExceptionFingerprint(after)) continue;
    const describe = (rows: readonly RosterBossException[]) =>
      describeSlotBossPlan({ exceptions: rows, bosses: input.bosses, characterLabelBySignupId: input.characterLabelBySignupId });
    changes.push({ kind: "BOSS_PLAN_CHANGED", member, before: describe(before), after: describe(after) });
  }
  return changes.sort((left, right) => changeLabel(left).localeCompare(changeLabel(right), "en-US"));
}
