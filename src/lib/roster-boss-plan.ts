import { isConcreteCharacterRole, type ConcreteCharacterRole } from "@/lib/character-roles";
import { CHARACTER_ROLE_LABELS } from "@/lib/labels";
import type { CharacterRole, ParticipationType, SignupStatus } from "@/models/enums";

/**
 * Boss-specific roster plan: the Run's default roster plus per-boss
 * exceptions (another of the player's own signed-up Characters and/or another
 * role for some planned bosses). Pure — no queries. A Run without exceptions
 * yields exactly its default roster for every boss, so nothing about it
 * changes.
 */

/** One planned boss of a Run, in Run order (content sortOrder, then boss sortOrder). */
export type RunBoss = {
  /** `${runRaidContentId}:${raidBossId}` — unique within the Run, also for Bundles. */
  key: string;
  runRaidContentId: string;
  raidBossId: string;
  bossName: string;
  raidName: string;
  raidShortName: string | null;
  contentOrder: number;
  /** 1-based position within its content. */
  bossNumber: number;
};

export type RunBossContentInput = {
  id: string;
  raidName: string;
  raidShortName?: string | null;
  sortOrder: number;
  plannedBossCount: number;
  bosses: ReadonlyArray<{ id: string; name: string; sortOrder: number }>;
};

export function runBossKey(runRaidContentId: string, raidBossId: string): string {
  return `${runRaidContentId}:${raidBossId}`;
}

/** Planned bosses = the first `plannedBossCount` bosses of each content by sortOrder (6/8 → bosses 1–6). */
export function plannedRunBosses(contents: readonly RunBossContentInput[]): RunBoss[] {
  const bosses: RunBoss[] = [];
  for (const content of [...contents].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const planned = [...content.bosses].sort((a, b) => a.sortOrder - b.sortOrder).slice(0, content.plannedBossCount);
    planned.forEach((boss, index) => {
      bosses.push({
        key: runBossKey(content.id, boss.id),
        runRaidContentId: content.id,
        raidBossId: boss.id,
        bossName: boss.name,
        raidName: content.raidName,
        raidShortName: content.raidShortName ?? null,
        contentOrder: content.sortOrder,
        bossNumber: index + 1,
      });
    });
  }
  return bosses;
}

/**
 * Compact boss ranges in Run order: "Boss 5–8", "Boss 1–2, 4". Bundles prefix
 * each content's short name: "Venom 7–8, Tide 1".
 */
export function formatBossRanges(selected: readonly RunBoss[], all: readonly RunBoss[]): string {
  const multiContent = new Set(all.map((boss) => boss.runRaidContentId)).size > 1;
  const keys = new Set(selected.map((boss) => boss.key));
  const parts: string[] = [];
  const byContent = new Map<string, RunBoss[]>();
  for (const boss of all) {
    if (!keys.has(boss.key)) continue;
    const list = byContent.get(boss.runRaidContentId) ?? [];
    list.push(boss);
    byContent.set(boss.runRaidContentId, list);
  }
  for (const list of byContent.values()) {
    const ranges: string[] = [];
    let start = list[0]!.bossNumber;
    let previous = start;
    const flush = () => ranges.push(start === previous ? `${start}` : `${start}–${previous}`);
    for (const boss of list.slice(1)) {
      if (boss.bossNumber === previous + 1) {
        previous = boss.bossNumber;
        continue;
      }
      flush();
      start = boss.bossNumber;
      previous = start;
    }
    flush();
    const prefix = multiContent ? (list[0]!.raidShortName ?? list[0]!.raidName) : "Boss";
    parts.push(`${prefix} ${ranges.join(", ")}`);
  }
  return parts.join(", ");
}

/** One stored exception (either stage). */
export type RosterBossException = {
  slotSignupId: string;
  runRaidContentId: string;
  raidBossId: string;
  /** Null = the slot's own Character. */
  playSignupId: string | null;
  role: CharacterRole;
};

/** A roster slot as the default plan sees it. */
export type BossPlanSlot = {
  signupId: string;
  userId: string;
  participationType: ParticipationType;
  characterId: string | null;
  role: CharacterRole | null;
};

