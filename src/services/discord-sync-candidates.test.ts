import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { classifyRunWeek } from "@/lib/wow-run-week";
import type { RunStatus } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { runRepository } from "@/repositories/run.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { runService } from "@/services/run.service";

/**
 * Discord sync candidate selection: only Runs that can still produce Discord
 * work get the full Run load, and RunDiscordPost state is read in one batch.
 * Lane semantics themselves are covered by discord-sync.service.test.ts.
 */

const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-dc0000000001",
};
const lead: AuthenticatedUser = {
  id: ids.lead,
  name: "Candidate Lead",
  email: `${ids.lead}@dscand.boostting.local`,
  image: null,
  discordUserId: null,
  discordUsername: null,
  accountRole: "RAID_LEAD",
  accountStatus: "ACTIVE",
};

// A classification "now" far enough ahead that every schedule below is still
// in the real future (createRun rejects past schedules); only the `now` passed
// to listSyncWork decides the week bucket.
const classificationNow = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
const { currentStart, nextStart, followingStart } = classifyRunWeek({
  scheduledStartAt: classificationNow.toISOString(),
  now: classificationNow,
});
const createdRunIds: string[] = [];

async function createRunAt(scheduledStartAt: string, state: { status?: RunStatus; archived?: boolean } = {}) {
  const id = await runService
    .createRun(lead, {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt,
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 2,
    })
    .then((run) => run.id);
  createdRunIds.push(id);
  if (state.status || state.archived) {
    const now = new Date().toISOString();
    await orm.Run.where({ id }).update({
      ...(state.status ? { status: state.status, signupsOpen: state.status === "OPEN" || state.status === "ROSTERING" } : {}),
      ...(state.archived ? { archivedAt: now } : {}),
      updatedAt: now,
    });
  }
  return id;
}

async function addStartSnapshot(runId: string) {
  const now = new Date().toISOString();
  await orm.RunStartSnapshot.create({
    id: crypto.randomUUID(),
    runId,
    startedAt: now,
    startedById: ids.lead,
    createdAt: now,
    updatedAt: now,
  });
}

async function addPendingAnnouncement(runId: string, type: "RUN_CANCELLED" | "RUN_RESCHEDULED" = "RUN_CANCELLED") {
  const id = crypto.randomUUID();
  // Oldest-first ordering: an early createdAt keeps this row inside listPending(50).
  const createdAt = new Date(Date.UTC(2000, 0, 1, 0, 0, createdRunIds.length)).toISOString();
  await orm.RunDiscordAnnouncement.create({
    id,
    runId,
    type,
    sourceKey: `test-candidate:${id}`,
    previousScheduledStartAt: null,
    scheduledStartAt: nextStart,
    productLabel: "Candidate Test",
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    status: "PENDING",
    createdAt,
    sentAt: null,
    updatedAt: createdAt,
  });
  return id;
}

async function setPost(runId: string, fields: Record<string, unknown>) {
  // Ensure the row exists via the repository, then set exact test state.
  await runDiscordPostRepository.recordRaidInviteSent({ runId, signupId: "seed-signup" });
  await orm.RunDiscordPost.where({ runId }).update({ ...fields, updatedAt: new Date().toISOString() });
}

/** Run ids the sync fully loaded in one listSyncWork call. */
async function loadedRunIds(now: Date) {
  const spy = vi.spyOn(runRepository, "listManagedByIds");
  const work = await discordSyncService.listSyncWork(now);
  const loaded = new Set<string>();
  for (const call of spy.mock.results) {
    for (const run of (await call.value) as Array<{ id: string }>) loaded.add(run.id);
  }
  spy.mockRestore();
  return { work, loaded };
}

function lanesFor(work: Awaited<ReturnType<typeof discordSyncService.listSyncWork>>, runId: string) {
  return {
    channels: work.channels.filter((item) => item.runId === runId),
    voice: work.voiceChannels.filter((item) => item.runId === runId),
    signups: work.signups.filter((item) => item.runId === runId),
    roster: work.roster.filter((item) => item.runId === runId),
    start: work.start.filter((item) => item.runId === runId),
    announcements: work.runAnnouncements.filter((item) => item.runId === runId),
  };
}

