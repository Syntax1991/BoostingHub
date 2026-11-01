import { createHash } from "node:crypto";
import { isDomainError } from "@/lib/errors";
import { lockoutBossBreakdown, type RaidBossRef } from "@/lib/lockout-bosses";
import { isSaveRelevantToPlannedBosses } from "@/lib/run-content-lockouts";
import type { RaidDifficulty, RunStatus, WowRegion } from "@/models/enums";
import { characterRepository } from "@/repositories/character.repository";
import { runRepository } from "@/repositories/run.repository";
import { settingsRepository } from "@/repositories/settings.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { userRepository } from "@/repositories/user.repository";
import { lockoutService } from "@/services/lockout.service";
import { resolveDiscordDelivery, rosterCharacterSavedWebNotification } from "@/services/notification-content";

/**
 * "Picked, then saved elsewhere": a Character draft-selected or SELECTED for a
 * Run that has not started yet newly kills one of that Run's planned bosses
 * (same difficulty, same raid ID) — it will not get loot there. Its owner and
 * the Run's Raid Lead are told once per pick and boss set (bell + Discord DM).
 *
 * Only kills the Character sync *newly observes* count, so a Character that
 * was already saved when it was picked (the Raid Lead saw the saved tile) never
 * triggers it. Kills during the Run itself do not count (IN_PROGRESS is excluded).
 */

/** Runs a pick can still be fixed for — before Start Run. */
export const ROSTER_CHARACTER_SAVED_RUN_STATUSES: readonly RunStatus[] = ["OPEN", "ROSTERING", "PUBLISHED"];
const NOTICE_RUN_STATUSES = ROSTER_CHARACTER_SAVED_RUN_STATUSES;

const SOURCE_KEY_PREFIX = "roster-character-saved:";

export type NewLockoutKills = {
  raidId: string;
  difficulty: RaidDifficulty;
  resetIdentifier: string;
  /** Every boss killed this reset after the sync. */
  killedBossIds: readonly string[];
  /** Bosses that were not killed before this sync. */
  newBossIds: readonly string[];
};

export type SavedNoticeCommitment = {
  signupId: string;
  run: {
    id: string;
    title: string;
    status: RunStatus;
    difficulty: RaidDifficulty;
    scheduledStartAt: string;
    raidLeadId: string;
    contents: ReadonlyArray<{ raidId: string; plannedBossCount: number; bosses: readonly RaidBossRef[] }>;
  };
};

export type SavedNotice = {
  signupId: string;
  runId: string;
  runTitle: string;
  raidLeadId: string;
  /** Planned bosses of this Run the Character is saved on (all of them, not only the new ones), in boss order. */
  bosses: RaidBossRef[];
};

/**
 * Who a ROSTER_CHARACTER_SAVED notification is for: the owner or the Raid Lead
 * when a picked Character got saved before the Run, or the owner as a reminder
 * at Start Run ("start").
 */
export type RosterCharacterSavedAudience = "player" | "lead" | "start";

/**
 * A content's planned bosses: the first `plannedBossCount` bosses in
 * authoritative boss order (`sortOrder`). A partial Run clears from the start:
 * 6/8 = bosses 1–6, 8/8 = all of them. No arbitrary boss subsets.
 */
export function plannedBosses(content: SavedNoticeCommitment["run"]["contents"][number]): RaidBossRef[] {
  return [...content.bosses].sort((a, b) => a.sortOrder - b.sortOrder).slice(0, content.plannedBossCount);
}