/** What the validation needs to know about any signup of the Run (slot or alternate Character). */
export type BossPlanSignup = {
  id: string;
  userId: string;
  status: SignupStatus;
  participationType: ParticipationType;
  characterId: string | null;
  characterLabel: string;
  characterActive: boolean;
  boosterApproved: boolean;
  assignableRoles: readonly ConcreteCharacterRole[];
  scheduleConflictCount: number;
};

export type BossPlanIssue = {
  code:
    | "BOSS_EXCEPTION_SLOT_INVALID"
    | "BOSS_EXCEPTION_BOSS_NOT_PLANNED"
    | "BOSS_EXCEPTION_DUPLICATE"
    | "BOSS_EXCEPTION_CHARACTER_INVALID"
    | "BOSS_EXCEPTION_ROLE_INVALID";
  slotSignupId: string;
  message: string;
};

function exceptionKey(row: Pick<RosterBossException, "slotSignupId" | "runRaidContentId" | "raidBossId">): string {
  return `${row.slotSignupId}|${row.runRaidContentId}|${row.raidBossId}`;
}

/**
 * Drops exceptions that only restate the slot's default (same Character, same
 * role) and folds playSignupId === slot to null, so equal plans always compare
 * equal. Deterministic order: slot, content, boss.
 */
export function normalizeBossExceptions(
  exceptions: readonly RosterBossException[],
  slots: ReadonlyMap<string, Pick<BossPlanSlot, "role">>,
): RosterBossException[] {
  return exceptions
    .map((row) => ({ ...row, playSignupId: row.playSignupId === row.slotSignupId ? null : row.playSignupId }))
    .filter((row) => !(row.playSignupId == null && slots.get(row.slotSignupId)?.role === row.role))
    .sort((a, b) => exceptionKey(a).localeCompare(exceptionKey(b)));
}

/**
 * Hard rules for draft exceptions (Save / Update are refused on any of them):
 * the slot is a selected BOOSTER slot; the boss is a PLANNED boss of that very
 * Run content; at most one exception per slot and boss (so a player holds at
 * most one Booster slot per boss); an alternate Character is a non-withdrawn
 * BOOSTER signup of the SAME player on this Run, active, owner still a
 * Booster, without schedule conflict / reservation, and not itself a roster
 * slot; the role is concrete and one the playing signup offered.
 */
export function validateBossExceptions(input: {
  bosses: readonly RunBoss[];
  slots: ReadonlyMap<string, BossPlanSlot>;
  signups: ReadonlyMap<string, BossPlanSignup>;
  exceptions: readonly RosterBossException[];
}): BossPlanIssue[] {
  const issues: BossPlanIssue[] = [];
  const bossByKey = new Map(input.bosses.map((boss) => [boss.key, boss]));
  const seen = new Set<string>();
  for (const row of input.exceptions) {
    const slot = input.slots.get(row.slotSignupId);
    if (!slot || slot.participationType !== "BOOSTER") {
      issues.push({
        code: "BOSS_EXCEPTION_SLOT_INVALID",
        slotSignupId: row.slotSignupId,
        message: "A boss exception needs a selected Booster slot.",
      });
      continue;
    }
    const slotLabel = input.signups.get(slot.signupId)?.characterLabel ?? "This slot";
    const boss = bossByKey.get(runBossKey(row.runRaidContentId, row.raidBossId));
    if (!boss) {
      issues.push({
        code: "BOSS_EXCEPTION_BOSS_NOT_PLANNED",
        slotSignupId: row.slotSignupId,
        message: `${slotLabel}: the boss is not a planned boss of this Run.`,
      });
      continue;
    }
    const key = exceptionKey(row);
    if (seen.has(key)) {
      issues.push({
        code: "BOSS_EXCEPTION_DUPLICATE",
        slotSignupId: row.slotSignupId,
        message: `${slotLabel}: ${boss.bossName} has more than one assignment.`,
      });
      continue;
    }
    seen.add(key);

    const playSignupId = row.playSignupId ?? row.slotSignupId;
    const play = input.signups.get(playSignupId);
    if (!play) {
      issues.push({
        code: "BOSS_EXCEPTION_CHARACTER_INVALID",
        slotSignupId: row.slotSignupId,
        message: `${slotLabel}: the Character for ${boss.bossName} is not signed up for this Run.`,
      });
      continue;
    }
    if (row.playSignupId != null) {
      const reason =
        play.userId !== slot.userId
          ? "belongs to another player"
          : play.participationType !== "BOOSTER"
            ? "is not a Booster signup"
            : play.status === "WITHDRAWN"
              ? "was withdrawn"
              : !play.characterActive
                ? "is inactive"
                : !play.boosterApproved
                  ? "has no Booster role"
                  : play.scheduleConflictCount > 0
                    ? "has a schedule conflict"
                    : input.slots.has(play.id)
                      ? "already holds its own roster slot"
                      : null;
      if (reason) {
        issues.push({
          code: "BOSS_EXCEPTION_CHARACTER_INVALID",
          slotSignupId: row.slotSignupId,
          message: `${slotLabel}: ${play.characterLabel} ${reason} (${boss.bossName}).`,
        });
        continue;
      }
    }
    if (!isConcreteCharacterRole(row.role) || !play.assignableRoles.includes(row.role)) {
      issues.push({
        code: "BOSS_EXCEPTION_ROLE_INVALID",
        slotSignupId: row.slotSignupId,
        message: `${slotLabel}: ${play.characterLabel} cannot play ${CHARACTER_ROLE_LABELS[row.role] ?? row.role} (${boss.bossName}).`,
      });
    }
  }
  return issues;
}

