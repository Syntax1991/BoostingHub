/**
 * Discord Schedule lane: listSyncWork produces CURRENT/NEXT desired state;
 * COMPLETED/CANCELLED drop immediately even while Run channels still exist.
 *
 * The two Schedule messages and their recorded state are community-wide, so the
 * suite runs in raid weeks no other suite uses (DISCORD_SCHEDULE_TEST_CLOCK) and
 * puts back the schedule post rows it found.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { SCHEDULE_EMPTY_DESCRIPTION } from "@/lib/discord-schedule";
import { anyContentRunInput } from "@tests/fixtures/test-run-input";
import { classifyRunWeek } from "@/lib/wow-run-week";
import type { RunStatus } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { runService } from "@/services/run.service";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows, syntheticDiscordId } from "@tests/fixtures/db-fixtures";
import { DAY_MS, DISCORD_SCHEDULE_TEST_CLOCK, HOUR_MS, freezeSystemTime, restoreSystemTime } from "@tests/fixtures/time";

const LEAD_NAME = "Schedule Lead";
let lead: AuthenticatedUser;
const created = { runIds: [] as string[], userIds: [] as string[] };

/** Runs are created at the frozen clock and classified a week later, so the PAST week is still creatable. */
const classificationNow = new Date(Date.parse(DISCORD_SCHEDULE_TEST_CLOCK) + 7 * DAY_MS);
const { currentStart, nextStart, followingStart } = classifyRunWeek({
  scheduledStartAt: classificationNow.toISOString(),
  now: classificationNow,
});

function hoursAfter(weekStart: string, hours: number): string {
  return new Date(Date.parse(weekStart) + hours * HOUR_MS).toISOString();
}

async function createRunAt(scheduledStartAt: string, state: { status?: RunStatus; archived?: boolean } = {}) {
  const { id } = await runService.createRun(
    lead,
    anyContentRunInput({ lootType: "VIP", scheduledStartAt, desiredTankCount: 1, desiredHealerCount: 1, desiredDpsCount: 2 }),
  );
  created.runIds.push(id);
  if (state.status || state.archived) {
    const now = new Date().toISOString();
    await orm.Run.where({ id }).update({
      ...(state.status ? { status: state.status, signupsOpen: state.status === "OPEN" || state.status === "ROSTERING" || state.status === "PUBLISHED" } : {}),
      ...(state.archived ? { archivedAt: now } : {}),
      updatedAt: now,
    });
  }
  return id;
}

async function setRunChannel(runId: string, channelId: string) {
  await runDiscordPostRepository.recordRunChannel({ runId, channelId });
}

type SchedulePostRow = Record<string, unknown>;
let schedulePostsBefore: SchedulePostRow[] = [];

/** Replaces the (at most two) community-wide schedule post rows with the ones the suite found. */
async function restoreSchedulePosts() {
  assertIsolatedTestDatabase();
  for (const bucket of ["CURRENT", "NEXT"] as const) await orm.DiscordSchedulePost.where({ bucket }).deleteAndCount();
  for (const row of schedulePostsBefore) await orm.DiscordSchedulePost.create(row as Parameters<typeof orm.DiscordSchedulePost.create>[0]);
}

function scheduleLineFor(work: Awaited<ReturnType<typeof discordSyncService.listSyncWork>>, bucket: "CURRENT" | "NEXT") {
  return work.schedules.find((item) => item.bucket === bucket)!;
}

function descriptionMentions(work: Awaited<ReturnType<typeof discordSyncService.listSyncWork>>, bucket: "CURRENT" | "NEXT") {
  return scheduleLineFor(work, bucket).embed.description;
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  freezeSystemTime(DISCORD_SCHEDULE_TEST_CLOCK, { advance: true });
  await raidRepository.ensureReferenceRaids();
  schedulePostsBefore = (await orm.DiscordSchedulePost.all()) as SchedulePostRow[];
  const leadId = await createTestUser({ name: LEAD_NAME, accountRole: "RAID_LEAD", discordUserId: syntheticDiscordId() });
  created.userIds.push(leadId);
  lead = testActor(leadId, "RAID_LEAD", { name: LEAD_NAME });
});

