import { isDomainError } from "@/lib/errors";
import { mapWithConcurrency } from "@/lib/concurrency";
import { parseKilledBossIds } from "@/lib/lockout-bosses";
import type { RaidDifficulty } from "@/models/enums";
import { battleNetConnectionRepository } from "@/repositories/battle-net-connection.repository";
import { characterRepository } from "@/repositories/character.repository";
import { lockoutRepository } from "@/repositories/lockout.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { syncLinkedCharacterProfile, verifiedConnectionId } from "@/services/character-blizzard-sync.service";
import { lockoutService } from "@/services/lockout.service";
import {
  rosterCharacterSavedWebNotification,
  rosterSelectedSavedSummaryWebNotification,
} from "@/services/notification-content";
import {
  deliveryFor,
  rosterCharacterSavedSourceKey,
  rosterCharacterSavedSummarySourceKey,
  savedPlannedBosses,
} from "@/services/roster-saved-notice.service";

/** Blizzard calls per Character are sequential; a few Characters at a time keeps Start Run's tail short. */
const START_SYNC_CONCURRENCY = 3;

/**
 * Second line of defence at Start Run ("doppelt hält besser"): fresh Blizzard
 * sync of every SELECTED Booster Character, then a reminder to each owner whose
 * Character is saved on a planned boss of this Run — "you are saved on Boss X,
 * no loot there" — and ONE grouped summary of all of them to the Raid Lead.
 * Runs after the Start Run response (never delays it), once per pick and boss
 * set (summary: once per affected set). A Character whose sync fails is still checked against its
 * last known lockouts. Best-effort — never throws.
 */
export const runStartSavedCheckService = {
  async run(runId: string): Promise<number> {
    try {
      const run = await runRepository.findById(runId);
      if (!run || run.status !== "IN_PROGRESS") return 0;
      const picks = (await rosterRepository.listSignups(runId)).filter(
        (signup) => signup.status === "SELECTED" && signup.participationType === "BOOSTER" && signup.character,
      );
      if (picks.length === 0) return 0;

      await mapWithConcurrency(picks, START_SYNC_CONCURRENCY, async (pick) => {
        try {
          const character = await characterRepository.findById(pick.character!.id);
          if (!character?.isActive) return;
          const connection = await battleNetConnectionRepository.findByUserAndRegion(pick.userId, character.region);
          await syncLinkedCharacterProfile(
            { id: pick.userId, name: pick.userName },
            character,
            verifiedConnectionId(character, connection),
            { trigger: "RUN_START", writeActivity: false },
          );
        } catch {
          // In progress elsewhere, Blizzard down, cooldown-free but failing: the last known lockouts still count.
        }
      });

      let created = 0;
      const affected: Array<{ signupId: string; characterLabel: string; bossIds: string[]; bossNames: string[] }> = [];
      for (const pick of picks) {
        const character = await characterRepository.findById(pick.character!.id);
        if (!character) continue;
        const resetIdentifier = lockoutService.getResetIdentifierForRun(character.region, run.scheduledStartAt);
        const rows = await lockoutRepository.listForCharacterReset(character.id, resetIdentifier);
        const bosses = savedPlannedBosses(
          run,
          rows.map((row) => ({
            raidId: String(row.raidId),
            difficulty: String(row.difficulty) as RaidDifficulty,
            killedBossIds: parseKilledBossIds(row.killedBossIds) ?? [],
          })),
        );
        if (bosses.length === 0) continue;
        const characterLabel = `${character.name}-${character.realm}`;
        affected.push({
          signupId: pick.id,
          characterLabel,
          bossIds: bosses.map((boss) => boss.id),
          bossNames: bosses.map((boss) => boss.name),
        });

        const copy = rosterCharacterSavedWebNotification({
          audience: "start",
          runId: run.id,
          runTitle: run.title,
          characterLabel,
          playerName: pick.userName,
          bossNames: bosses.map((boss) => boss.name),
        });
        const delivery = await deliveryFor(pick.userId);
        const row = await userNotificationRepository.createIgnoreDuplicate({
          userId: pick.userId,
          type: "ROSTER_CHARACTER_SAVED",
          runId: run.id,
          signupId: pick.id,
          sourceKey: rosterCharacterSavedSourceKey(pick.id, bosses.map((boss) => boss.id), "start"),
          title: copy.title,
          message: copy.message,
          href: copy.href,
          discordDeliveryStatus: delivery.status,
          discordUserId: delivery.discordUserId,
          discordDeliverAfter: delivery.discordDeliverAfter,
        });
        if (row) created += 1;
      }

      // The fresh sync can find saves the pre-Start checklist did not show:
      // ONE grouped summary to the Raid Lead (never one per Character).
      if (affected.length > 0) {
        affected.sort((a, b) => a.characterLabel.localeCompare(b.characterLabel));
        const copy = rosterSelectedSavedSummaryWebNotification({ runId: run.id, entries: affected });
        const delivery = await deliveryFor(run.raidLeadId);
        const row = await userNotificationRepository.createIgnoreDuplicate({
          userId: run.raidLeadId,
          type: "ROSTER_CHARACTER_SAVED",
          runId: run.id,
          signupId: null,
          sourceKey: rosterCharacterSavedSummarySourceKey(run.id, affected),
          title: copy.title,
          message: copy.message,
          href: copy.href,
          discordDeliveryStatus: delivery.status,
          discordUserId: delivery.discordUserId,
          discordDeliverAfter: delivery.discordDeliverAfter,
        });
        if (row) created += 1;
      }
      return created;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "run_start_saved_check_failed",
          errorCode: isDomainError(error) ? error.code : error instanceof Error ? error.name : "UNKNOWN",
        }),
      );
      return 0;
    }
  },
};