export type BossAssignment = {
  slotSignupId: string;
  userId: string;
  /** The signup whose Character plays this boss (slot or alternate). */
  playSignupId: string;
  characterId: string | null;
  participationType: ParticipationType;
  role: CharacterRole | null;
  isException: boolean;
};

/**
 * Who plays which boss: every selected slot with its default Character and
 * role, overridden by that slot's exception for the boss. Exceptions of slots
 * that are no longer selected are ignored. External Boosters always play
 * every boss in their role.
 */
export function effectiveBossRoster(input: {
  bosses: readonly RunBoss[];
  slots: readonly BossPlanSlot[];
  exceptions: readonly RosterBossException[];
  /** Character of each signup that may be played (slots and alternates). */
  characterBySignupId: ReadonlyMap<string, string | null>;
}): Map<string, BossAssignment[]> {
  const exceptionByKey = new Map(input.exceptions.map((row) => [exceptionKey(row), row]));
  const result = new Map<string, BossAssignment[]>();
  for (const boss of input.bosses) {
    const assignments: BossAssignment[] = [];
    for (const slot of input.slots) {
      const exception =
        slot.participationType === "BOOSTER"
          ? exceptionByKey.get(
              exceptionKey({ slotSignupId: slot.signupId, runRaidContentId: boss.runRaidContentId, raidBossId: boss.raidBossId }),
            )
          : undefined;
      const playSignupId = exception?.playSignupId ?? slot.signupId;
      assignments.push({
        slotSignupId: slot.signupId,
        userId: slot.userId,
        playSignupId,
        characterId: exception?.playSignupId
          ? (input.characterBySignupId.get(exception.playSignupId) ?? null)
          : slot.characterId,
        participationType: slot.participationType,
        role: exception ? exception.role : slot.role,
        isException: Boolean(exception),
      });
    }
    result.set(boss.key, assignments);
  }
  return result;
}

type Bucket = "TANK" | "HEALER" | "DPS";

const BUCKET_LABEL: Record<Bucket, { one: string; many: string }> = {
  TANK: { one: "Tank", many: "Tanks" },
  HEALER: { one: "Healer", many: "Healers" },
  DPS: { one: "DPS", many: "DPS" },
};

function bucketOf(role: CharacterRole | null): Bucket | null {
  if (role === "TANK") return "TANK";
  if (role === "HEALER") return "HEALER";
  if (role === "MELEE_DPS" || role === "RANGED_DPS") return "DPS";
  return null;
}