/** Pure: which picks the newly observed kills make saved on a planned boss. */
export function planSavedNotices(input: {
  region: WowRegion;
  kills: readonly NewLockoutKills[];
  commitments: readonly SavedNoticeCommitment[];
}): SavedNotice[] {
  const notices: SavedNotice[] = [];
  for (const commitment of input.commitments) {
    const { run } = commitment;
    if (!NOTICE_RUN_STATUSES.includes(run.status)) continue;
    const resetIdentifier = lockoutService.getResetIdentifierForRun(input.region, run.scheduledStartAt);
    let hasNewKill = false;
    const bosses: RaidBossRef[] = [];
    for (const content of run.contents) {
      const kills = input.kills.find(
        (row) =>
          row.raidId === content.raidId && row.difficulty === run.difficulty && row.resetIdentifier === resetIdentifier,
      );
      if (!kills) continue;
      const killed = new Set(kills.killedBossIds);
      const fresh = new Set(kills.newBossIds);
      for (const boss of plannedBosses(content)) {
        if (!killed.has(boss.id)) continue;
        bosses.push(boss);
        if (fresh.has(boss.id)) hasNewKill = true;
      }
    }
    if (!hasNewKill) continue;
    notices.push({ signupId: commitment.signupId, runId: run.id, runTitle: run.title, raidLeadId: run.raidLeadId, bosses });
  }
  return notices;
}

/**
 * Planned bosses of `run` this Character cannot get fresh loot on, from its
 * stored lockout rows of the Run's raid ID (same difficulty, the caller's
 * reset), in boss order — decided per content by the shared selection-risk
 * rule (isSaveRelevantToPlannedBosses, the same one the roster warning and
 * Auto Build use): per boss on Normal / Heroic, the whole content on Mythic;
 * a full clear, or progress whose boss list is unknown or inconsistent,
 * counts. A relevant save names its killed planned bosses; when it names
 * none (a Mythic kill on an unplanned boss, an unknown or inconsistent list)
 * every planned boss of that content is listed — loot there is not safe.
 */
export function savedPlannedBosses(
  run: Pick<SavedNoticeCommitment["run"], "difficulty" | "contents">,
  lockouts: ReadonlyArray<{
    raidId: string;
    difficulty: RaidDifficulty;
    bossesDefeated: number;
    isComplete: boolean;
    /** Null = which bosses is unknown (older sync). */
    killedBossIds: readonly string[] | null;
  }>,
): RaidBossRef[] {
  const bosses: RaidBossRef[] = [];
  for (const content of run.contents) {
    const row = lockouts.find((lockout) => lockout.raidId === content.raidId && lockout.difficulty === run.difficulty);
    if (!row) continue;
    const relevant = isSaveRelevantToPlannedBosses({
      raidSave: {
        raidId: row.raidId,
        difficulty: row.difficulty,
        resetIdentifier: "",
        bossesDefeated: row.bossesDefeated,
        totalBossCount: content.bosses.length,
        isComplete: row.isComplete,
        killedBossIds: row.killedBossIds ? [...row.killedBossIds] : null,
      },
      bosses: lockoutBossBreakdown(content.bosses, row.killedBossIds),
      plannedBossCount: content.plannedBossCount,
    });
    if (!relevant) continue;
    const killed = new Set(row.killedBossIds ?? []);
    const planned = plannedBosses(content);
    const named = planned.filter((boss) => killed.has(boss.id));
    bosses.push(...(named.length > 0 ? named : planned));
  }
  return bosses;
}

/** One notification per pick, boss set and audience — a further kill notifies again. */
export function rosterCharacterSavedSourceKey(
  signupId: string,
  bossIds: readonly string[],
  audience: RosterCharacterSavedAudience,
): string {
  return `${SOURCE_KEY_PREFIX}${signupId}:${[...bossIds].sort().join(",")}:${audience}`;
}

const SUMMARY_SOURCE_KEY_PREFIX = "roster-character-saved-summary:";

/**
 * Start Run re-check summary to the Raid Lead: one per Run and affected set
 * (which picks, saved on which bosses). The same set never notifies twice; a
 * different set (another pick, another boss) does. Hashed to keep the key short.
 */