function expectNoWork(work: Awaited<ReturnType<typeof discordSyncService.listSyncWork>>, runId: string) {
  const lanes = lanesFor(work, runId);
  for (const [lane, items] of Object.entries(lanes)) {
    expect(items, lane).toHaveLength(0);
  }
}

async function cleanupRun(runId: string) {
  await orm.RunDiscordAnnouncement.where({ runId }).delete().catch(() => {});
  await orm.RunDiscordPost.where({ runId }).delete().catch(() => {});
  await orm.RunStartSnapshot.where({ runId }).delete().catch(() => {});
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) await orm.RunRoster.where({ runId }).delete().catch(() => {});
  await orm.Run.where({ id: runId }).delete().catch(() => {});
}

async function cleanupAll() {
  const runs = await orm.Run.where({ raidLeadId: ids.lead }).select("id").all();
  for (const row of runs) await cleanupRun((row as { id: string }).id);
  await orm.User.where({ id: ids.lead }).delete().catch(() => {});
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanupAll();
  await orm.User.create({
    id: ids.lead,
    name: "Candidate Lead",
    email: `${ids.lead}@dscand.boostting.local`,
    emailVerified: true,
    discordUserId: null,
    accountRole: "RAID_LEAD",
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(cleanupAll, 60_000);

describe("Discord sync candidate selection", () => {
  it("1. a fully retired historical Run (only history left) is not loaded and produces no work", async () => {
    const completedArchived = await createRunAt(currentStart, { status: "COMPLETED", archived: true });
    const cancelled = await createRunAt(nextStart, { status: "CANCELLED" });
    for (const runId of [completedArchived, cancelled]) {
      await setPost(runId, {
        startChannelId: "retired-chan",
        startMessageId: "start-msg",
        startPostedAt: new Date().toISOString(),
        lastStartRosterVersion: 3,
        lastStartVoiceChannelId: "retired-voice",
        rosterMessageId: "roster-msg",
        lastRosterVersion: 3,
        archiveCloseMessageId: "close",
        archiveTranscriptMessageId: "transcript",
        archiveTranscriptHtml: "<html>kept</html>",
        archiveTranscriptFilename: "transcript.html",
      });
    }

    expect(await runDiscordPostRepository.listLiveIdentityRunIds()).not.toEqual(
      expect.arrayContaining([completedArchived]),
    );
    const { work, loaded } = await loadedRunIds(classificationNow);
    expect(loaded.has(completedArchived)).toBe(false);
    expect(loaded.has(cancelled)).toBe(false);
    expectNoWork(work, completedArchived);
    expectNoWork(work, cancelled);
  });

  it("2. OPEN / ROSTERING without a post stay discoverable; FUTURE → CURRENT needs no DB write", async () => {
    const open = await createRunAt(followingStart, { status: "OPEN" });
    const rostering = await createRunAt(followingStart, { status: "ROSTERING" });

    let { work, loaded } = await loadedRunIds(classificationNow);
    expect(loaded.has(open)).toBe(true);
    expect(loaded.has(rostering)).toBe(true);
    // FUTURE: the week gate blocks first provisioning.
    expect(lanesFor(work, open).signups).toHaveLength(0);
    expect(lanesFor(work, rostering).signups).toHaveLength(0);

    // Only `now` moves: the same Runs are now CURRENT and eligible.
    ({ work, loaded } = await loadedRunIds(new Date(followingStart)));
    for (const runId of [open, rostering]) {
      const [signup] = lanesFor(work, runId).signups;
      expect(signup).toMatchObject({ targetBucket: "CURRENT", allowChannelCreate: true, existingRunChannelId: null });
    }
  });

  it("3. PUBLISHED with a live Run channel is loaded and reconciled", async () => {
    const runId = await createRunAt(nextStart, { status: "PUBLISHED" });
    await discordSyncService.recordRunChannel({ runId, channelId: "published-chan" });

    const { work, loaded } = await loadedRunIds(classificationNow);
    expect(loaded.has(runId)).toBe(true);
    expect(lanesFor(work, runId).channels).toMatchObject([
      { existingRunChannelId: "published-chan", targetBucket: "NEXT", retireChannel: false },
    ]);
  });

  it("4. PUBLISHED without any Discord presence is excluded and never provisioned retroactively", async () => {
    const runId = await createRunAt(nextStart, { status: "PUBLISHED" });

    const { work, loaded } = await loadedRunIds(classificationNow);
    expect(loaded.has(runId)).toBe(false);
    expectNoWork(work, runId);
    expect(await runDiscordPostRepository.findByRunId(runId)).toBeNull();
  });

  it("5. IN_PROGRESS with a start snapshot and no post is loaded and gets Voice PROVISION", async () => {
    const runId = await createRunAt(currentStart, { status: "IN_PROGRESS" });
    await addStartSnapshot(runId);

    const { work, loaded } = await loadedRunIds(classificationNow);
    expect(loaded.has(runId)).toBe(true);
    expect(lanesFor(work, runId).voice).toMatchObject([{ action: "PROVISION", existingVoiceChannelId: null }]);
  });

  it("6. IN_PROGRESS with a Voice channel keeps RECONCILE", async () => {
    const runId = await createRunAt(currentStart, { status: "IN_PROGRESS" });
    await addStartSnapshot(runId);
    await discordSyncService.recordRunVoiceChannel({ runId, channelId: "voice-live" });

    const { work } = await loadedRunIds(classificationNow);
    expect(lanesFor(work, runId).voice).toMatchObject([{ action: "RECONCILE", existingVoiceChannelId: "voice-live" }]);
  });

  it("7. COMPLETED / CANCELLED with a Run channel are loaded and retire it", async () => {
    for (const status of ["COMPLETED", "CANCELLED"] as const) {
      const runId = await createRunAt(currentStart, { status });
      await discordSyncService.recordRunChannel({ runId, channelId: `terminal-chan-${status}` });

      const { work, loaded } = await loadedRunIds(classificationNow);
      expect(loaded.has(runId)).toBe(true);
      expect(lanesFor(work, runId).channels).toMatchObject([
        { existingRunChannelId: `terminal-chan-${status}`, retireChannel: true, archiveArtifactsNeeded: true },
      ]);
    }
  });

  it("8. a terminal Run holding only a Voice channel is loaded and gets RETIRE_IF_EMPTY", async () => {
    const runId = await createRunAt(currentStart, { status: "COMPLETED", archived: true });
    await discordSyncService.recordRunVoiceChannel({ runId, channelId: "voice-leftover" });

    const { work, loaded } = await loadedRunIds(classificationNow);
    expect(loaded.has(runId)).toBe(true);
    expect(lanesFor(work, runId).voice).toMatchObject([
      { action: "RETIRE_IF_EMPTY", existingVoiceChannelId: "voice-leftover" },
    ]);

    await discordSyncService.clearRunVoiceChannel({ runId, channelId: "voice-leftover" });
    const after = await loadedRunIds(classificationNow);
    expect(after.loaded.has(runId)).toBe(false);
    expectNoWork(after.work, runId);
  });

  it("9. app-archived with a Run channel: transcript + delete lifecycle, then it drops out", async () => {
    const runId = await createRunAt(currentStart, { status: "COMPLETED", archived: true });
    await discordSyncService.recordRunChannel({ runId, channelId: "archived-chan" });

    let { work } = await loadedRunIds(classificationNow);
    expect(lanesFor(work, runId).channels).toMatchObject([
      { targetBucket: "ARCHIVE", retireChannel: true, archiveArtifactsNeeded: true },
    ]);

    await discordSyncService.recordArchiveArtifacts({
      runId,
      closeMessageId: "close-1",
      transcriptMessageId: "transcript-1",
      transcriptHtml: "<html>t</html>",
      transcriptFilename: "t.html",
    });
    ({ work } = await loadedRunIds(classificationNow));
    expect(lanesFor(work, runId).channels).toMatchObject([{ retireChannel: true, archiveArtifactsNeeded: false }]);

    // The bot deleted the channel: only history remains.
    await discordSyncService.clearRunChannel(runId);
    const after = await loadedRunIds(classificationNow);
    expect(after.loaded.has(runId)).toBe(false);
    expectNoWork(after.work, runId);
  });

  it("10. a pending announcement gets the live runChannelId and blocks retirement until delivered", async () => {
    const runId = await createRunAt(currentStart, { status: "CANCELLED" });
    await discordSyncService.recordRunChannel({ runId, channelId: "cancel-chan" });
    const announcementId = await addPendingAnnouncement(runId);

    let { work } = await loadedRunIds(classificationNow);
    expect(lanesFor(work, runId).announcements).toMatchObject([
      { announcementId, type: "RUN_CANCELLED", runChannelId: "cancel-chan" },
    ]);
    expect(lanesFor(work, runId).channels).toMatchObject([
      { retireChannel: false, pendingLifecycleAnnouncements: true, archiveArtifactsNeeded: false },
    ]);

    await orm.RunDiscordAnnouncement.where({ id: announcementId }).update({
      status: "SENT",
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    ({ work } = await loadedRunIds(classificationNow));
    expect(lanesFor(work, runId).announcements).toHaveLength(0);
    expect(lanesFor(work, runId).channels).toMatchObject([{ retireChannel: true, pendingLifecycleAnnouncements: false }]);
  });

  it("11. a pending announcement for a Run without a channel keeps runChannelId null (Run itself not loaded)", async () => {
    const runId = await createRunAt(nextStart, { status: "CANCELLED" });
    const announcementId = await addPendingAnnouncement(runId, "RUN_RESCHEDULED");

    const { work, loaded } = await loadedRunIds(classificationNow);
    expect(loaded.has(runId)).toBe(false);
    expect(lanesFor(work, runId).announcements).toMatchObject([
      { announcementId, type: "RUN_RESCHEDULED", runChannelId: null },
    ]);
  });

  it("12. an existing channel keeps following the schedule: FUTURE → NEXT → CURRENT → PAST holding", async () => {
    const runId = await createRunAt(followingStart, { status: "PUBLISHED" });
    await discordSyncService.recordRunChannel({ runId, channelId: "rolling-chan" });
    const afterRun = new Date(new Date(followingStart).getTime() + 8 * 24 * 60 * 60 * 1000);

    const buckets: string[] = [];
    for (const now of [classificationNow, new Date(nextStart), new Date(followingStart), afterRun]) {
      const { work, loaded } = await loadedRunIds(now);
      expect(loaded.has(runId)).toBe(true);
      const [channel] = lanesFor(work, runId).channels;
      expect(channel.retireChannel).toBe(false);
      buckets.push(channel.targetBucket);
    }
    expect(buckets).toEqual(["ARCHIVE", "NEXT", "CURRENT", "ARCHIVE"]);
  });

  it("13. a retired channel's leftover signup identity stays a candidate until channel-gone, then drops out without recreation", async () => {
    const runId = await createRunAt(nextStart, { status: "OPEN" });
    await discordSyncService.recordRunChannel({ runId, channelId: "dead-chan" });
    await discordSyncService.recordSignupPost({ runId, channelId: "dead-chan", messageId: "dead-msg" });
    await orm.Run.where({ id: runId }).update({ status: "CANCELLED", updatedAt: new Date().toISOString() });
    await runService.archiveRun(lead, runId);
    await discordSyncService.clearRunChannel(runId);

    let { work, loaded } = await loadedRunIds(classificationNow);
    expect(loaded.has(runId)).toBe(true);
    expect(lanesFor(work, runId).channels).toHaveLength(0);
    expect(lanesFor(work, runId).signups).toMatchObject([
      { existingRunChannelId: "dead-chan", allowChannelCreate: false },
    ]);

    await discordSyncService.recordRunChannelGone({ runId, channelId: "dead-chan" });
    ({ work, loaded } = await loadedRunIds(classificationNow));
    expect(loaded.has(runId)).toBe(false);
    expectNoWork(work, runId);
  });
});

describe("Discord sync batching", () => {
  it("N candidate Runs and pending announcements share ONE post read — no per-Run findByRunId", async () => {
    const runIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const runId = await createRunAt(nextStart, { status: "PUBLISHED" });
      await discordSyncService.recordRunChannel({ runId, channelId: `batch-chan-${index}` });
      runIds.push(runId);
    }
    const announcementRunIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const runId = await createRunAt(nextStart, { status: "CANCELLED" });
      if (index === 0) await discordSyncService.recordRunChannel({ runId, channelId: "batch-cancel-chan" });
      await addPendingAnnouncement(runId);
      announcementRunIds.push(runId);
    }

    const findByRunId = vi.spyOn(runDiscordPostRepository, "findByRunId");
    const listByRunIds = vi.spyOn(runDiscordPostRepository, "listByRunIds");
    const listManaged = vi.spyOn(runRepository, "listManaged");
    const listManagedByIds = vi.spyOn(runRepository, "listManagedByIds");

    const work = await discordSyncService.listSyncWork(classificationNow);

    const fixtureIds = new Set([...runIds, ...announcementRunIds]);
    expect(findByRunId.mock.calls.filter(([runId]) => fixtureIds.has(runId))).toHaveLength(0);
    expect(listManaged).not.toHaveBeenCalled();
    expect(listManagedByIds).toHaveBeenCalledTimes(1);
    expect(listByRunIds).toHaveBeenCalledTimes(1);
    const batchedIds = new Set(listByRunIds.mock.calls[0][0]);
    for (const runId of fixtureIds) expect(batchedIds.has(runId)).toBe(true);

    for (const [index, runId] of runIds.entries()) {
      expect(lanesFor(work, runId).channels).toMatchObject([{ existingRunChannelId: `batch-chan-${index}` }]);
    }
    expect(announcementRunIds.map((runId) => lanesFor(work, runId).announcements[0]?.runChannelId)).toEqual([
      "batch-cancel-chan",
      null,
      null,
    ]);

    // Test-visible load size: fully loaded Runs vs all Runs in the database.
    const loaded = ((await listManagedByIds.mock.results[0].value) as unknown[]).length;
    const total = (await orm.Run.select("id").all()).length;
    console.info(`[discord-sync candidates] full Run loads: ${loaded} of ${total} Runs`);
    expect(loaded).toBeLessThan(total);
  });

  it("equivalence: loading EVERY Run (the old behaviour) plans exactly the same work across the whole database", async () => {
    const allRunIds = (await orm.Run.select("id").all()).map((row) => (row as { id: string }).id);
    // Sort per lane so same-scheduledStartAt ties can't reorder between queries.
    const normalize = (work: Awaited<ReturnType<typeof discordSyncService.listSyncWork>>) =>
      Object.fromEntries(
        Object.entries(work).map(([lane, items]) => [
          lane,
          [...(items as Array<{ runId?: string }>)].sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b)),
          ),
        ]),
      );

    for (const now of [classificationNow, new Date(nextStart), new Date(followingStart), new Date()]) {
      const filtered = normalize(await discordSyncService.listSyncWork(now));
      const base = vi.spyOn(runRepository, "listDiscordSyncBaseRunIds").mockResolvedValue(allRunIds);
      const everything = normalize(await discordSyncService.listSyncWork(now));
      base.mockRestore();
      expect(filtered).toEqual(everything);
    }
  });

  it("listManagedByIds: empty input returns []; results are deduplicated and keep scheduledStartAt order", async () => {
    expect(await runRepository.listManagedByIds([])).toEqual([]);

    const later = await createRunAt(followingStart, { status: "OPEN" });
    const earlier = await createRunAt(currentStart, { status: "OPEN" });
    const runs = await runRepository.listManagedByIds([later, earlier, later]);
    expect(runs.map((run) => run.id)).toEqual([earlier, later]);
  });
});