/**
 * Per-boss composition warnings — only for bosses touched by an exception
 * (the default roster's composition is already reported by the existing
 * roster validation, so nothing is reported twice and a Run without
 * exceptions gets no new warning). Equal shortfalls on neighbouring bosses
 * are grouped: "Boss 7–8: 2 of 3 Healers".
 */
export function bossCompositionWarnings(input: {
  bosses: readonly RunBoss[];
  effective: ReadonlyMap<string, readonly BossAssignment[]>;
  externalRoles: readonly (CharacterRole | null)[];
  targets: { tanks: number; healers: number; dps: number };
}): Array<{ code: "BOSS_COMPOSITION"; bucket: Bucket; bossKeys: string[]; message: string }> {
  const target: Record<Bucket, number> = { TANK: input.targets.tanks, HEALER: input.targets.healers, DPS: input.targets.dps };
  const groups = new Map<string, { bucket: Bucket; staffed: number; bosses: RunBoss[] }>();
  for (const boss of input.bosses) {
    const assignments = input.effective.get(boss.key) ?? [];
    if (!assignments.some((row) => row.isException)) continue;
    const staffed: Record<Bucket, number> = { TANK: 0, HEALER: 0, DPS: 0 };
    for (const row of assignments) {
      if (row.participationType !== "BOOSTER") continue;
      const bucket = bucketOf(row.role);
      if (bucket) staffed[bucket] += 1;
    }
    for (const role of input.externalRoles) {
      const bucket = bucketOf(role);
      if (bucket) staffed[bucket] += 1;
    }
    for (const bucket of ["TANK", "HEALER", "DPS"] as const) {
      if (staffed[bucket] === target[bucket]) continue;
      const groupKey = `${bucket}:${staffed[bucket]}`;
      const group = groups.get(groupKey) ?? { bucket, staffed: staffed[bucket], bosses: [] };
      group.bosses.push(boss);
      groups.set(groupKey, group);
    }
  }
  return [...groups.values()].map((group) => {
    const label = target[group.bucket] === 1 ? BUCKET_LABEL[group.bucket].one : BUCKET_LABEL[group.bucket].many;
    return {
      code: "BOSS_COMPOSITION" as const,
      bucket: group.bucket,
      bossKeys: group.bosses.map((boss) => boss.key),
      message: `${formatBossRanges(group.bosses, input.bosses)}: ${group.staffed} of ${target[group.bucket]} ${label}.`,
    };
  });
}

/**
 * Boss-exact lockout warnings for exception assignments: the Character that
 * plays a boss already killed it this reset (only on Runs whose loot type
 * needs fresh lockouts). Default assignments keep the existing whole-raid
 * selection-risk warning.
 */
export function bossLockoutWarnings(input: {
  bosses: readonly RunBoss[];
  effective: ReadonlyMap<string, readonly BossAssignment[]>;
  isSavedOnBoss: (characterId: string, boss: RunBoss) => boolean;
  characterLabelBySignupId: ReadonlyMap<string, string>;
}): Array<{ code: "BOSS_LOCKOUT"; playSignupId: string; bossKeys: string[]; message: string }> {
  const byPlay = new Map<string, RunBoss[]>();
  for (const boss of input.bosses) {
    for (const row of input.effective.get(boss.key) ?? []) {
      if (!row.isException || !row.characterId) continue;
      if (!input.isSavedOnBoss(row.characterId, boss)) continue;
      const list = byPlay.get(row.playSignupId) ?? [];
      list.push(boss);
      byPlay.set(row.playSignupId, list);
    }
  }
  return [...byPlay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([playSignupId, bosses]) => ({
      code: "BOSS_LOCKOUT" as const,
      playSignupId,
      bossKeys: bosses.map((boss) => boss.key),
      message: `${formatBossRanges(bosses, input.bosses)}: ${input.characterLabelBySignupId.get(playSignupId) ?? "Character"} is already saved.`,
    }));
}

