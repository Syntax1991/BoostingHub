import { asString, asStringOrNull, mapSignupStatus } from "@/lib/persistence";
import type { orm } from "@/lib/prisma";
import { ACTIVE_SIGNUP_STATUSES, type SignupStatus } from "@/models/enums";
import { mapSettings } from "@/repositories/settings.repository";
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

/**
 * RUN_CANCELLED UserNotifications, written inside the cancel transaction (with
 * CANCELLED, the cancelRevision bump and the RUN_CANCELLED announcement).
 * Audience: active signups (`ACTIVE_SIGNUP_STATUSES`: PENDING | SELECTED), one
 * per User, read through the transaction. A previous Reactivate cycle's still
 * undelivered DMs for those Users are retired (Discord delivery SKIPPED; the
 * in-app rows stay). Idempotent per `run-cancelled:<runId>:<cancelRevision>:<userId>`.
 */
export async function createRunCancelledNotificationsInTx(
  txOrm: TxOrm,
  input: { runId: string; cancelRevision: number; runTitle: string; scheduledStartAt: string },
): Promise<void> {
  const userIds = await audienceUserIdsInTx(txOrm, input.runId, (status) =>
    (ACTIVE_SIGNUP_STATUSES as readonly string[]).includes(status),
  );

  if (input.cancelRevision > 1) {
    const previousRevision = input.cancelRevision - 1;
    await userNotificationRepository.skipPendingDiscordDeliveryForSourceKeysInTx(
      txOrm,
      userIds.map((userId) => runReactivatedSourceKey(input.runId, previousRevision, userId)),
    );
  }

  for (const userId of userIds) {
    const { settings, discordUserId } = await userSettingsInTx(txOrm, userId);
    const timeZone = settings.regional.timeZone;
    const prefs = settings.notifications;
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
      discordUserId,
      quietHours: prefs.quietHours,
      timeZone,
    });
    await userNotificationRepository.createInTx(txOrm, {
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
}

/**
 * RUN_REACTIVATED UserNotifications, written inside the reactivate transaction
 * (with the restored status and the RUN_REACTIVATED announcement). Same
 * audience as RUN_CANCELLED; undelivered cancel DMs of this cancelRevision are
 * retired first. DMs reuse the cancel preference (`dmRunCancelledEnabled`) as
 * the correction of the same lifecycle event family.
 * Idempotent per `run-reactivated:<runId>:<cancelRevision>:<userId>`.
 */
export async function createRunReactivatedNotificationsInTx(
  txOrm: TxOrm,
  input: { runId: string; cancelRevision: number; runTitle: string; scheduledStartAt: string },
): Promise<void> {
  const userIds = await audienceUserIdsInTx(txOrm, input.runId, (status) =>
    (ACTIVE_SIGNUP_STATUSES as readonly string[]).includes(status),
  );

  await userNotificationRepository.skipPendingDiscordDeliveryForSourceKeysInTx(
    txOrm,
    userIds.map((userId) => runCancelledSourceKey(input.runId, input.cancelRevision, userId)),
  );

  for (const userId of userIds) {
    const { settings, discordUserId } = await userSettingsInTx(txOrm, userId);
    const timeZone = settings.regional.timeZone;
    const prefs = settings.notifications;
    const copy = runReactivatedWebNotification({
      runId: input.runId,
      runTitle: input.runTitle,
      scheduledStartAt: input.scheduledStartAt,
      timeZone,
    });
    const discordDmDelivery = resolveDiscordDelivery({
      discordDmEnabled: prefs.discordDmEnabled,
      eventDmEnabled: prefs.dmRunCancelledEnabled,
      discordUserId,
      quietHours: prefs.quietHours,
      timeZone,
    });
    await userNotificationRepository.createInTx(txOrm, {
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
}
