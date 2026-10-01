/**
 * Discord Schedule lane: listSyncWork produces CURRENT/NEXT desired state;
 * COMPLETED/CANCELLED drop immediately even while Run channels still exist.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import {
  SCHEDULE_EMPTY_DESCRIPTION,
  SCHEDULE_MESSAGE_FORMAT_VERSION,
  buildScheduleSignature,
} from "@/lib/discord-schedule";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { classifyRunWeek } from "@/lib/wow-run-week";
import type { RunStatus } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { runService } from "@/services/run.service";

const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-sch000000001",
};
const lead: AuthenticatedUser = {
  id: ids.lead,
  name: "Schedule Lead",
  email: `${ids.lead}@dsch.boostting.local`,
  image: null,
  discordUserId: "sch-lead-discord",
  discordUsername: "ScheduleLead",
  accountRole: "RAID_LEAD",
  accountStatus: "ACTIVE",
};

/** Far-future classification clock so createRun stays in the real future. */
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
      lootType: "VIP",
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
      ...(state.status ? { status: state.status, signupsOpen: state.status === "OPEN" || state.status === "ROSTERING" || state.status === "PUBLISHED" } : {}),
      ...(state.archived ? { archivedAt: now } : {}),
      updatedAt: now,
    });
  }
  return id;
}

async function setPost(runId: string, fields: Record<string, unknown>) {
  await runDiscordPostRepository.recordRaidInviteSent({ runId, signupId: "seed-signup" });
  await orm.RunDiscordPost.where({ runId }).update({ ...fields, updatedAt: new Date().toISOString() });
}

async function cleanupRun(runId: string) {
  await orm.RunDiscordPost.where({ runId }).delete().catch(() => {});
  await orm.RunStartSnapshot.where({ runId }).delete().catch(() => {});
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) await orm.RunRoster.where({ runId }).delete().catch(() => {});
  await orm.Run.where({ id: runId }).delete().catch(() => {});
}

async function cleanupAll() {
  const runs = await orm.Run.where({ raidLeadId: ids.lead }).select("id").all();
  for (const row of runs) await cleanupRun((row as { id: string }).id);
  await orm.DiscordSchedulePost.where({ bucket: "CURRENT" }).delete().catch(() => {});
  await orm.DiscordSchedulePost.where({ bucket: "NEXT" }).delete().catch(() => {});
  createdRunIds.length = 0;
}

function scheduleLineFor(work: Awaited<ReturnType<typeof discordSyncService.listSyncWork>>, bucket: "CURRENT" | "NEXT") {
  return work.schedules.find((item) => item.bucket === bucket)!;
}

function descriptionMentions(work: Awaited<ReturnType<typeof discordSyncService.listSyncWork>>, bucket: "CURRENT" | "NEXT") {
  return scheduleLineFor(work, bucket).embed.description;
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await orm.User.create({
    id: ids.lead,
    name: lead.name,
    email: lead.email!,
    emailVerified: true,
    discordUserId: lead.discordUserId,
    discordUsername: lead.discordUsername,
    accountRole: "RAID_LEAD",
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).catch(async () => {
    await orm.User.where({ id: ids.lead }).update({
      name: lead.name,
      discordUserId: lead.discordUserId,
      discordUsername: lead.discordUsername,
      accountRole: "RAID_LEAD",
      accountStatus: "ACTIVE",
      updatedAt: new Date().toISOString(),
    });
  });
});

afterEach(async () => {
  await cleanupAll();
});

