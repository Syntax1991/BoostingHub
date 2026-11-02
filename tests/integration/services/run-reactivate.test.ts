import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { FEED_TEST_CLOCK, freezeSystemTime, restoreSystemTime } from "@tests/fixtures/time";
import { futureTestIso, venomousCreateInput } from "@tests/fixtures/test-run-input";
import { isSignupWindowOpen } from "@/domain/run-state";
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
import { signupService } from "@/services/signup.service";
import { activityRepository } from "@/repositories/activity.repository";
import { testActor } from "@tests/fixtures/actors";
import {
  assertIsolatedTestDatabase,
  createTestUser,
  deleteCreatedRows,
  syntheticDiscordId,
} from "@tests/fixtures/db-fixtures";
import { expectDomainError } from "@tests/helpers/domain-error";

const created = { runIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;
let admin: AuthenticatedUser;
let player: AuthenticatedUser;

const CHANNEL = syntheticDiscordId();
const STALE_REACTIVATE_CHANNEL = syntheticDiscordId();
const LIVE_CHANNEL = syntheticDiscordId();
const STALE_CANCEL_CHANNEL = syntheticDiscordId();

async function createUser(
  name: string,
  accountRole: AuthenticatedUser["accountRole"],
  options: { discordUserId?: string; discordUsername?: string } = {},
) {
  const id = await createTestUser({
    name,
    accountRole,
    discordUserId: options.discordUserId ?? null,
    discordUsername: options.discordUsername ?? null,
  });
  created.userIds.push(id);
  // Cancel / reactivate DMs must be opted in for the delivery-authority cases.
  await orm.User.where({ id }).update({
    discordDmEnabled: true,
    dmRosterSelectedEnabled: true,
    dmRaidInviteEnabled: true,
    dmRunCancelledEnabled: true,
    dmRunRescheduledEnabled: true,
    dmRosterRemovedEnabled: true,
    timeZone: "Europe/Berlin",
  });
  return testActor(id, accountRole, {
    name,
    discordUserId: options.discordUserId ?? null,
    discordUsername: options.discordUsername ?? null,
  });
}

// Deterministic wall clock so the global newest-first activity feed asserted
// here is not outranked by rows other suites left behind.
beforeAll(() => freezeSystemTime(FEED_TEST_CLOCK, { advance: true }));
afterAll(() => restoreSystemTime());

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  lead = await createUser("Rx Lead", "RAID_LEAD");
  admin = await createUser("Rx Admin", "ADMIN");
  player = await createUser("Rx Player", "USER", {
    discordUserId: syntheticDiscordId(),
    discordUsername: "rxplayer",
  });
}, 60_000);

afterAll(() => deleteCreatedRows(created), 60_000);

async function createDraft(extra: Record<string, unknown> = {}) {
  const createdRun = await runService.createRun(
    lead,
    venomousCreateInput({
      scheduledStartAt: futureTestIso(10 + created.runIds.length),
      ...extra,
    }),
  );
  created.runIds.push(createdRun.id);
  return createdRun.id;
}

