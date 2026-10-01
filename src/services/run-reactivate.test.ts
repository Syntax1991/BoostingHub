import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { futureTestIso, venomousCreateInput } from "@/lib/test-run-input";
import { isSignupWindowOpen } from "@/services/run-state";
import { raidRepository } from "@/repositories/raid.repository";
import {
  runCancelledChannelSourceKey,
  runDiscordAnnouncementRepository,
  runReactivatedChannelSourceKey,
} from "@/repositories/run-discord-announcement.repository";
import {
  runCancelledSourceKey,
  runReactivatedSourceKey,
  userNotificationRepository,
} from "@/repositories/user-notification.repository";
import { runRepository } from "@/repositories/run.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { runService } from "@/services/run.service";
import { activityRepository } from "@/repositories/activity.repository";

const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-rx0000000001",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-rx0000000002",
  player: "aaaaaaaa-aaaa-4aaa-8aaa-rx0000000003",
};

const createdRunIds: string[] = [];
const createdSignupIds: string[] = [];

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@rx.boostting.local`,
    image: null,
    discordUserId: id === ids.player ? "discord-rx-player" : null,
    discordUsername: id === ids.player ? "rxplayer" : null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function expectDomainCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected domain error ${code}`);
  } catch (error) {
    if (error instanceof Error && error.message === `Expected domain error ${code}`) throw error;
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

async function createTestUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@rx.boostting.local`,
    emailVerified: true,
    discordUserId: id === ids.player ? "discord-rx-player" : null,
    discordUsername: id === ids.player ? "rxplayer" : null,
    accountRole,
    accountStatus: "ACTIVE",
    discordDmEnabled: true,
    dmRosterSelectedEnabled: true,
    dmRaidInviteEnabled: true,
    dmRunCancelledEnabled: true,
    dmRunRescheduledEnabled: true,
    dmRosterRemovedEnabled: true,
    timeZone: "Europe/Berlin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function cleanupRun(runId: string) {
  const notes = await orm.UserNotification.where({ runId }).select("id").all();
  for (const row of notes) {
    await orm.UserNotification.where({ id: (row as { id: string }).id }).delete();
  }
  const announcements = await orm.RunDiscordAnnouncement.where({ runId }).select("id").all();
  for (const row of announcements) {
    await orm.RunDiscordAnnouncement.where({ id: (row as { id: string }).id }).delete();
  }
  try {
    await orm.RunDiscordPost.where({ runId }).delete();
  } catch {
    // none
  }
  const activities = await orm.ActivityEvent.where({ type: "RUN_REACTIVATED" }).select("id").all();
  for (const row of activities) {
    // leave other activity; only clean by message match later if needed
    void row;
  }
  try {
    await orm.Run.where({ id: runId }).delete();
  } catch {
    // gone
  }
}

const lead = asUser(ids.lead, "Rx Lead", "RAID_LEAD");
const admin = asUser(ids.admin, "Rx Admin", "ADMIN");

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const id of Object.values(ids)) {
    try {
      await orm.User.where({ id }).delete();
    } catch {
      // gone
    }
  }
  await createTestUser(ids.lead, "Rx Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "Rx Admin", "ADMIN");
  await createTestUser(ids.player, "Rx Player", "USER");
});

afterAll(async () => {
  for (const signupId of createdSignupIds.splice(0)) {
    try {
      await orm.RunSignup.where({ id: signupId }).delete();
    } catch {
      // gone
    }
  }
  for (const runId of createdRunIds.splice(0)) {
    await cleanupRun(runId);
  }
  for (const id of Object.values(ids)) {
    try {
      await orm.User.where({ id }).delete();
    } catch {
      // gone
    }
  }
});

async function createDraft(extra: Record<string, unknown> = {}) {
  const created = await runService.createRun(
    lead,
    venomousCreateInput({
      scheduledStartAt: futureTestIso(10 + createdRunIds.length),
      ...extra,
    }),
  );
  createdRunIds.push(created.id);
  return created.id;
}

async function addPendingSignup(runId: string) {
  const signupId = crypto.randomUUID();
  createdSignupIds.push(signupId);
  await orm.RunSignup.create({
    id: signupId,
    runId,
    userId: ids.player,
    participationType: "LOOTBUDDY",
    lootbuddyClass: "MAGE",
    lootbuddyMode: "LOOT_ONLY",
    lootbuddyVerification: "NONE",
    isBackup: false,
    status: "PENDING",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return signupId;
}

describe("reactivate cancelled run", () => {
  it("A/B: DRAFT cancel snapshots DRAFT/false and Reactivate restores DRAFT/false", async () => {
    const runId = await createDraft({ title: "Rx draft" });
    await runService.cancelRun(lead, runId);
    const cancelled = await runRepository.findById(runId);
    expect(cancelled?.status).toBe("CANCELLED");
    expect(cancelled?.cancelledFromStatus).toBe("DRAFT");
    expect(cancelled?.cancelledFromSignupsOpen).toBe(false);
    expect(cancelled?.cancelRevision).toBe(1);
    expect(cancelled?.signupsOpen).toBe(false);

    await runService.reactivateRun(lead, runId);
    const restored = await runRepository.findById(runId);
    expect(restored?.status).toBe("DRAFT");
    expect(restored?.signupsOpen).toBe(false);
    expect(restored?.cancelledFromStatus).toBeNull();
    expect(restored?.cancelledFromSignupsOpen).toBeNull();
    expect(restored?.cancelRevision).toBe(1);
  });

  it("C/D: OPEN open/closed restore exact signupsOpen", async () => {
    const openId = await createDraft({ title: "Rx open open" });
    await runService.openRun(lead, openId);
    await runService.cancelRun(lead, openId);
    await runService.reactivateRun(lead, openId);
    const openRestored = await runRepository.findById(openId);
    expect(openRestored?.status).toBe("OPEN");
    expect(openRestored?.signupsOpen).toBe(true);

    const closedId = await createDraft({ title: "Rx open closed" });
    await runService.openRun(lead, closedId);
    await runService.setSignupWindow(lead, closedId, false);
    await runService.cancelRun(lead, closedId);
    await runService.reactivateRun(lead, closedId);
    const closedRestored = await runRepository.findById(closedId);
    expect(closedRestored?.status).toBe("OPEN");
    expect(closedRestored?.signupsOpen).toBe(false);
  });

  it("E/F/G/H: ROSTERING and PUBLISHED restore snapshot including PR #163 signup window", async () => {
    const rosteringOpen = await createDraft({ title: "Rx rostering open" });
    await runRepository.updateFields(rosteringOpen, { status: "ROSTERING", signupsOpen: true });
    await runService.cancelRun(lead, rosteringOpen);
    await runService.reactivateRun(lead, rosteringOpen);
    expect(await runRepository.findById(rosteringOpen)).toMatchObject({
      status: "ROSTERING",
      signupsOpen: true,
    });

    const rosteringClosed = await createDraft({ title: "Rx rostering closed" });
    await runRepository.updateFields(rosteringClosed, { status: "ROSTERING", signupsOpen: false });
    await runService.cancelRun(lead, rosteringClosed);
    await runService.reactivateRun(lead, rosteringClosed);
    expect(await runRepository.findById(rosteringClosed)).toMatchObject({
      status: "ROSTERING",
      signupsOpen: false,
    });

    const publishedOpen = await createDraft({ title: "Rx published open" });
    await runRepository.updateFields(publishedOpen, { status: "PUBLISHED", signupsOpen: true });
    await runService.cancelRun(lead, publishedOpen);
    await runService.reactivateRun(lead, publishedOpen);
    const pubOpen = await runRepository.findById(publishedOpen);
    expect(pubOpen?.status).toBe("PUBLISHED");
    expect(pubOpen?.signupsOpen).toBe(true);
    expect(isSignupWindowOpen(pubOpen!.status, pubOpen!.signupsOpen)).toBe(true);

    const publishedClosed = await createDraft({ title: "Rx published closed" });
    await runRepository.updateFields(publishedClosed, { status: "PUBLISHED", signupsOpen: false });
    await runService.cancelRun(lead, publishedClosed);
    await runService.reactivateRun(lead, publishedClosed);
    const pubClosed = await runRepository.findById(publishedClosed);
    expect(pubClosed?.status).toBe("PUBLISHED");
    expect(pubClosed?.signupsOpen).toBe(false);
    expect(isSignupWindowOpen(pubClosed!.status, pubClosed!.signupsOpen)).toBe(false);
  });

  it("J–Q: preserves signups/roster/external/lootbuddy/config across cancel+reactivate", async () => {
    const runId = await createDraft({ title: "Rx preserve", notes: "keep-me" });
    await runService.openRun(lead, runId);
    const signupId = await addPendingSignup(runId);
    await orm.RunSignup.where({ id: signupId }).update({ status: "SELECTED", updatedAt: new Date().toISOString() });
    const notSelectedId = await addPendingSignup(runId);
    await orm.RunSignup.where({ id: notSelectedId }).update({
      status: "NOT_SELECTED",
      updatedAt: new Date().toISOString(),
    });
    await addPendingSignup(runId);

    const roster = (await orm.RunRoster.where({ runId }).first()) as Record<string, unknown>;
    await orm.RunRoster.where({ id: String(roster.id) }).update({
      state: "PUBLISHED",
      publishedAt: new Date().toISOString(),
      publishedById: ids.lead,
      version: 3,
      postRevision: 2,
      runChangedSinceAck: true,
      updatedAt: new Date().toISOString(),
    });
    await orm.RunExternalBooster.create({
      id: crypto.randomUUID(),
      rosterId: String(roster.id),
      name: "Ext Booster",
      wowClass: "WARRIOR",
      participationType: "BOOSTER",
      role: "TANK",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await runRepository.updateFields(runId, { status: "PUBLISHED", signupsOpen: true });

    await runService.cancelRun(lead, runId);
    await runService.reactivateRun(lead, runId);

    const restored = await runRepository.findById(runId);
    expect(restored).toMatchObject({
      status: "PUBLISHED",
      signupsOpen: true,
      notes: "keep-me",
    });
    expect(await runRepository.countSignups(runId)).toBe(3);
    const statuses = (
      await orm.RunSignup.where({ runId }).select("id", "status").all()
    ).map((row) => String((row as { status: string }).status)).sort();
    expect(statuses).toEqual(["NOT_SELECTED", "PENDING", "SELECTED"]);
    const rosterAfter = (await orm.RunRoster.where({ runId }).first()) as Record<string, unknown>;
    expect(rosterAfter.state).toBe("PUBLISHED");
    expect(rosterAfter.version).toBe(3);
    expect(rosterAfter.postRevision).toBe(2);
    expect(rosterAfter.runChangedSinceAck).toBe(true);
    expect(rosterAfter.publishedById).toBe(ids.lead);
    expect(await orm.RunExternalBooster.where({ rosterId: String(roster.id) }).all()).toHaveLength(1);
  });

  it("R/S/T/U/V/W: hard blocks + archive restore then reactivate", async () => {
    const inProgressId = await createDraft({ title: "Rx in progress" });
    await runRepository.updateFields(inProgressId, { status: "IN_PROGRESS" });
    await expectDomainCode(runService.reactivateRun(lead, inProgressId), "RUN_CANNOT_REACTIVATE");

    const completedId = await createDraft({ title: "Rx completed" });
    await orm.Run.where({ id: completedId }).update({
      status: "COMPLETED",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await expectDomainCode(runService.reactivateRun(lead, completedId), "RUN_CANNOT_REACTIVATE");

    const legacyId = await createDraft({ title: "Rx legacy cancel" });
    await runRepository.updateFields(legacyId, { status: "CANCELLED", signupsOpen: false });
    // cancelRevision 0 + null snapshot = legacy
    await expectDomainCode(runService.reactivateRun(lead, legacyId), "RUN_CANNOT_REACTIVATE");

    const archivedId = await createDraft({ title: "Rx archived cancel" });
    await runService.openRun(lead, archivedId);
    await runService.cancelRun(lead, archivedId);
    await runService.archiveRun(admin, archivedId);
    await expectDomainCode(runService.reactivateRun(lead, archivedId), "RUN_CANNOT_REACTIVATE");

    await runService.restoreRun(admin, archivedId);
    const stillCancelled = await runRepository.findById(archivedId);
    expect(stillCancelled?.status).toBe("CANCELLED");
    expect(stillCancelled?.archivedAt).toBeNull();
    await runService.reactivateRun(lead, archivedId);
    expect((await runRepository.findById(archivedId))?.status).toBe("OPEN");
  });

  it("X/Y/Z/AA/AB/AC/AD/AE: revisioned notifications + skip pending cancel delivery", async () => {
    const runId = await createDraft({ title: "Rx notify cycles" });
    await runService.openRun(lead, runId);
    await addPendingSignup(runId);
    await discordSyncService.recordRunChannel({ runId, channelId: "rx-chan-1" });

    await runService.cancelRun(lead, runId);
    const cancelAnn1 = await runDiscordAnnouncementRepository.findBySourceKey(
      runCancelledChannelSourceKey(runId, 1),
    );
    expect(cancelAnn1?.status).toBe("PENDING");
    const cancelNote1 = (await userNotificationRepository.listForUser(ids.player, 20)).find(
      (row) => row.runId === runId && row.type === "RUN_CANCELLED",
    );
    expect(cancelNote1?.sourceKey).toBe(runCancelledSourceKey(runId, 1, ids.player));
    expect(cancelNote1?.discordDeliveryStatus).toBe("PENDING");

    await runService.reactivateRun(lead, runId);
    const cancelAnnAfter = await runDiscordAnnouncementRepository.findBySourceKey(
      runCancelledChannelSourceKey(runId, 1),
    );
    expect(cancelAnnAfter?.status).toBe("SKIPPED");
    const cancelNoteAfter = await userNotificationRepository.findById(cancelNote1!.id);
    expect(cancelNoteAfter?.discordDeliveryStatus).toBe("SKIPPED");

    const reactivateAnn = await runDiscordAnnouncementRepository.findBySourceKey(
      runReactivatedChannelSourceKey(runId, 1),
    );
    expect(reactivateAnn?.type).toBe("RUN_REACTIVATED");
    expect(reactivateAnn?.status).toBe("PENDING");
    const reactivateNote = (await userNotificationRepository.listForUser(ids.player, 20)).find(
      (row) => row.runId === runId && row.type === "RUN_REACTIVATED",
    );
    expect(reactivateNote?.sourceKey).toBe(runReactivatedSourceKey(runId, 1, ids.player));

    // Idempotent reactivate must not duplicate
    await expectDomainCode(runService.reactivateRun(lead, runId), "RUN_CANNOT_REACTIVATE");
    const reactivateAnns = (await orm.RunDiscordAnnouncement.where({ runId, type: "RUN_REACTIVATED" }).all()) as Array<
      Record<string, unknown>
    >;
    expect(reactivateAnns).toHaveLength(1);

    // Second cancel cycle
    await runService.cancelRun(lead, runId);
    const runAfterSecondCancel = await runRepository.findById(runId);
    expect(runAfterSecondCancel?.cancelRevision).toBe(2);
    const cancelAnn2 = await runDiscordAnnouncementRepository.findBySourceKey(
      runCancelledChannelSourceKey(runId, 2),
    );
    expect(cancelAnn2?.status).toBe("PENDING");
    expect(cancelAnn2?.sourceKey).not.toBe(cancelAnn1!.sourceKey);

    // Already-SENT cancel remains historical through Reactivate (not rewritten).
    await runDiscordAnnouncementRepository.updateStatus(cancelAnn2!.id, "SENT", {
      sentAt: new Date().toISOString(),
    });
    expect(
      (await runDiscordAnnouncementRepository.findBySourceKey(runCancelledChannelSourceKey(runId, 2)))?.status,
    ).toBe("SENT");

    await runService.reactivateRun(lead, runId);
    expect(
      (await runDiscordAnnouncementRepository.findBySourceKey(runCancelledChannelSourceKey(runId, 2)))?.status,
    ).toBe("SENT");
    // First-cycle SKIPPED also remains untouched.
    expect(
      (await runDiscordAnnouncementRepository.findBySourceKey(runCancelledChannelSourceKey(runId, 1)))?.status,
    ).toBe("SKIPPED");

    const reactivateAnn2 = await runDiscordAnnouncementRepository.findBySourceKey(
      runReactivatedChannelSourceKey(runId, 2),
    );
    expect(reactivateAnn2?.sourceKey).toBe(runReactivatedChannelSourceKey(runId, 2));
    expect(reactivateAnn2?.sourceKey).not.toBe(reactivateAnn!.sourceKey);

    const recent = await activityRepository.listRecent(50);
    const reactivateActivities = recent.filter(
      (row) => row.type === "RUN_REACTIVATED" && row.message.includes("Reactivated a cancelled run"),
    );
    expect(reactivateActivities.length).toBeGreaterThanOrEqual(2);
  });

  it("AF–AK: existing channel not retired after Reactivate; archive pointers cleared; deleted ids not restored", async () => {
    const runId = await createDraft({ title: "Rx discord survive" });
    await runService.openRun(lead, runId);
    await discordSyncService.recordRunChannel({ runId, channelId: "rx-live-chan" });
    await runDiscordPostRepository.recordSignupPost({
      runId,
      signupChannelId: "rx-live-chan",
      signupMessageId: "signup-msg-1",
      lastSignupSignature: "sig",
      runChannelId: "rx-live-chan",
    });
    await runDiscordPostRepository.recordArchiveArtifacts({
      runId,
      archiveCloseMessageId: "arch-close",
      archiveTranscriptMessageId: "arch-transcript",
      archiveTranscriptHtml: "<html>old</html>",
      archiveTranscriptFilename: "old.html",
    });

    await runService.cancelRun(lead, runId);
    let work = await discordSyncService.listSyncWork();
    expect(work.channels.find((row) => row.runId === runId)?.retireChannel).toBe(false);

    await runService.reactivateRun(lead, runId);
    work = await discordSyncService.listSyncWork();
    const channel = work.channels.find((row) => row.runId === runId);
    expect(channel?.retireChannel).toBe(false);
    expect(channel?.existingRunChannelId).toBe("rx-live-chan");
    expect(await discordSyncService.shouldRetireRunChannel(runId)).toBe(false);

    const post = await runDiscordPostRepository.findByRunId(runId);
    expect(post?.runChannelId).toBe("rx-live-chan");
    expect(post?.signupMessageId).toBe("signup-msg-1");
    expect(post?.archiveCloseMessageId).toBeNull();
    expect(post?.archiveTranscriptMessageId).toBeNull();
    expect(post?.archiveTranscriptHtml).toBeNull();
  });

  it("AL/AM: CANCELLED leaves schedule; Reactivate returns to schedule-active set", async () => {
    const runId = await createDraft({ title: "Rx schedule" });
    await runService.openRun(lead, runId);
    const before = await runRepository.listScheduleActiveRunIds();
    expect(before).toContain(runId);

    await runService.cancelRun(lead, runId);
    expect(await runRepository.listScheduleActiveRunIds()).not.toContain(runId);

    await runService.reactivateRun(lead, runId);
    expect(await runRepository.listScheduleActiveRunIds()).toContain(runId);
  });

  it("stale projected CANCELLED announcement cannot send or revive SKIPPED after Reactivate", async () => {
    const runId = await createDraft({ title: "Rx stale announce" });
    await runService.openRun(lead, runId);
    await addPendingSignup(runId);
    await discordSyncService.recordRunChannel({ runId, channelId: "rx-stale-chan" });
    await runService.cancelRun(lead, runId);

    const pendingWork = await discordSyncService.listSyncWork();
    const staleItem = pendingWork.runAnnouncements.find(
      (row) => row.runId === runId && row.type === "RUN_CANCELLED",
    );
    expect(staleItem).toBeTruthy();
    expect(await discordSyncService.getRunAnnouncementDeliveryAuthority(staleItem!.announcementId)).toEqual({
      deliver: true,
    });

    await runService.reactivateRun(lead, runId);
    expect(await discordSyncService.getRunAnnouncementDeliveryAuthority(staleItem!.announcementId)).toEqual({
      deliver: false,
    });

    const skipped = await runDiscordAnnouncementRepository.findById(staleItem!.announcementId);
    expect(skipped?.status).toBe("SKIPPED");

    const record = await discordSyncService.recordRunAnnouncementDelivery({
      announcementId: staleItem!.announcementId,
      result: "SENT",
    });
    expect(record.applied).toBe(false);
    expect((await runDiscordAnnouncementRepository.findById(staleItem!.announcementId))?.status).toBe("SKIPPED");
  });

  it("stale projected CANCELLED DM cannot send or revive SKIPPED after Reactivate", async () => {
    const runId = await createDraft({ title: "Rx stale dm" });
    await runService.openRun(lead, runId);
    await addPendingSignup(runId);
    await runService.cancelRun(lead, runId);

    const notes = (await userNotificationRepository.listForUser(ids.player, 20)).filter(
      (row) => row.runId === runId && row.type === "RUN_CANCELLED",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].discordDeliveryStatus).toBe("PENDING");
    expect(await discordSyncService.getNotificationDmDeliveryAuthority(notes[0].id)).toEqual({ deliver: true });

    await runService.reactivateRun(lead, runId);
    expect(await discordSyncService.getNotificationDmDeliveryAuthority(notes[0].id)).toEqual({ deliver: false });
    expect((await userNotificationRepository.findById(notes[0].id))?.discordDeliveryStatus).toBe("SKIPPED");

    const record = await discordSyncService.recordNotificationDmDelivery({
      notificationId: notes[0].id,
      result: "SENT",
    });
    expect(record.applied).toBe(false);
    expect((await userNotificationRepository.findById(notes[0].id))?.discordDeliveryStatus).toBe("SKIPPED");
  });
});