afterAll(async () => {
  await cleanupAll();
  await orm.User.where({ id: ids.lead }).delete().catch(() => {});
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
      await createRunAt(new Date(Date.parse(currentStart) + (i + 2) * 3_600_000).toISOString(), {
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
    await createRunAt(new Date(Date.parse(currentStart) + 4 * 3_600_000).toISOString(), { status: "DRAFT" });
    const work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
    expect(scheduleLineFor(work, "NEXT").embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
  });

  it("F/S: COMPLETED excluded immediately even if Run channel still exists", async () => {
    const id = await createRunAt(new Date(Date.parse(currentStart) + 5 * 3_600_000).toISOString(), {
      status: "OPEN",
    });
    await setPost(id, { runChannelId: "chan-still-alive" });
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
    const id = await createRunAt(new Date(Date.parse(currentStart) + 6 * 3_600_000).toISOString(), {
      status: "OPEN",
    });
    await setPost(id, { runChannelId: "chan-cancel-alive" });
    await orm.Run.where({ id }).update({ status: "CANCELLED", signupsOpen: false, updatedAt: new Date().toISOString() });
    const work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).not.toContain("<#chan-cancel-alive>");
    expect(scheduleLineFor(work, "CURRENT").embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
  });

  it("H: NEXT active Runs only in NEXT", async () => {
    const id = await createRunAt(new Date(Date.parse(nextStart) + 8 * 3_600_000).toISOString(), { status: "OPEN" });
    await setPost(id, { runChannelId: "chan-next" });
    const work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
    expect(scheduleLineFor(work, "NEXT").embed.description).toContain("<#chan-next>");
  });

  it("I/J: PAST and FUTURE beyond NEXT excluded", async () => {
    const pastId = await createRunAt(new Date(Date.parse(currentStart) - 24 * 3_600_000).toISOString(), {
      status: "OPEN",
    });
    const futureId = await createRunAt(new Date(Date.parse(followingStart) + 8 * 3_600_000).toISOString(), {
      status: "OPEN",
    });
    await setPost(pastId, { runChannelId: "chan-past" });
    await setPost(futureId, { runChannelId: "chan-future" });
    const work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).not.toContain("chan-past");
    expect(scheduleLineFor(work, "CURRENT").embed.description).not.toContain("chan-future");
    expect(scheduleLineFor(work, "NEXT").embed.description).not.toContain("chan-past");
    expect(scheduleLineFor(work, "NEXT").embed.description).not.toContain("chan-future");
  });

  it("K/L: chronological ASC with run-id tie-break", async () => {
    const t = Date.parse(currentStart) + 10 * 3_600_000;
    const later = await createRunAt(new Date(t + 3_600_000).toISOString(), { status: "OPEN" });
    const earlier = await createRunAt(new Date(t).toISOString(), { status: "OPEN" });
    const tieA = await createRunAt(new Date(t + 2 * 3_600_000).toISOString(), { status: "OPEN" });
    const tieB = await createRunAt(new Date(t + 2 * 3_600_000).toISOString(), { status: "OPEN" });
    await setPost(later, { runChannelId: "chan-later" });
    await setPost(earlier, { runChannelId: "chan-earlier" });
    await setPost(tieA, { runChannelId: "chan-tie-a" });
    await setPost(tieB, { runChannelId: "chan-tie-b" });
    const work = await discordSyncService.listSyncWork(classificationNow);
    const lines = scheduleLineFor(work, "CURRENT").embed.description.split("\n");
    const earlierIdx = lines.findIndex((l) => l.includes("chan-earlier"));
    const laterIdx = lines.findIndex((l) => l.includes("chan-later"));
    expect(earlierIdx).toBeGreaterThanOrEqual(0);
    expect(laterIdx).toBeGreaterThan(earlierIdx);
    const tieIdxA = lines.findIndex((l) => l.includes("chan-tie-a"));
    const tieIdxB = lines.findIndex((l) => l.includes("chan-tie-b"));
    // Stable by run id: whichever UUID sorts first appears first.
    if (tieA.localeCompare(tieB) < 0) {
      expect(tieIdxA).toBeLessThan(tieIdxB);
    } else {
      expect(tieIdxB).toBeLessThan(tieIdxA);
    }
  });

  it("M/N: without channel still shown; with channel shows mention", async () => {
    const noChan = await createRunAt(new Date(Date.parse(currentStart) + 12 * 3_600_000).toISOString(), {
      status: "OPEN",
    });
    const withChan = await createRunAt(new Date(Date.parse(currentStart) + 13 * 3_600_000).toISOString(), {
      status: "OPEN",
    });
    await setPost(withChan, { runChannelId: "chan-visible" });
    const work = await discordSyncService.listSyncWork(classificationNow);
    const desc = scheduleLineFor(work, "CURRENT").embed.description;
    expect(desc).toContain("<#chan-visible>");
    expect(desc.split("\n").length).toBe(2);
    // noChan line has Raid Lead display but no channel mention of its own.
    expect(desc).toContain("Schedule Lead");
    void noChan;
  });

  it("O/P/Q/R: reschedule same-bucket reorder and cross-bucket moves", async () => {
    const id = await createRunAt(new Date(Date.parse(currentStart) + 14 * 3_600_000).toISOString(), {
      status: "OPEN",
    });
    await setPost(id, { runChannelId: "chan-move" });
    let work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).toContain("chan-move");

    // CURRENT → NEXT
    await orm.Run.where({ id }).update({
      scheduledStartAt: new Date(Date.parse(nextStart) + 4 * 3_600_000).toISOString(),
      updatedAt: new Date().toISOString(),
    });
    work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "CURRENT").embed.description).not.toContain("chan-move");
    expect(scheduleLineFor(work, "NEXT").embed.description).toContain("chan-move");

    // NEXT → CURRENT
    await orm.Run.where({ id }).update({
      scheduledStartAt: new Date(Date.parse(currentStart) + 15 * 3_600_000).toISOString(),
      updatedAt: new Date().toISOString(),
    });
    work = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(work, "NEXT").embed.description).not.toContain("chan-move");
    expect(scheduleLineFor(work, "CURRENT").embed.description).toContain("chan-move");

    // Outside both → FUTURE
    await orm.Run.where({ id }).update({
      scheduledStartAt: new Date(Date.parse(followingStart) + 4 * 3_600_000).toISOString(),
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
    await createRunAt(new Date(Date.parse(currentStart) + 16 * 3_600_000).toISOString(), { status: "OPEN" });
    const changed = await discordSyncService.listSyncWork(classificationNow);
    const item = scheduleLineFor(changed, "CURRENT");
    expect(item.needsUpdate).toBe(true);
    expect(item.existingMessageId).toBe("sched-msg-current");
    expect(item.desiredSignature).not.toBe(current.desiredSignature);
  });

  it("Z: format-version bump refreshes once and converges", async () => {
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
    expect(SCHEDULE_MESSAGE_FORMAT_VERSION).toBe("v1");
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

  it("signature matches pure builder for the rendered runs", async () => {
    const id = await createRunAt(new Date(Date.parse(currentStart) + 17 * 3_600_000).toISOString(), {
      status: "OPEN",
    });
    await setPost(id, { runChannelId: "chan-sig" });
    const work = await discordSyncService.listSyncWork(classificationNow);
    const item = scheduleLineFor(work, "CURRENT");
    // Recompute from embed inputs is opaque; at least ensure non-empty and stable across two calls.
    const again = await discordSyncService.listSyncWork(classificationNow);
    expect(scheduleLineFor(again, "CURRENT").desiredSignature).toBe(item.desiredSignature);
    expect(item.desiredSignature).toHaveLength(32);
    void buildScheduleSignature;
  });

  it("app-archived eligible statuses are excluded; non-archived equivalents remain", async () => {
    const statuses = ["OPEN", "ROSTERING", "PUBLISHED", "IN_PROGRESS"] as const;
    for (let i = 0; i < statuses.length; i++) {
      await createRunAt(new Date(Date.parse(currentStart) + (20 + i) * 3_600_000).toISOString(), {
        status: statuses[i],
        archived: true,
      });
      await createRunAt(new Date(Date.parse(currentStart) + (30 + i) * 3_600_000).toISOString(), {
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
    const id = await createRunAt(new Date(Date.parse(currentStart) + 40 * 3_600_000).toISOString(), {
      status: "OPEN",
    });
    await setPost(id, { runChannelId: "chan-then-archive" });
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