export function rosterCharacterSavedSummarySourceKey(
  runId: string,
  affected: ReadonlyArray<{ signupId: string; bossIds: readonly string[] }>,
): string {
  const canonical = affected
    .map((entry) => `${entry.signupId}=${[...entry.bossIds].sort().join("+")}`)
    .sort()
    .join("|");
  return `${SUMMARY_SOURCE_KEY_PREFIX}${runId}:${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
}

export function isRosterCharacterSavedSummarySourceKey(sourceKey: string): boolean {
  return sourceKey.startsWith(SUMMARY_SOURCE_KEY_PREFIX);
}

export function parseRosterCharacterSavedSourceKey(
  sourceKey: string,
): { signupId: string; bossIds: string[]; audience: RosterCharacterSavedAudience } | null {
  if (!sourceKey.startsWith(SOURCE_KEY_PREFIX)) return null;
  const [signupId, bossList, audience] = sourceKey.slice(SOURCE_KEY_PREFIX.length).split(":");
  if (!signupId || bossList == null || (audience !== "player" && audience !== "lead" && audience !== "start")) return null;
  return { signupId, bossIds: bossList.split(",").filter(Boolean), audience };
}

export async function deliveryFor(userId: string) {
  const [user, settings] = await Promise.all([
    userRepository.findAuthenticatedById(userId),
    settingsRepository.getSettings(userId),
  ]);
  return resolveDiscordDelivery({
    discordDmEnabled: settings.notifications.discordDmEnabled,
    // No per-event toggle: a lost loot slot always needs action before the Run.
    eventDmEnabled: true,
    discordUserId: user?.discordUserId,
    quietHours: settings.notifications.quietHours,
    timeZone: settings.regional.timeZone,
  });
}

export const rosterSavedNoticeService = {
  /**
   * After a lockout sync observed new kills for `characterId`: notifies the
   * owner and the Raid Lead of every pick those kills make saved on a planned
   * boss. Best-effort — never throws into the sync. Returns notifications created.
   */
  async notifyNewKills(characterId: string, kills: readonly NewLockoutKills[]): Promise<number> {
    if (!kills.some((row) => row.newBossIds.length > 0)) return 0;
    try {
      const character = await characterRepository.findById(characterId);
      if (!character) return 0;
      const picks = await signupRepository.listReservingCommitmentsByCharacterId(characterId);
      const commitments: SavedNoticeCommitment[] = [];
      for (const pick of picks) {
        if (!NOTICE_RUN_STATUSES.includes(pick.run.status)) continue;
        const run = await runRepository.findById(pick.run.id);
        if (!run || run.archivedAt) continue;
        commitments.push({ signupId: pick.signupId, run });
      }
      const notices = planSavedNotices({ region: character.region, kills, commitments });
      if (notices.length === 0) return 0;

      const owner = await userRepository.findAuthenticatedById(character.userId);
      const characterLabel = `${character.name}-${character.realm}`;
      let created = 0;
      for (const notice of notices) {
        const bossIds = notice.bosses.map((boss) => boss.id);
        const bossNames = notice.bosses.map((boss) => boss.name);
        const audiences: Array<{ userId: string; audience: "player" | "lead" }> = [
          { userId: character.userId, audience: "player" },
        ];
        // A Raid Lead's own Character needs one notification, not two.
        if (notice.raidLeadId !== character.userId) audiences.push({ userId: notice.raidLeadId, audience: "lead" });
        for (const { userId, audience } of audiences) {
          const copy = rosterCharacterSavedWebNotification({
            audience,
            runId: notice.runId,
            runTitle: notice.runTitle,
            characterLabel,
            playerName: owner?.name ?? "A player",
            bossNames,
          });
          const delivery = await deliveryFor(userId);
          const row = await userNotificationRepository.createIgnoreDuplicate({
            userId,
            type: "ROSTER_CHARACTER_SAVED",
            runId: notice.runId,
            signupId: notice.signupId,
            sourceKey: rosterCharacterSavedSourceKey(notice.signupId, bossIds, audience),
            title: copy.title,
            message: copy.message,
            href: copy.href,
            discordDeliveryStatus: delivery.status,
            discordUserId: delivery.discordUserId,
            discordDeliverAfter: delivery.discordDeliverAfter,
          });
          if (row) created += 1;
        }
      }
      return created;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "roster_character_saved_notification_failed",
          errorCode: isDomainError(error) ? error.code : error instanceof Error ? error.name : "UNKNOWN",
        }),
      );
      return 0;
    }
  },
};