afterEach(async () => {
  await deleteCreatedRows({ runIds: created.runIds.splice(0) });
  await restoreSchedulePosts();
});

afterAll(async () => {
  await deleteCreatedRows(created);
  restoreSystemTime();
});

describe("discord schedule lane — listSyncWork", () => {
  it("always returns exactly two schedule items (Y)", async () => {
    const work = await discordSyncService.listSyncWork(classificationNow);
    expect(work.schedules).toHaveLength(2);
    expect(work.schedules.map((s) => s.bucket).sort()).toEqual(["CURRENT", "NEXT"]);
  });

  it("A–D: OPEN/ROSTERING/PUBLISHED/IN_PROGRESS CURRENT appear on CURRENT", async () => {
    const statuses = ["OPEN", "ROSTERING", "PUBLISHED", "IN_PROGRESS"] as const;
    for (let i = 0; i < statuses.length; i++) {
      await createRunAt(hoursAfter(currentStart, i + 2), {
        status: statuses[i],
      });
    }
    const work = await discordSyncService.listSyncWork(classificationNow);
    const current = scheduleLineFor(work, "CURRENT");
    expect(current.embed.title).toContain("Current Raid ID");
    expect(current.embed.description.split("\n").length).toBe(statuses.length);
    expect(current.embed.description).toMatch(/🟢 Open/);
    expect(current.embed.description).toMatch(/🟡 Rostering/);
    expect(current.embed.description).toMatch(/🔵 Published/);
    expect(current.embed.description).toMatch(/🔴 In Progress/);
    expect(scheduleLineFor(work, "NEXT").embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
  });

  it("E: DRAFT excluded from both schedules", async () => {
    await createRunAt(hoursAfter(currentStart, 4), { status: "DRAFT" });
    const work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
    expect(scheduleLineFor(work, "NEXT").embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
  });

  it("F/S: COMPLETED excluded immediately even if Run channel still exists", async () => {
    const id = await createRunAt(hoursAfter(currentStart, 5), {
      status: "OPEN",
    });
    await setRunChannel(id, "chan-still-alive");
    let work = await discordSyncService.listSyncWork(classificationNow);
    expect(descriptionMentions(work, "CURRENT")).toContain("<#chan-still-alive>");

    await orm.Run.where({ id }).update({ status: "COMPLETED", signupsOpen: false, updatedAt: new Date().toISOString() });
    work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
    expect(scheduleLineFor(work, "NEXT").embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
    // Channel lane may still see the channel for archive — Schedule must not.
    expect(work.channels.some((c) => c.runId === id && c.existingRunChannelId === "chan-still-alive")).toBe(true);
  });

  it("G/T: CANCELLED excluded immediately even if Run channel still exists", async () => {
    const id = await createRunAt(hoursAfter(currentStart, 6), {
      status: "OPEN",
    });
    await setRunChannel(id, "chan-cancel-alive");
    await orm.Run.where({ id }).update({ status: "CANCELLED", signupsOpen: false, updatedAt: new Date().toISOString() });
    const work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).not.toContain("<#chan-cancel-alive>");
    expect(scheduleLineFor(work, "CURRENT").embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
  });

  it("H: NEXT active Runs only in NEXT", async () => {
    const id = await createRunAt(hoursAfter(nextStart, 8), { status: "OPEN" });
    await setRunChannel(id, "chan-next");
    const work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
    expect(scheduleLineFor(work, "NEXT").embed.description).toContain("<#chan-next>");
  });

  it("I/J: PAST and FUTURE beyond NEXT excluded", async () => {
    const pastId = await createRunAt(hoursAfter(currentStart, -24), {
      status: "OPEN",
    });
    const futureId = await createRunAt(hoursAfter(followingStart, 8), {
      status: "OPEN",
    });
    await setRunChannel(pastId, "chan-past");
    await setRunChannel(futureId, "chan-future");
    const work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
    expect(scheduleLineFor(work, "NEXT").embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
  });

  it("K/L: chronological ASC with run-id tie-break", async () => {
    // Created out of order; the two tied starts are ordered by Run id.
    const later = await createRunAt(hoursAfter(currentStart, 11), { status: "OPEN" });
    const earlier = await createRunAt(hoursAfter(currentStart, 10), { status: "OPEN" });
    const tieA = await createRunAt(hoursAfter(currentStart, 12), { status: "OPEN" });
    const tieB = await createRunAt(hoursAfter(currentStart, 12), { status: "OPEN" });
    const channelOf = new Map([
      [later, "chan-later"],
      [earlier, "chan-earlier"],
      [tieA, "chan-tie-a"],
      [tieB, "chan-tie-b"],
    ]);
    for (const [runId, channelId] of channelOf) await setRunChannel(runId, channelId);
    const work = await discordSyncService.listSyncWork(classificationNow);
    const lines = scheduleLineFor(work, "CURRENT").embed.description.split("\n");
    const ties = [tieA, tieB].sort();
    expect(lines.map((line) => line.match(/<#([^>]+)>/)?.[1])).toEqual(
      [earlier, later, ...ties].map((runId) => channelOf.get(runId)),
    );
  });

  it("M/N: without channel still shown; with channel shows mention", async () => {
    await createRunAt(hoursAfter(currentStart, 12), {
      status: "OPEN",
    });
    const withChan = await createRunAt(hoursAfter(currentStart, 13), {
      status: "OPEN",
    });
    await setRunChannel(withChan, "chan-visible");
    const work = await discordSyncService.listSyncWork(classificationNow);
    const [withoutChannelLine, withChannelLine, ...rest] = scheduleLineFor(work, "CURRENT").embed.description.split("\n");
    expect(rest).toEqual([]);
    expect(withoutChannelLine).not.toContain("<#");
    expect(withoutChannelLine).toMatch(new RegExp(`· ${LEAD_NAME}$`));
    expect(withChannelLine).toMatch(new RegExp(`· <#chan-visible> · ${LEAD_NAME}$`));
  });

  it("O/P/Q/R: a reschedule moves the Run between CURRENT, NEXT and beyond", async () => {
    const id = await createRunAt(hoursAfter(currentStart, 14), {
      status: "OPEN",
    });
    await setRunChannel(id, "chan-move");
    let work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).toContain("chan-move");

    // CURRENT → NEXT
    await orm.Run.where({ id }).update({
      scheduledStartAt: hoursAfter(nextStart, 4),
      updatedAt: new Date().toISOString(),
    });
    work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).not.toContain("chan-move");
    expect(scheduleLineFor(work, "NEXT").embed.description).toContain("chan-move");

    // NEXT → CURRENT
    await orm.Run.where({ id }).update({
      scheduledStartAt: hoursAfter(currentStart, 15),
      updatedAt: new Date().toISOString(),
    });
    work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "NEXT").embed.description).not.toContain("chan-move");
    expect(scheduleLineFor(work, "CURRENT").embed.description).toContain("chan-move");

    // Outside both → FUTURE
    await orm.Run.where({ id }).update({
      scheduledStartAt: hoursAfter(followingStart, 4),
      updatedAt: new Date().toISOString(),
    });
    work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).not.toContain("chan-move");
    expect(scheduleLineFor(work, "NEXT").embed.description).not.toContain("chan-move");
  });

  it("U/V/W: empty keeps needsUpdate until recorded; signature convergence", async () => {
    const empty = await discordSyncService.listSyncWork(classificationNow);
    const current = scheduleLineFor(empty, "CURRENT");
    expect(current.embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
    expect(current.needsUpdate).toBe(true);

    await discordSyncService.recordSchedulePost({
      bucket: "CURRENT",
      channelId: "marker-current",
      messageId: "sched-msg-current",
      signature: current.desiredSignature,
    });
    await discordSyncService.recordSchedulePost({
      bucket: "NEXT",
      channelId: "marker-next",
      messageId: "sched-msg-next",
      signature: scheduleLineFor(empty, "NEXT").desiredSignature,
    });

    const settled = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(settled, "CURRENT").needsUpdate).toBe(false);
    expect(scheduleLineFor(settled, "CURRENT").existingMessageId).toBe("sched-msg-current");
    expect(scheduleLineFor(settled, "NEXT").needsUpdate).toBe(false);

    // W: adding a Run changes signature → needsUpdate true, same message identity.
    await createRunAt(hoursAfter(currentStart, 16), { status: "OPEN" });
    const changed = await discordSyncService.listSyncWork(classificationNow);
    const item = scheduleLineFor(changed, "CURRENT");
    expect(item.needsUpdate).toBe(true);
    expect(item.existingMessageId).toBe("sched-msg-current");
    expect(item.desiredSignature).not.toBe(current.desiredSignature);
  });

  it("Z: a stale recorded signature (e.g. an older format) refreshes once and converges", async () => {
    const work = await discordSyncService.listSyncWork(classificationNow);
    const current = scheduleLineFor(work, "CURRENT");
    // Persist a stale signature that pretends an older format was recorded.
    await discordSyncService.recordSchedulePost({
      bucket: "CURRENT",
      channelId: "marker-current",
      messageId: "sched-msg-v0",
      signature: "stale-pre-v1-signature-xxxxxxxxxxxxxx",
    });
    await discordSyncService.recordSchedulePost({
      bucket: "NEXT",
      channelId: "marker-next",
      messageId: "sched-msg-next",
      signature: scheduleLineFor(work, "NEXT").desiredSignature,
    });

    const refresh = await discordSyncService.listSyncWork(classificationNow);
    const item = scheduleLineFor(refresh, "CURRENT");
    expect(item.needsUpdate).toBe(true);
    expect(item.existingMessageId).toBe("sched-msg-v0");
    expect(item.desiredSignature).toBe(current.desiredSignature);

    await discordSyncService.recordSchedulePost({
      bucket: "CURRENT",
      channelId: "marker-current",
      messageId: "sched-msg-v0",
      signature: item.desiredSignature,
    });
    const converged = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(converged, "CURRENT").needsUpdate).toBe(false);
  });

  it("app-archived eligible statuses are excluded; non-archived equivalents remain", async () => {
    const statuses = ["OPEN", "ROSTERING", "PUBLISHED", "IN_PROGRESS"] as const;
    for (let i = 0; i < statuses.length; i++) {
      await createRunAt(hoursAfter(currentStart, 20 + i), {
        status: statuses[i],
        archived: true,
      });
      await createRunAt(hoursAfter(currentStart, 30 + i), {
        status: statuses[i],
      });
    }
    const work = await discordSyncService.listSyncWork(classificationNow);
    const desc = scheduleLineFor(work, "CURRENT").embed.description;
    expect(desc).toMatch(/🟢 Open/);
    expect(desc).toMatch(/🟡 Rostering/);
    expect(desc).toMatch(/🔵 Published/);
    expect(desc).toMatch(/🔴 In Progress/);
    // Four non-archived only — archived siblings never appear.
    expect(desc.split("\n")).toHaveLength(4);
  });

  it("setting archivedAt removes a visible CURRENT Run on the next listSyncWork", async () => {
    const id = await createRunAt(hoursAfter(currentStart, 40), {
      status: "OPEN",
    });
    await setRunChannel(id, "chan-then-archive");
    let work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).toContain("<#chan-then-archive>");

    await orm.Run.where({ id }).update({
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).not.toContain("chan-then-archive");
    expect(scheduleLineFor(work, "CURRENT").embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
    // Channel lane may still reconcile the archived Run independently.
    expect(work.channels.some((c) => c.runId === id && c.existingRunChannelId === "chan-then-archive")).toBe(true);
  });
});
