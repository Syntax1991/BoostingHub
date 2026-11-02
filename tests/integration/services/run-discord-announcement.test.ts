import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { anyContentRunInput, venomousUpdateInput } from "@tests/fixtures/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import {
  runCancelledChannelSourceKey,
  runDiscordAnnouncementRepository,
  runRescheduledChannelSourceKey,
} from "@/repositories/run-discord-announcement.repository";
import { runRepository } from "@/repositories/run.repository";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { runService } from "@/services/run.service";
import { testActor } from "@tests/fixtures/actors";
import {
  assertIsolatedTestDatabase,
  createTestCharacter,
  createTestUser,
  deleteCreatedRows,
  syntheticDiscordId,
} from "@tests/fixtures/db-fixtures";
import { offerCharacter } from "@tests/helpers/signup-offers";
import { DAY_MS, HOUR_MS } from "@tests/fixtures/time";

const created = { runIds: [] as string[], characterIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;
let player: AuthenticatedUser;
let charPlayer = "";

let scheduleSlot = 0;
function futureIso(days = 14) {
  const slot = scheduleSlot++;
  return new Date(Date.now() + days * DAY_MS + slot * 3 * HOUR_MS).toISOString();
}

async function openSignedRun(scheduledStartAt: string) {
  const run = await runService.createRun(
    lead,
    anyContentRunInput({ scheduledStartAt, desiredTankCount: 1, desiredHealerCount: 1, desiredDpsCount: 1 }),
  );
  created.runIds.push(run.id);
  await runService.openRun(lead, run.id);
  await offerCharacter(player, run.id, charPlayer, "HEALER");
  return run.id;
}

async function updateSchedule(runId: string, scheduledStartAt: string) {
  const run = await runRepository.findById(runId);
  if (!run) throw new Error("run missing");
  await runService.updateRun(lead, venomousUpdateInput(runId, run, { scheduledStartAt }));
}

/** This Run's channel announcements, oldest first (the order the bot posts them). */
async function announcementsFor(runId: string) {
  const rows = (await orm.RunDiscordAnnouncement.where({ runId }).select("id").all()) as Array<{ id: string }>;
  const records = await Promise.all(rows.map((row) => runDiscordAnnouncementRepository.findById(row.id)));
  return records
    .filter((record) => record !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Sets one of the player's DM preferences for the duration of `body`. */
async function withPlayerPreference(
  preference: { discordDmEnabled: false } | { dmRunRescheduledEnabled: false },
  body: () => Promise<void>,
) {
  await orm.User.where({ id: player.id }).update({ ...preference, updatedAt: new Date().toISOString() });
  try {
    await body();
  } finally {
    await orm.User.where({ id: player.id }).update({
      discordDmEnabled: true,
      dmRunRescheduledEnabled: true,
      updatedAt: new Date().toISOString(),
    });
  }
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  const leadId = await createTestUser({ name: "Announce Lead", accountRole: "RAID_LEAD" });
  const playerId = await createTestUser({ name: "Announce Player", discordUserId: syntheticDiscordId(), isBooster: true });
  created.userIds.push(leadId, playerId);
  lead = testActor(leadId, "RAID_LEAD");
  player = testActor(playerId, "USER");
  charPlayer = await createTestCharacter({
    userId: playerId,
    name: "AnnA",
    realm: "Announce Realm",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    primaryRole: "HEALER",
  });
  created.characterIds.push(charPlayer);
});

afterAll(async () => {
  await deleteCreatedRows(created);
});

describe("RunDiscordAnnouncement enqueue", () => {
  it("schedule change creates one PENDING RUN_RESCHEDULED announcement", async () => {
    const runId = await openSignedRun(futureIso());
    const oldStart = (await runRepository.findById(runId))!.scheduledStartAt;
    const nextStart = futureIso(15);

    await updateSchedule(runId, nextStart);

    const rows = await announcementsFor(runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "RUN_RESCHEDULED",
      status: "PENDING",
      sourceKey: runRescheduledChannelSourceKey(runId, 1),
      previousScheduledStartAt: oldStart,
    });
    expect(Date.parse(rows[0]!.scheduledStartAt)).toBe(Date.parse(nextStart));
  });

  it("unrelated Run edit does not create an announcement", async () => {
    const runId = await openSignedRun(futureIso());

    const run = await runRepository.findById(runId);
    await runService.updateRun(lead, venomousUpdateInput(runId, run!, { notes: "notes only", desiredHealerCount: 2 }));

    expect(await announcementsFor(runId)).toEqual([]);
  });

  it("retry same revision does not duplicate channel announcement", async () => {
    const runId = await openSignedRun(futureIso());
    const nextStart = futureIso(16);
    await updateSchedule(runId, nextStart);
    expect((await announcementsFor(runId)).map((row) => row.sourceKey)).toEqual([runRescheduledChannelSourceKey(runId, 1)]);

    const dup = await runDiscordAnnouncementRepository.createIgnoreDuplicate({
      runId,
      type: "RUN_RESCHEDULED",
      sourceKey: runRescheduledChannelSourceKey(runId, 1),
      previousScheduledStartAt: nextStart,
      scheduledStartAt: nextStart,
      productLabel: "x",
      difficulty: "HEROIC",
      lootType: "VIP",
    });
    expect(dup).toBeNull();
    expect(await announcementsFor(runId)).toHaveLength(1);
  });

  it("second real schedule change creates a second distinct announcement", async () => {
    const runId = await openSignedRun(futureIso());
    await updateSchedule(runId, futureIso(17));
    await updateSchedule(runId, futureIso(18));
    expect((await announcementsFor(runId)).map((row) => row.sourceKey)).toEqual([
      runRescheduledChannelSourceKey(runId, 1),
      runRescheduledChannelSourceKey(runId, 2),
    ]);
  });

  it("cancel creates one PENDING RUN_CANCELLED announcement; retry does not duplicate", async () => {
    const runId = await openSignedRun(futureIso());
    await runService.cancelRun(lead, runId);
    const rows = await announcementsFor(runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "RUN_CANCELLED", status: "PENDING", sourceKey: runCancelledChannelSourceKey(runId, 1) });

    const again = await runDiscordAnnouncementRepository.createIgnoreDuplicate({
      runId,
      type: "RUN_CANCELLED",
      sourceKey: runCancelledChannelSourceKey(runId, 1),
      previousScheduledStartAt: null,
      scheduledStartAt: rows[0]!.scheduledStartAt,
      productLabel: "x",
      difficulty: "HEROIC",
      lootType: "VIP",
    });
    expect(again).toBeNull();
    expect(await announcementsFor(runId)).toHaveLength(1);
  });
});

