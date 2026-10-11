import { ACTIVE_SIGNUP_STATUSES, type RaidDifficulty, type RunLootType } from "@/models/enums";
import { settingsRepository } from "@/repositories/settings.repository";
import { signupRepository } from "@/repositories/signup.repository";
import {
  runCancelledSourceKey,
  runReactivatedSourceKey,
  runRescheduledSourceKey,
  runScopeChangedSourceKey,
  userNotificationRepository,
} from "@/repositories/user-notification.repository";
import {
  resolveDiscordDelivery,
  runCancelledWebNotification,
  runReactivatedWebNotification,
  runRescheduledWebNotification,
  runScopeChangedWebNotification,
} from "@/services/notification-content";
import type { RunScopeChange } from "@/lib/run-scope-change";
import { isSignedUpSignup } from "@/services/signup-state";
import { userRepository } from "@/repositories/user.repository";

/**
 * Creates durable RUN_CANCELLED / RUN_RESCHEDULED / RUN_REACTIVATED notifications
 * for Users with active signup relationships (PENDING | SELECTED). One notification
 * per User. Reactivate DMs reuse the cancel preference (`dmRunCancelledEnabled`)
 * as the correction of the same lifecycle event family.
 */
export const runLifecycleNotificationService = {
  async notifyRunCancelled(input: {
    runId: string;
    cancelRevision: number;
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

    // A prior Reactivate cycle may still have undelivered Discord DMs.
    // Retire those PENDING deliveries with this Cancel so they cannot linger.
    // Keep the in-app UserNotification rows; only Discord delivery is skipped.
    if (input.cancelRevision > 1) {
      const previousRevision = input.cancelRevision - 1;
      const priorReactivateKeys = userIds.map((userId) =>
        runReactivatedSourceKey(input.runId, previousRevision, userId),
      );
      await userNotificationRepository.skipPendingDiscordDeliveryForSourceKeys(priorReactivateKeys);
    }

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
        sourceKey: runCancelledSourceKey(input.runId, input.cancelRevision, userId),
        title: copy.title,
        message: copy.message,
        href: copy.href,
        discordDeliveryStatus: discordDmDelivery.status,
        discordUserId: discordDmDelivery.discordUserId,
        discordDeliverAfter: discordDmDelivery.discordDeliverAfter,
      });
    }
  },

  /**
   * Suppress undelivered cancel DMs for this cancelRevision, then notify the
   * same active-participant audience that the Run is active again.
   */
  async notifyRunReactivated(input: {
    runId: string;
    cancelRevision: number;
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

    const cancelKeys = userIds.map((userId) =>
      runCancelledSourceKey(input.runId, input.cancelRevision, userId),
    );
    await userNotificationRepository.skipPendingDiscordDeliveryForSourceKeys(cancelKeys);

    for (const userId of userIds) {
      const [prefs, user] = await Promise.all([
        settingsRepository.getNotificationDmPreferences(userId),
        userRepository.findById(userId),
      ]);
      const timeZone = await settingsRepository.getTimeZone(userId);
      const copy = runReactivatedWebNotification({
        runId: input.runId,
        runTitle: input.runTitle,
        scheduledStartAt: input.scheduledStartAt,
        timeZone,
      });
      const discordDmDelivery = resolveDiscordDelivery({
        discordDmEnabled: prefs.discordDmEnabled,
        eventDmEnabled: prefs.dmRunCancelledEnabled,
        discordUserId: user?.discordUserId ?? null,
        quietHours: prefs.quietHours,
        timeZone,
      });
      await userNotificationRepository.createIgnoreDuplicate({
        userId,
        type: "RUN_REACTIVATED",
        runId: input.runId,
        signupId: null,
        sourceKey: runReactivatedSourceKey(input.runId, input.cancelRevision, userId),
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

  /**
   * RUN_SCOPE_CHANGED for every User still signed up (`isSignedUpSignup`:
   * PENDING | SELECTED | NOT_SELECTED) — wider than the cancel audience on
   * purpose: an unpicked signup may still be picked for the new scope. Draft
   * picks are PENDING signups and included; never derived from the Discord
   * "Signups by role" pool. One notification per User per contentRevision.
   * DMs follow the reschedule preference (`dmRunRescheduledEnabled`) as the
   * same "the Run you signed up for changed" family.
   */
  async notifyRunScopeChanged(input: {
    runId: string;
    productLabel: string;
    scheduledStartAt: string;
    contentRevision: number;
    changes: readonly RunScopeChange[];
  }): Promise<void> {
    if (input.changes.length === 0) return;
    const signups = await signupRepository.listByRunId(input.runId);
    const userIds = [
      ...new Set(signups.filter((signup) => isSignedUpSignup(signup.status)).map((signup) => signup.userId)),
    ];

    for (const userId of userIds) {
      const [prefs, user, timeZone] = await Promise.all([
        settingsRepository.getNotificationDmPreferences(userId),
        userRepository.findById(userId),
        settingsRepository.getTimeZone(userId),
      ]);
      const copy = runScopeChangedWebNotification({
        runId: input.runId,
        productLabel: input.productLabel,
        scheduledStartAt: input.scheduledStartAt,
        changes: input.changes,
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
        type: "RUN_SCOPE_CHANGED",
        runId: input.runId,
        signupId: null,
        sourceKey: runScopeChangedSourceKey(input.runId, input.contentRevision, userId),
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
