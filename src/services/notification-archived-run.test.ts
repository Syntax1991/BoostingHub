import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import type { DiscordDeliveryStatus, NotificationType } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { runService } from "@/services/run.service";

const ids = {
  lead: "n4444444-4444-4444-8444-444444444401",
  player: "n4444444-4444-4444-8444-444444444402",
};
const DISCORD_ID = "930000000000000001";
const createdRunIds: string[] = [];

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@narchived.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createTestUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"], discordUserId: string | null) {
  await orm.User.create({
    id,
    name,
    email: `${id}@narchived.boostting.local`,
    emailVerified: true,
    discordUserId,
    discordUsername: discordUserId ? `u${discordUserId}` : null,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function cleanup() {
  for (const userId of Object.values(ids)) {
    const notes = await orm.UserNotification.where({ userId }).select("id").all();
    for (const row of notes) {
      await orm.UserNotification.where({ id: (row as { id: string }).id }).delete();
    }
  }
  for (const runId of createdRunIds.splice(0)) {
    await orm.Run.where({ id: runId }).delete().catch(() => undefined);
  }
  for (const userId of Object.values(ids)) {
    await orm.User.where({ id: userId }).delete().catch(() => undefined);
  }
}

const lead = asUser(ids.lead, "Archive Lead", "RAID_LEAD");

async function createRun(): Promise<string> {
  const created = await runService.createRun(
    lead,
    venomousCreateInput({
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000 + createdRunIds.length * 3_600_000).toISOString(),
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 1,
    }),
  );
  createdRunIds.push(created.id);
  return created.id;
}

async function notify(runId: string, type: NotificationType, status: DiscordDeliveryStatus, key: string) {
  await userNotificationRepository.createIgnoreDuplicate({
    userId: ids.player,
    type,
    runId,
    signupId: null,
    sourceKey: `archived-test:${key}`,
    title: type,
    message: type,
    href: `/runs/${runId}`,
    discordDeliveryStatus: status,
    discordUserId: status === "SKIPPED" ? null : DISCORD_ID,
    discordDeliverAfter: null,
  });
  const row = (await orm.UserNotification.where({ sourceKey: `archived-test:${key}` }).first()) as { id: string };
  return row.id;
}

async function statusOf(id: string) {
  return (await userNotificationRepository.findById(id))?.discordDeliveryStatus;
}

let archivedRunId = "";
let activeRunId = "";

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanup();
  await createTestUser(ids.lead, "Archive Lead", "RAID_LEAD", null);
  await createTestUser(ids.player, "Archive Player", "USER", DISCORD_ID);
  await orm.User.where({ id: ids.lead }).update({ isBooster: true });

  archivedRunId = await createRun();
  await runService.openRun(lead, archivedRunId);
  await runService.cancelRun(lead, archivedRunId);
  // Fixture: an app-archived cancelled Run (archival itself is covered elsewhere).
  await orm.Run.where({ id: archivedRunId }).update({ archivedAt: new Date().toISOString() });

  activeRunId = await createRun();
  await runService.openRun(lead, activeRunId);
});

afterAll(async () => {
  await cleanup();
});

describe("Discord DM lane — archived Run notifications", () => {
  it("terminalizes PENDING RUN_CANCELLED / RUN_RESCHEDULED / RUN_SCOPE_CHANGED on an archived Run as SKIPPED without handing them to the bot", async () => {
    const cancelled = await notify(archivedRunId, "RUN_CANCELLED", "PENDING", "a-cancel");
    const rescheduled = await notify(archivedRunId, "RUN_RESCHEDULED", "PENDING", "a-resched");
    const scope = await notify(archivedRunId, "RUN_SCOPE_CHANGED", "PENDING", "a-scope");
    const alreadySent = await notify(archivedRunId, "RUN_CANCELLED", "SENT", "a-sent");
    const alreadySkipped = await notify(archivedRunId, "RUN_CANCELLED", "SKIPPED", "a-skipped");
    const failed = await notify(archivedRunId, "RUN_CANCELLED", "FAILED_PERMANENT", "a-failed");
    const active = await notify(activeRunId, "RUN_RESCHEDULED", "PENDING", "b-active");

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
    const pending = await notify(archivedRunId, "RUN_CANCELLED", "PENDING", "c-pending");
    const sent = await notify(archivedRunId, "RUN_CANCELLED", "SENT", "c-sent");

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
    const pending = await notify(activeRunId, "RUN_SCOPE_CHANGED", "PENDING", "d-late-archive");
    expect(await discordSyncService.getNotificationDmDeliveryAuthority(pending)).toEqual({ deliver: true });

    await orm.Run.where({ id: activeRunId }).update({ archivedAt: new Date().toISOString() });
    try {
      expect(await discordSyncService.getNotificationDmDeliveryAuthority(pending)).toEqual({ deliver: false });
    } finally {
      await orm.Run.where({ id: activeRunId }).update({ archivedAt: null });
    }
  });
});