/** Compact description of one slot's exceptions, grouped by Character + role: "Boss 7–8: Ranged DPS; Boss 5–6: Synalt · Healer". */
export function describeSlotBossPlan(input: {
  exceptions: readonly RosterBossException[];
  bosses: readonly RunBoss[];
  characterLabelBySignupId: ReadonlyMap<string, string>;
}): string | null {
  if (input.exceptions.length === 0) return null;
  const bossByKey = new Map(input.bosses.map((boss) => [boss.key, boss]));
  const groups = new Map<string, { label: string; bosses: RunBoss[] }>();
  for (const row of input.exceptions) {
    const boss = bossByKey.get(runBossKey(row.runRaidContentId, row.raidBossId));
    if (!boss) continue;
    const role = CHARACTER_ROLE_LABELS[row.role] ?? row.role;
    const label = row.playSignupId
      ? `${input.characterLabelBySignupId.get(row.playSignupId) ?? "Other Character"} · ${role}`
      : role;
    const group = groups.get(label) ?? { label, bosses: [] };
    group.bosses.push(boss);
    groups.set(label, group);
  }
  const ordered = [...groups.values()].sort(
    (a, b) => input.bosses.indexOf(a.bosses[0]!) - input.bosses.indexOf(b.bosses[0]!),
  );
  return ordered.map((group) => `${formatBossRanges(group.bosses, input.bosses)}: ${group.label}`).join("; ");
}

/** Canonical key of an exception set — equal plans compare equal regardless of row order. */
export function bossExceptionFingerprint(exceptions: readonly RosterBossException[]): string {
  return exceptions
    .map((row) => `${exceptionKey(row)}|${row.playSignupId ?? ""}|${row.role}`)
    .sort()
    .join(",");
}

/** Both stored stages of a roster's boss exceptions. */
export type BossExceptionStages = { draft: RosterBossException[]; published: RosterBossException[] };

/**
 * One compact line per slot that deviates, in the given slot order — for the
 * Discord roster, Final Setup and DMs. Consecutive bosses with the same
 * Character + role collapse into ranges (formatBossRanges); Bundles name each
 * content. Slots without exceptions produce no line.
 */
export function bossPlanSummaryLines<Slot extends { signupId: string }>(input: {
  bosses: readonly RunBoss[];
  exceptions: readonly RosterBossException[];
  slots: readonly Slot[];
  characterLabelBySignupId: ReadonlyMap<string, string>;
}): Array<{ slot: Slot; plan: string }> {
  const lines: Array<{ slot: Slot; plan: string }> = [];
  for (const slot of input.slots) {
    const plan = describeSlotBossPlan({
      exceptions: input.exceptions.filter((row) => row.slotSignupId === slot.signupId),
      bosses: input.bosses,
      characterLabelBySignupId: input.characterLabelBySignupId,
    });
    if (plan) lines.push({ slot, plan });
  }
  return lines;
}

/**
 * Which signup's Character plays which planned bosses (by RaidBoss id): a
 * slot's own Character plays every planned boss it is not replaced on by an
 * alternate (a role-only exception keeps its Character); an alternate plays
 * exactly its exception bosses. Without exceptions every slot plays every
 * planned boss. Slot order first, then alternates in first-use order.
 */
export function bossesPlayedBySignup(input: {
  bosses: readonly RunBoss[];
  slotSignupIds: readonly string[];
  exceptions: readonly RosterBossException[];
}): Map<string, Set<string>> {
  const played = new Map<string, Set<string>>();
  for (const slotSignupId of input.slotSignupIds) {
    const replaced = new Set(
      input.exceptions
        .filter((row) => row.slotSignupId === slotSignupId && row.playSignupId != null)
        .map((row) => runBossKey(row.runRaidContentId, row.raidBossId)),
    );
    played.set(slotSignupId, new Set(input.bosses.filter((boss) => !replaced.has(boss.key)).map((boss) => boss.raidBossId)));
  }
  const planned = new Set(input.bosses.map((boss) => boss.key));
  const slots = new Set(input.slotSignupIds);
  for (const row of input.exceptions) {
    if (row.playSignupId == null || !slots.has(row.slotSignupId)) continue;
    if (!planned.has(runBossKey(row.runRaidContentId, row.raidBossId))) continue;
    const set = played.get(row.playSignupId) ?? new Set<string>();
    set.add(row.raidBossId);
    played.set(row.playSignupId, set);
  }
  return played;
}
