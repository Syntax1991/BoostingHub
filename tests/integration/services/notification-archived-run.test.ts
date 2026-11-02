import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { anyContentRunInput } from "@tests/fixtures/test-run-input";
import type { DiscordDeliveryStatus, NotificationType } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { runService } from "@/services/run.service";
import { testActor } from "@tests/fixtures/actors";
import {
  assertIsolatedTestDatabase,
  createTestUser,
  deleteCreatedRows,
  syntheticDiscordId,
} from "@tests/fixtures/db-fixtures";
import { CURRENT_WEEK_RUN_START, HOUR_MS, RAID_WEEK_TEST_CLOCK, freezeSystemTime, restoreSystemTime } from "@tests/fixtures/time";

const PLAYER_DISCORD_ID = syntheticDiscordId();
/** Notifications cascade with their User and Run. */
const created = { runIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;
let playerId = "";

/** An OPEN Run of the suite's Raid Lead, an hour after the previous one (no reservation overlap). */
async function createOpenRun(): Promise<string> {
  const scheduledStartAt = new Date(Date.parse(CURRENT_WEEK_RUN_START) + created.runIds.length * HOUR_MS).toISOString();
  const run = await runService.createRun(lead, anyContentRunInput({ scheduledStartAt }));
  created.runIds.push(run.id);
  await runService.openRun(lead, run.id);
  return run.id;
}

/** A cancelled Run the app has archived (archival itself is covered elsewhere). */
async function createArchivedCancelledRun(): Promise<string> {
  const runId = await createOpenRun();
  await runService.cancelRun(lead, runId);
  await orm.Run.where({ id: runId }).update({ archivedAt: new Date().toISOString() });
  return runId;
}

/** A Discord-DM notification for the player about `runId`; returns its id. */
async function notify(runId: string, type: NotificationType, status: DiscordDeliveryStatus) {
  const id = crypto.randomUUID();
  await userNotificationRepository.createIgnoreDuplicate({
    id,
    userId: playerId,
    type,
    runId,
    signupId: null,
    sourceKey: `archived-test:${id}`,
    title: type,
    message: type,
    href: `/runs/${runId}`,
    discordDeliveryStatus: status,
    discordUserId: status === "SKIPPED" ? null : PLAYER_DISCORD_ID,
    discordDeliverAfter: null,
  });
  return id;
}

async function statusOf(id: string) {
  return (await userNotificationRepository.findById(id))?.discordDeliveryStatus;
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  freezeSystemTime(RAID_WEEK_TEST_CLOCK, { advance: true });
  await raidRepository.ensureReferenceRaids();
  const leadId = await createTestUser({ name: "Archive Lead", accountRole: "RAID_LEAD", isBooster: true });
  playerId = await createTestUser({ name: "Archive Player", discordUserId: PLAYER_DISCORD_ID });
  created.userIds.push(leadId, playerId);
  lead = testActor(leadId, "RAID_LEAD");
});

afterAll(async () => {
  try {
    await deleteCreatedRows(created);
  } finally {
    restoreSystemTime();
  }
});

describe("Discord DM lane — archived Run notifications", () => {
  it("terminalizes PENDING RUN_CANCELLED / RUN_RESCHEDULED / RUN_SCOPE_CHANGED on an archived Run as SKIPPED without handing them to the bot", async () => {
    const archivedRunId = await createArchivedCancelledRun();
    const activeRunId = await createOpenRun();
    const cancelled = await notify(archivedRunId, "RUN_CANCELLED", "PENDING");
    const rescheduled = await notify(archivedRunId, "RUN_RESCHEDULED", "PENDING");
    const scope = await notify(archivedRunId, "RUN_SCOPE_CHANGED", "PENDING");
    const alreadySent = await notify(archivedRunId, "RUN_CANCELLED", "SENT");
    const alreadySkipped = await notify(archivedRunId, "RUN_CANCELLED", "SKIPPED");
    const failed = await notify(archivedRunId, "RUN_CANCELLED", "FAILED_PERMANENT");
    const active = await notify(activeRunId, "RUN_RESCHEDULED", "PENDING");

    const work = await discordSyncService.listSyncWork();
    const dmIds = new Set(work.notificationDms.map((item) => item.notificationId));

    // Never handed to the bot → no Discord request is possible for them.
    for (const id of [cancelled, rescheduled, scope]) {
      expect(dmIds.has(id)).toBe(false);
      expect(await statusOf(id)).toBe("SKIPPED");
    }
    // Terminal rows untouched.
    expect(await statusOf(alreadySent)).toBe("SENT");
    expect(await statusOf(alreadySkipped)).toBe("SKIPPED");
    expect(await statusOf(failed)).toBe("FAILED_PERMANENT");
    // Active Run delivery path unchanged.
    expect(dmIds.has(active)).toBe(true);
    expect(await statusOf(active)).toBe("PENDING");

    // A second pass is a no-op (no revert, still not handed out).
    const again = await discordSyncService.listSyncWork();
    expect(again.notificationDms.some((item) => item.notificationId === cancelled)).toBe(false);
    expect(await statusOf(cancelled)).toBe("SKIPPED");
  });

  it("skip is compare-and-set: concurrent / repeated calls stay SKIPPED and never touch SENT", async () => {
    const archivedRunId = await createArchivedCancelledRun();
    const pending = await notify(archivedRunId, "RUN_CANCELLED", "PENDING");
    const sent = await notify(archivedRunId, "RUN_CANCELLED", "SENT");

    const results = await Promise.all([
      userNotificationRepository.skipPendingDiscordDelivery(pending),
      userNotificationRepository.skipPendingDiscordDelivery(pending),
    ]);
    expect(results).toEqual([true, true]);
    expect(await statusOf(pending)).toBe("SKIPPED");

    expect(await userNotificationRepository.skipPendingDiscordDelivery(sent)).toBe(false);
    expect(await statusOf(sent)).toBe("SENT");

    // A late SENT/FAILED report for a SKIPPED row cannot revert it.
    expect(await userNotificationRepository.updateDiscordDelivery(pending, "SENT")).toBe(false);
    expect(await statusOf(pending)).toBe("SKIPPED");
  });

  it("refuses delivery authority once the Run is archived, even while the row is still PENDING", async () => {
    const runId = await createOpenRun();
    const pending = await notify(runId, "RUN_SCOPE_CHANGED", "PENDING");
    expect(await discordSyncService.getNotificationDmDeliveryAuthority(pending)).toEqual({ deliver: true });

    await orm.Run.where({ id: runId }).update({ archivedAt: new Date().toISOString() });
    expect(await discordSyncService.getNotificationDmDeliveryAuthority(pending)).toEqual({ deliver: false });
  });
});
