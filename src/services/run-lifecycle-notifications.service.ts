import { asString, asStringOrNull, mapSignupStatus } from "@/lib/persistence";
import type { orm } from "@/lib/prisma";
import { ACTIVE_SIGNUP_STATUSES, type RaidDifficulty, type RunLootType, type SignupStatus } from "@/models/enums";
import { mapSettings, settingsRepository } from "@/repositories/settings.repository";
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
 * Creates durable RUN_CANCELLED / RUN_REACTIVATED notifications for Users with
 * active signup relationships (PENDING | SELECTED) after the lifecycle write.
 * RUN_RESCHEDULED / RUN_SCOPE_CHANGED are written inside the Run edit
 * transaction instead (create…NotificationsInTx below). One notification
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
};

type TxOrm = typeof orm;

/**
 * Users of the Run whose signup status is in `statuses`, read with the Run
 * mutation's own transaction client — the audience is the signup state at the
 * moment the change commits (later withdrawals / signups cannot alter it).
 * One entry per User; external participants have no signup row.
 */
async function audienceUserIdsInTx(
  txOrm: TxOrm,
  runId: string,
  statuses: (status: SignupStatus) => boolean,
): Promise<string[]> {
  const rows = (await txOrm.RunSignup.where({ runId }).select("userId", "status").all()) as Array<
    Record<string, unknown>
  >;
  return [
    ...new Set(
      rows
        .filter((row) => statuses(mapSignupStatus(row.status)))
        .map((row) => asString(row.userId))
        .filter((userId) => userId.length > 0),
    ),
  ];
}

/** Same preference / timezone mapping as settingsRepository, read through the transaction. */
async function userSettingsInTx(txOrm: TxOrm, userId: string) {
  const row = (await txOrm.User.where({ id: userId }).first()) as Record<string, unknown> | null;
  return {
    settings: mapSettings(row),
    discordUserId: row ? asStringOrNull(row.discordUserId) : null,
  };
}

/**
 * RUN_RESCHEDULED UserNotifications, written inside the Run edit transaction
 * (with the scheduleRevision bump and the RUN_RESCHEDULED announcement).
 * Audience: active signups (`ACTIVE_SIGNUP_STATUSES`: PENDING | SELECTED), one per User.
 * Idempotent per `run-rescheduled:<runId>:<scheduleRevision>:<userId>`.
 */
export async function createRunRescheduledNotificationsInTx(
  txOrm: TxOrm,
  input: {
    runId: string;
    productLabel: string;
    previousScheduledStartAt: string;
    nextScheduledStartAt: string;
    scheduleRevision: number;
  },
): Promise<void> {
  const userIds = await audienceUserIdsInTx(txOrm, input.runId, (status) =>
    (ACTIVE_SIGNUP_STATUSES as readonly string[]).includes(status),
  );
  for (const userId of userIds) {
    const { settings, discordUserId } = await userSettingsInTx(txOrm, userId);
    const timeZone = settings.regional.timeZone;
    const prefs = settings.notifications;
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
      discordUserId,
      quietHours: prefs.quietHours,
      timeZone,
    });
    await userNotificationRepository.createInTx(txOrm, {
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
}

/**
 * RUN_SCOPE_CHANGED UserNotifications, written inside the Run edit transaction
 * (with the RunRaidContent rows, the contentRevision bump and the
 * RUN_SCOPE_CHANGED announcement). Audience: every User still signed up
 * (`isSignedUpSignup`: PENDING | SELECTED | NOT_SELECTED; draft picks are
 * PENDING), never the Discord "Signups by role" pool. DMs follow
 * `dmRunRescheduledEnabled` ("Run Rescheduled / Updated DMs").
 * Idempotent per `run-scope-changed:<runId>:<contentRevision>:<userId>`.
 */
export async function createRunScopeChangedNotificationsInTx(
  txOrm: TxOrm,
  input: {
    runId: string;
    productLabel: string;
    scheduledStartAt: string;
    contentRevision: number;
    changes: readonly RunScopeChange[];
  },
): Promise<void> {
  if (input.changes.length === 0) return;
  const userIds = await audienceUserIdsInTx(txOrm, input.runId, isSignedUpSignup);
  for (const userId of userIds) {
    const { settings, discordUserId } = await userSettingsInTx(txOrm, userId);
    const timeZone = settings.regional.timeZone;
    const prefs = settings.notifications;
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
      discordUserId,
      quietHours: prefs.quietHours,
      timeZone,
    });
    await userNotificationRepository.createInTx(txOrm, {
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
}