async function addPendingSignup(runId: string) {
  const before = (await orm.RunSignup.where({
    runId,
    userId: player.id,
    participationType: "LOOTBUDDY",
  }).all()) as Array<{
    id: string;
    status: string;
    lootbuddyClass: "MAGE";
    lootbuddyMode: "LOOT_ONLY";
    lootbuddyVerification: "NONE";
  }>;
  const keep = before
    .filter((row) => row.status !== "WITHDRAWN")
    .map((row) => ({
      signupId: row.id,
      wowClass: row.lootbuddyClass,
      mode: row.lootbuddyMode,
      verification: row.lootbuddyVerification,
    }));
  const beforeIds = new Set(before.map((row) => row.id));
  await signupService.setLootbuddies(player, {
    runId,
    lootbuddies: [...keep, { wowClass: "MAGE", mode: "LOOT_ONLY", verification: "NONE" }],
  });
  const after = (await orm.RunSignup.where({
    runId,
    userId: player.id,
    participationType: "LOOTBUDDY",
    status: "PENDING",
  })
    .select("id")
    .all()) as Array<{ id: string }>;
  const newest = after.find((row) => !beforeIds.has(row.id));
  if (!newest) throw new Error("Expected a new pending lootbuddy signup");
  return newest.id;
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
      publishedById: lead.id,
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
    expect(rosterAfter.publishedById).toBe(lead.id);
    expect(await orm.RunExternalBooster.where({ rosterId: String(roster.id) }).all()).toHaveLength(1);
  });

  it("R/S/T/U/V/W: hard blocks + archive restore then reactivate", async () => {
    const inProgressId = await createDraft({ title: "Rx in progress" });
    await runRepository.updateFields(inProgressId, { status: "IN_PROGRESS" });
    await expectDomainError(runService.reactivateRun(lead, inProgressId), "RUN_CANNOT_REACTIVATE");

    const completedId = await createDraft({ title: "Rx completed" });
    await orm.Run.where({ id: completedId }).update({
      status: "COMPLETED",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await expectDomainError(runService.reactivateRun(lead, completedId), "RUN_CANNOT_REACTIVATE");

    const legacyId = await createDraft({ title: "Rx legacy cancel" });
    await runRepository.updateFields(legacyId, { status: "CANCELLED", signupsOpen: false });
    // cancelRevision 0 + null snapshot = legacy
    await expectDomainError(runService.reactivateRun(lead, legacyId), "RUN_CANNOT_REACTIVATE");

    const archivedId = await createDraft({ title: "Rx archived cancel" });
    await runService.openRun(lead, archivedId);
    await runService.cancelRun(lead, archivedId);
    await runService.archiveRun(admin, archivedId);
    await expectDomainError(runService.reactivateRun(lead, archivedId), "RUN_CANNOT_REACTIVATE");

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
    await discordSyncService.recordRunChannel({ runId, channelId: CHANNEL });

    await runService.cancelRun(lead, runId);
    const cancelAnn1 = await runDiscordAnnouncementRepository.findBySourceKey(
      runCancelledChannelSourceKey(runId, 1),
    );
    expect(cancelAnn1?.status).toBe("PENDING");
    const cancelNote1 = (await userNotificationRepository.listForUser(player.id, 20)).find(
      (row) => row.runId === runId && row.type === "RUN_CANCELLED",
    );
    expect(cancelNote1?.sourceKey).toBe(runCancelledSourceKey(runId, 1, player.id));
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
    const reactivateNote = (await userNotificationRepository.listForUser(player.id, 20)).find(
      (row) => row.runId === runId && row.type === "RUN_REACTIVATED",
    );
    expect(reactivateNote?.sourceKey).toBe(runReactivatedSourceKey(runId, 1, player.id));

    // Idempotent reactivate must not duplicate
    await expectDomainError(runService.reactivateRun(lead, runId), "RUN_CANNOT_REACTIVATE");
    const reactivateAnns = (await orm.RunDiscordAnnouncement.where({ runId, type: "RUN_REACTIVATED" }).all()) as Array<
      Record<string, unknown>
    >;
    expect(reactivateAnns).toHaveLength(1);

    // Second cancel cycle — must retire still-PENDING rev1 RUN_REACTIVATED work
    await runService.cancelRun(lead, runId);
    const runAfterSecondCancel = await runRepository.findById(runId);
    expect(runAfterSecondCancel?.cancelRevision).toBe(2);
    const cancelAnn2 = await runDiscordAnnouncementRepository.findBySourceKey(
      runCancelledChannelSourceKey(runId, 2),
    );
    expect(cancelAnn2?.status).toBe("PENDING");
    expect(cancelAnn2?.sourceKey).not.toBe(cancelAnn1!.sourceKey);

    expect(
      (await runDiscordAnnouncementRepository.findBySourceKey(runReactivatedChannelSourceKey(runId, 1)))
        ?.status,
    ).toBe("SKIPPED");
    expect(
      (await userNotificationRepository.findById(reactivateNote!.id))?.discordDeliveryStatus,
    ).toBe("SKIPPED");

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
    expect(
      (await runDiscordAnnouncementRepository.findBySourceKey(runReactivatedChannelSourceKey(runId, 1)))
        ?.status,
    ).toBe("SKIPPED");

    const reactivateAnn2 = await runDiscordAnnouncementRepository.findBySourceKey(
      runReactivatedChannelSourceKey(runId, 2),
    );
    expect(reactivateAnn2?.sourceKey).toBe(runReactivatedChannelSourceKey(runId, 2));
    expect(reactivateAnn2?.sourceKey).not.toBe(reactivateAnn!.sourceKey);
    expect(reactivateAnn2?.status).toBe("PENDING");

    const recent = await activityRepository.listRecent(50);
    const reactivateActivities = recent.filter(
      (row) => row.type === "RUN_REACTIVATED" && row.message.includes("Reactivated a cancelled run"),
    );
    expect(reactivateActivities.length).toBeGreaterThanOrEqual(2);
  });

  it("cancel cycle convergence: PENDING/SENT/FAILED reactivate channel + DM cleanup", async () => {
    // A: first cancel (rev 0 → 1) has no prior RUN_REACTIVATED
    const firstId = await createDraft({ title: "Rx first cancel" });
    await runService.openRun(lead, firstId);
    await runService.cancelRun(lead, firstId);
    expect(await runRepository.findById(firstId)).toMatchObject({ cancelRevision: 1, status: "CANCELLED" });
    expect(
      await runDiscordAnnouncementRepository.findBySourceKey(runReactivatedChannelSourceKey(firstId, 0)),
    ).toBeNull();
    expect(
      await runDiscordAnnouncementRepository.findBySourceKey(runCancelledChannelSourceKey(firstId, 1)),
    ).toMatchObject({ status: "PENDING" });

    // B: PENDING rev1 RUN_REACTIVATED → SKIPPED on second Cancel; rev2 RUN_CANCELLED PENDING
    const pendingId = await createDraft({ title: "Rx pending reactivate skip" });
    await runService.openRun(lead, pendingId);
    await addPendingSignup(pendingId);
    await runService.cancelRun(lead, pendingId);
    await runService.reactivateRun(lead, pendingId);
    const pendingAnn = await runDiscordAnnouncementRepository.findBySourceKey(
      runReactivatedChannelSourceKey(pendingId, 1),
    );
    expect(pendingAnn?.status).toBe("PENDING");
    await runService.cancelRun(lead, pendingId);
    expect(
      (await runDiscordAnnouncementRepository.findBySourceKey(runReactivatedChannelSourceKey(pendingId, 1)))
        ?.status,
    ).toBe("SKIPPED");
    expect(
      (await runDiscordAnnouncementRepository.findBySourceKey(runCancelledChannelSourceKey(pendingId, 2)))
        ?.status,
    ).toBe("PENDING");
    expect(
      (await userNotificationRepository.listForUser(player.id, 50)).find(
        (row) => row.sourceKey === runReactivatedSourceKey(pendingId, 1, player.id),
      )?.discordDeliveryStatus,
    ).toBe("SKIPPED");

    // C: SENT rev1 RUN_REACTIVATED remains SENT on second Cancel
    const sentId = await createDraft({ title: "Rx sent reactivate preserve" });
    await runService.openRun(lead, sentId);
    await runService.cancelRun(lead, sentId);
    await runService.reactivateRun(lead, sentId);
    const sentAnn = await runDiscordAnnouncementRepository.findBySourceKey(
      runReactivatedChannelSourceKey(sentId, 1),
    );
    await runDiscordAnnouncementRepository.updateStatus(sentAnn!.id, "SENT", {
      sentAt: new Date().toISOString(),
    });
    await runService.cancelRun(lead, sentId);
    expect(
      (await runDiscordAnnouncementRepository.findBySourceKey(runReactivatedChannelSourceKey(sentId, 1)))
        ?.status,
    ).toBe("SENT");

    // D: FAILED_PERMANENT rev1 remains FAILED_PERMANENT
    const failedId = await createDraft({ title: "Rx failed reactivate preserve" });
    await runService.openRun(lead, failedId);
    await runService.cancelRun(lead, failedId);
    await runService.reactivateRun(lead, failedId);
    const failedAnn = await runDiscordAnnouncementRepository.findBySourceKey(
      runReactivatedChannelSourceKey(failedId, 1),
    );
    await runDiscordAnnouncementRepository.updateStatus(failedAnn!.id, "FAILED_PERMANENT");
    await runService.cancelRun(lead, failedId);
    expect(
      (await runDiscordAnnouncementRepository.findBySourceKey(runReactivatedChannelSourceKey(failedId, 1)))
        ?.status,
    ).toBe("FAILED_PERMANENT");

    // E/F: Reactivate DM PENDING → SKIPPED; SENT DM preserved
    const dmId = await createDraft({ title: "Rx dm reactivate cleanup" });
    await runService.openRun(lead, dmId);
    await addPendingSignup(dmId);
    await runService.cancelRun(lead, dmId);
    await runService.reactivateRun(lead, dmId);
    const pendingDm = (await userNotificationRepository.listForUser(player.id, 50)).find(
      (row) => row.sourceKey === runReactivatedSourceKey(dmId, 1, player.id),
    );
    expect(pendingDm?.discordDeliveryStatus).toBe("PENDING");
    await runService.cancelRun(lead, dmId);
    expect((await userNotificationRepository.findById(pendingDm!.id))?.discordDeliveryStatus).toBe(
      "SKIPPED",
    );

    const sentDmId = await createDraft({ title: "Rx dm sent preserve" });
    await runService.openRun(lead, sentDmId);
    await addPendingSignup(sentDmId);
    await runService.cancelRun(lead, sentDmId);
    await runService.reactivateRun(lead, sentDmId);
    const sentDm = (await userNotificationRepository.listForUser(player.id, 50)).find(
      (row) => row.sourceKey === runReactivatedSourceKey(sentDmId, 1, player.id),
    );
    await userNotificationRepository.updateDiscordDelivery(sentDm!.id, "SENT");
    await runService.cancelRun(lead, sentDmId);
    expect((await userNotificationRepository.findById(sentDm!.id))?.discordDeliveryStatus).toBe("SENT");
  });

  it("stale projected RUN_REACTIVATED announcement blocked after recancel; SKIPPED→SENT prevented", async () => {
    const runId = await createDraft({ title: "Rx stale reactivate announce" });
    await runService.openRun(lead, runId);
    await addPendingSignup(runId);
    await discordSyncService.recordRunChannel({ runId, channelId: STALE_REACTIVATE_CHANNEL });
    await runService.cancelRun(lead, runId);
    await runService.reactivateRun(lead, runId);

    const pendingWork = await discordSyncService.listSyncWork();
    const staleItem = pendingWork.runAnnouncements.find(
      (row) => row.runId === runId && row.type === "RUN_REACTIVATED",
    );
    expect(staleItem).toBeTruthy();
    expect(await discordSyncService.getRunAnnouncementDeliveryAuthority(staleItem!.announcementId)).toEqual({
      deliver: true,
    });

    await runService.cancelRun(lead, runId);
    expect(await discordSyncService.getRunAnnouncementDeliveryAuthority(staleItem!.announcementId)).toEqual({
      deliver: false,
    });
    expect((await runDiscordAnnouncementRepository.findById(staleItem!.announcementId))?.status).toBe(
      "SKIPPED",
    );

    const record = await discordSyncService.recordRunAnnouncementDelivery({
      announcementId: staleItem!.announcementId,
      result: "SENT",
    });
    expect(record.applied).toBe(false);
    expect((await runDiscordAnnouncementRepository.findById(staleItem!.announcementId))?.status).toBe(
      "SKIPPED",
    );
  });

  it("stale projected RUN_REACTIVATED DM blocked after recancel; SKIPPED→SENT prevented", async () => {
    const runId = await createDraft({ title: "Rx stale reactivate dm" });
    await runService.openRun(lead, runId);
    await addPendingSignup(runId);
    await runService.cancelRun(lead, runId);
    await runService.reactivateRun(lead, runId);

    const notes = (await userNotificationRepository.listForUser(player.id, 50)).filter(
      (row) => row.runId === runId && row.type === "RUN_REACTIVATED",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].discordDeliveryStatus).toBe("PENDING");
    expect(await discordSyncService.getNotificationDmDeliveryAuthority(notes[0].id)).toEqual({
      deliver: true,
    });

    await runService.cancelRun(lead, runId);
    expect(await discordSyncService.getNotificationDmDeliveryAuthority(notes[0].id)).toEqual({
      deliver: false,
    });
    expect((await userNotificationRepository.findById(notes[0].id))?.discordDeliveryStatus).toBe(
      "SKIPPED",
    );

    const record = await discordSyncService.recordNotificationDmDelivery({
      notificationId: notes[0].id,
      result: "SENT",
    });
    expect(record.applied).toBe(false);
    expect((await userNotificationRepository.findById(notes[0].id))?.discordDeliveryStatus).toBe(
      "SKIPPED",
    );
  });

  it("three cancel/reactivate cycles: unique keys and no permanently PENDING obsolete rev work", async () => {
    const runId = await createDraft({ title: "Rx triple cycle" });
    await runService.openRun(lead, runId);
    await addPendingSignup(runId);

    for (let revision = 1; revision <= 3; revision += 1) {
      await runService.cancelRun(lead, runId);
      expect(await runRepository.findById(runId)).toMatchObject({
        status: "CANCELLED",
        cancelRevision: revision,
      });
      expect(
        (await runDiscordAnnouncementRepository.findBySourceKey(
          runCancelledChannelSourceKey(runId, revision),
        ))?.status,
      ).toBe("PENDING");

      if (revision > 1) {
        expect(
          (await runDiscordAnnouncementRepository.findBySourceKey(
            runReactivatedChannelSourceKey(runId, revision - 1),
          ))?.status,
        ).toBe("SKIPPED");
        const priorDm = (await userNotificationRepository.listForUser(player.id, 50)).find(
          (row) => row.sourceKey === runReactivatedSourceKey(runId, revision - 1, player.id),
        );
        expect(priorDm?.discordDeliveryStatus).toBe("SKIPPED");
      }

      await runService.reactivateRun(lead, runId);
      expect(await runRepository.findById(runId)).toMatchObject({
        status: "OPEN",
        cancelRevision: revision,
      });
      expect(
        (await runDiscordAnnouncementRepository.findBySourceKey(
          runReactivatedChannelSourceKey(runId, revision),
        ))?.status,
      ).toBe("PENDING");
    }

    const cancelledKeys = [1, 2, 3].map((rev) => runCancelledChannelSourceKey(runId, rev));
    const reactivatedKeys = [1, 2, 3].map((rev) => runReactivatedChannelSourceKey(runId, rev));
    expect(new Set(cancelledKeys).size).toBe(3);
    expect(new Set(reactivatedKeys).size).toBe(3);
    expect(
      (await runDiscordAnnouncementRepository.findBySourceKey(runReactivatedChannelSourceKey(runId, 1)))
        ?.status,
    ).toBe("SKIPPED");
    expect(
      (await runDiscordAnnouncementRepository.findBySourceKey(runReactivatedChannelSourceKey(runId, 2)))
        ?.status,
    ).toBe("SKIPPED");
    expect(
      (await runDiscordAnnouncementRepository.findBySourceKey(runReactivatedChannelSourceKey(runId, 3)))
        ?.status,
    ).toBe("PENDING");
  });

  it("AF–AK: existing channel not retired after Reactivate; archive pointers cleared; deleted ids not restored", async () => {
    const runId = await createDraft({ title: "Rx discord survive" });
    await runService.openRun(lead, runId);
    await discordSyncService.recordRunChannel({ runId, channelId: LIVE_CHANNEL });
    await runDiscordPostRepository.recordSignupPost({
      runId,
      signupChannelId: LIVE_CHANNEL,
      signupMessageId: "signup-msg-1",
      lastSignupSignature: "sig",
      runChannelId: LIVE_CHANNEL,
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
    expect(channel?.existingRunChannelId).toBe(LIVE_CHANNEL);
    expect(await discordSyncService.shouldRetireRunChannel(runId)).toBe(false);

    const post = await runDiscordPostRepository.findByRunId(runId);
    expect(post?.runChannelId).toBe(LIVE_CHANNEL);
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
    await discordSyncService.recordRunChannel({ runId, channelId: STALE_CANCEL_CHANNEL });
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

    const notes = (await userNotificationRepository.listForUser(player.id, 20)).filter(
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