describe("RunDiscordAnnouncement sync work + retirement barrier", () => {
  it("existing channel surfaces announcement with runChannelId; retire blocked while PENDING", async () => {
    const runId = await openSignedRun(futureIso());
    await discordSyncService.recordRunChannel({ runId, channelId: "announce-chan-1" });
    await runService.cancelRun(lead, runId);

    const work = await discordSyncService.listSyncWork();
    const announcement = work.runAnnouncements.find((row) => row.runId === runId);
    expect(announcement).toMatchObject({ type: "RUN_CANCELLED", runChannelId: "announce-chan-1" });

    const channel = work.channels.find((row) => row.runId === runId);
    expect(channel).toMatchObject({ pendingLifecycleAnnouncements: true, retireChannel: false });
  });

  it("no Run channel → announcement still PENDING in work with null runChannelId; no channel created", async () => {
    const runId = await openSignedRun(futureIso());
    await runService.cancelRun(lead, runId);
    const work = await discordSyncService.listSyncWork();
    const announcement = work.runAnnouncements.find((row) => row.runId === runId);
    expect(announcement).toMatchObject({ type: "RUN_CANCELLED", runChannelId: null });
    expect(work.channels.some((row) => row.runId === runId)).toBe(false);
  });

  it("after SENT, CANCELLED alone does not retire; app archive does", async () => {
    const runId = await openSignedRun(futureIso());
    await discordSyncService.recordRunChannel({ runId, channelId: "announce-chan-2" });
    await runService.cancelRun(lead, runId);
    const [pending] = await announcementsFor(runId);
    await discordSyncService.recordRunAnnouncementDelivery({ announcementId: pending!.id, result: "SENT" });

    let work = await discordSyncService.listSyncWork();
    expect(work.runAnnouncements.some((row) => row.runId === runId)).toBe(false);
    let channel = work.channels.find((row) => row.runId === runId);
    expect(channel).toMatchObject({ pendingLifecycleAnnouncements: false, retireChannel: false });
    expect(channel?.desiredChannelName.startsWith("closed-")).toBe(true);

    await runService.archiveRun(lead, runId);
    work = await discordSyncService.listSyncWork();
    channel = work.channels.find((row) => row.runId === runId);
    expect(channel?.retireChannel).toBe(true);
  });

  it("ordering: reschedule then cancel appear createdAt ASC in runAnnouncements", async () => {
    const runId = await openSignedRun(futureIso());
    await discordSyncService.recordRunChannel({ runId, channelId: "announce-chan-3" });
    await updateSchedule(runId, futureIso(20));
    await updateSchedule(runId, futureIso(21));
    await runService.cancelRun(lead, runId);

    const stored = await announcementsFor(runId);
    expect(stored.map((row) => row.sourceKey)).toEqual([
      runRescheduledChannelSourceKey(runId, 1),
      runRescheduledChannelSourceKey(runId, 2),
      runCancelledChannelSourceKey(runId, 1),
    ]);
    const work = await discordSyncService.listSyncWork();
    expect(work.runAnnouncements.filter((row) => row.runId === runId).map((row) => row.announcementId)).toEqual(
      stored.map((row) => row.id),
    );
  });
});

describe("User delivery regression vs channel announcements", () => {
  it("master DM OFF: web notification still created; DM SKIPPED; channel announcement still PENDING", async () => {
    await withPlayerPreference({ discordDmEnabled: false }, async () => {
      const runId = await openSignedRun(futureIso());
      await runService.cancelRun(lead, runId);

      const notes = await userNotificationRepository.listForUser(player.id, 20);
      const cancelNote = notes.find((row) => row.runId === runId && row.type === "RUN_CANCELLED");
      expect(cancelNote?.discordDeliveryStatus).toBe("SKIPPED");
      expect((await announcementsFor(runId)).map((row) => [row.type, row.status])).toEqual([["RUN_CANCELLED", "PENDING"]]);
    });
  });

  it("channel announcement ignores User DM preferences", async () => {
    await withPlayerPreference({ dmRunRescheduledEnabled: false }, async () => {
      const runId = await openSignedRun(futureIso());
      await updateSchedule(runId, futureIso(22));

      const notes = await userNotificationRepository.listForUser(player.id, 20);
      const rescheduleNote = notes.find((row) => row.runId === runId && row.type === "RUN_RESCHEDULED");
      expect(rescheduleNote?.discordDeliveryStatus).toBe("SKIPPED");
      expect((await announcementsFor(runId)).map((row) => [row.type, row.status])).toEqual([["RUN_RESCHEDULED", "PENDING"]]);
    });
  });
});
