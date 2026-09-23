import { ACTIVE_SIGNUP_STATUSES, type RaidDifficulty, type RunLootType } from "@/models/enums";
import { settingsRepository } from "@/repositories/settings.repository";
import { signupRepository } from "@/repositories/signup.repository";
import {
  runCancelledSourceKey,
  runRescheduledSourceKey,
  userNotificationRepository,
} from "@/repositories/user-notification.repository";
import {
  resolveDiscordDelivery,
  runCancelledWebNotification,
  runRescheduledWebNotification,
} from "@/services/notification-content";
import { userRepository } from "@/repositories/user.repository";

/**
 * Creates durable RUN_CANCELLED / RUN_RESCHEDULED notifications for Users with
 * active signup relationships (PENDING | SELECTED). One notification per User.
 */
export const runLifecycleNotificationService = {
  async notifyRunCancelled(input: {
    runId: string;
    runTitle: string;
    scheduledStartAt: string;
    difficulty: RaidDifficulty;
    lootType: RunLootType;
  }): Promise<void> {
    const signups = await signupRepository.listByRunId(input.runId);
    const active = signups.filter((signup) =>
      (ACTIVE_SIGNUP_STATUSES as readonly string[]).includes(signup.status),
    );
    const userIds = [...new Set(active.map((signup) => signup.userId))];

    for (const userId of userIds) {
      const [prefs, user] = await Promise.all([
        settingsRepository.getNotificationDmPreferences(userId),
        userRepository.findById(userId),
      ]);
      const timeZone = await settingsRepository.getTimeZone(userId);
      const copy = runCancelledWebNotification({
        runId: input.runId,
        runTitle: input.runTitle,
        scheduledStartAt: input.scheduledStartAt,
        timeZone,
      });
      // Discord DM intent (incl. Quiet Hours deferral) is snapshotted here — later Settings edits do not rewrite this row.
      const discordDmDelivery = resolveDiscordDelivery({
        discordDmEnabled: prefs.discordDmEnabled,
        eventDmEnabled: prefs.dmRunCancelledEnabled,
        discordUserId: user?.discordUserId ?? null,
        quietHours: prefs.quietHours,
        timeZone,
      });
      await userNotificationRepository.createIgnoreDuplicate({
        userId,
        type: "RUN_CANCELLED",
        runId: input.runId,
        signupId: null,
        sourceKey: runCancelledSourceKey(input.runId, userId),
        title: copy.title,
        message: copy.message,
        href: copy.href,
        discordDeliveryStatus: discordDmDelivery.status,
        discordUserId: discordDmDelivery.discordUserId,
        discordDeliverAfter: discordDmDelivery.discordDeliverAfter,
      });
    }
  },

  async notifyRunRescheduled(input: {
    runId: string;
    productLabel: string;
    previousScheduledStartAt: string;
    nextScheduledStartAt: string;
    scheduleRevision: number;
    difficulty: RaidDifficulty;
    lootType: RunLootType;
  }): Promise<void> {
    const signups = await signupRepository.listByRunId(input.runId);
    const active = signups.filter((signup) =>
      (ACTIVE_SIGNUP_STATUSES as readonly string[]).includes(signup.status),
    );
    const userIds = [...new Set(active.map((signup) => signup.userId))];

    for (const userId of userIds) {
      const [prefs, user, timeZone] = await Promise.all([
        settingsRepository.getNotificationDmPreferences(userId),
        userRepository.findById(userId),
        settingsRepository.getTimeZone(userId),
      ]);
      const copy = runRescheduledWebNotification({
        runId: input.runId,
        productLabel: input.productLabel,
        previousScheduledStartAt: input.previousScheduledStartAt,
        nextScheduledStartAt: input.nextScheduledStartAt,
        timeZone,
      });
      const discordDmDelivery = resolveDiscordDelivery({
        discordDmEnabled: prefs.discordDmEnabled,
        eventDmEnabled: prefs.dmRunRescheduledEnabled,
        discordUserId: user?.discordUserId ?? null,
        quietHours: prefs.quietHours,
        timeZone,
      });
      await userNotificationRepository.createIgnoreDuplicate({
        userId,
        type: "RUN_RESCHEDULED",
        runId: input.runId,
        signupId: null,
        sourceKey: runRescheduledSourceKey(input.runId, input.scheduleRevision, userId),
        title: copy.title,
        message: copy.message,
        href: copy.href,
        discordDeliveryStatus: discordDmDelivery.status,
        discordUserId: discordDmDelivery.discordUserId,
        discordDeliverAfter: discordDmDelivery.discordDeliverAfter,
      });
    }
  },
};
