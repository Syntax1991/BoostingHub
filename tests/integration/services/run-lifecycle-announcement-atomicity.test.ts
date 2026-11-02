import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { venomousCreateInput, venomousUpdateInput } from "@tests/fixtures/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import {
  runCancelledChannelSourceKey,
  runDiscordAnnouncementRepository,
  runRescheduledChannelSourceKey,
} from "@/repositories/run-discord-announcement.repository";
import { runRepository } from "@/repositories/run.repository";
import { runService } from "@/services/run.service";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows } from "@tests/fixtures/db-fixtures";
import { CURRENT_WEEK_RUN_START, DAY_MS, HOUR_MS, RAID_WEEK_TEST_CLOCK, freezeSystemTime, restoreSystemTime } from "@tests/fixtures/time";

/** Announcements cascade with their Run. */
const created = { runIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;

/** Each Run three hours after the previous one, from the frozen week's Saturday. */
function nextStart() {
  return new Date(Date.parse(CURRENT_WEEK_RUN_START) + created.runIds.length * 3 * HOUR_MS).toISOString();
}

/** A reschedule target well clear of every Run's slot. */
const rescheduleTarget = (daysLater: number) => new Date(Date.parse(CURRENT_WEEK_RUN_START) + daysLater * DAY_MS).toISOString();

async function openRun(scheduledStartAt: string) {
  const run = await runService.createRun(
    lead,
    venomousCreateInput({
      scheduledStartAt,
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 1,
    }),
  );
  created.runIds.push(run.id);
  await runService.openRun(lead, run.id);
  return run.id;
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  freezeSystemTime(RAID_WEEK_TEST_CLOCK, { advance: true });
  await raidRepository.ensureReferenceRaids();
  const leadId = await createTestUser({ name: "Atomic Lead", accountRole: "RAID_LEAD" });
  created.userIds.push(leadId);
  lead = testActor(leadId, "RAID_LEAD");
});

afterAll(async () => {
  try {
    await deleteCreatedRows(created);
  } finally {
    restoreSystemTime();
  }
});

/** Reschedule path of the pre-start Run edit: Run fields + RUN_RESCHEDULED in one transaction. */
function updateWithAnnouncement(
  runId: string,
  fields: Parameters<typeof runRepository.updatePreStartAtomic>[1],
  announcement: NonNullable<Parameters<typeof runRepository.updatePreStartAtomic>[2]>["announcement"],
  hooks: Parameters<typeof runRepository.updatePreStartAtomic>[3],
) {
  return runRepository.updatePreStartAtomic(runId, fields, { announcement }, hooks);
}

describe("lifecycle announcement atomicity", () => {
  it("successful cancel persists CANCELLED and RUN_CANCELLED announcement together", async () => {
    const runId = await openRun(nextStart());
    await runService.cancelRun(lead, runId);
    const run = await runRepository.findById(runId);
    expect(run?.status).toBe("CANCELLED");
    expect(run?.cancelRevision).toBe(1);
    expect(run?.cancelledFromStatus).toBe("OPEN");
    expect(run?.cancelledFromSignupsOpen).toBe(true);
    const announcement = await runDiscordAnnouncementRepository.findBySourceKey(
      runCancelledChannelSourceKey(runId, 1),
    );
    expect(announcement?.type).toBe("RUN_CANCELLED");
    expect(announcement?.status).toBe("PENDING");
  });

  it("announcement insert failure during cancel rolls back — Run stays open", async () => {
    const runId = await openRun(nextStart());
    const before = await runRepository.findById(runId);
    expect(before?.status).toBe("OPEN");

    await expect(
      runRepository.cancelWithDiscordAnnouncement(
        runId,
        {
          scheduledStartAt: before!.scheduledStartAt,
          productLabel: "x",
          difficulty: "HEROIC",
          lootType: "UNSAVED",
        },
        { failAnnouncementInsert: true },
      ),
    ).rejects.toThrow();

    const after = await runRepository.findById(runId);
    expect(after?.status).toBe("OPEN");
    expect(after?.signupsOpen).toBe(true);
    expect(await runDiscordAnnouncementRepository.findBySourceKey(runCancelledChannelSourceKey(runId, 1))).toBeNull();
  });

  it("Run mutation failure during cancel creates no announcement", async () => {
    const runId = await openRun(nextStart());
    const before = await runRepository.findById(runId);

    await expect(
      runRepository.cancelWithDiscordAnnouncement(
        runId,
        {
          scheduledStartAt: before!.scheduledStartAt,
          productLabel: "x",
          difficulty: "HEROIC",
          lootType: "UNSAVED",
        },
        { failAfterRunUpdate: true },
      ),
    ).rejects.toThrow(/TEST_HOOK_FAIL_AFTER_RUN_UPDATE/);

    const after = await runRepository.findById(runId);
    expect(after?.status).toBe("OPEN");
    expect(await runDiscordAnnouncementRepository.findBySourceKey(runCancelledChannelSourceKey(runId, 1))).toBeNull();
  });

  it("cancel transactionally rejects when Run is already CANCELLED", async () => {
    const runId = await openRun(nextStart());
    await runService.cancelRun(lead, runId);
    const before = await runRepository.findById(runId);
    expect(before?.status).toBe("CANCELLED");
    expect(before?.cancelRevision).toBe(1);

    await expect(
      runRepository.cancelWithDiscordAnnouncement(runId, {
        scheduledStartAt: before!.scheduledStartAt,
        productLabel: "x",
        difficulty: "HEROIC",
        lootType: "UNSAVED",
      }),
    ).rejects.toThrow(/cannot be cancelled/i);

    const after = await runRepository.findById(runId);
    expect(after?.cancelRevision).toBe(1);
    expect(await runDiscordAnnouncementRepository.findBySourceKey(runCancelledChannelSourceKey(runId, 2))).toBeNull();
  });

  it("successful reschedule persists scheduleRevision and RUN_RESCHEDULED together", async () => {
    const runId = await openRun(nextStart());
    const before = await runRepository.findById(runId);
    const newStart = rescheduleTarget(6);
    await runService.updateRun(lead, venomousUpdateInput(runId, before!, { scheduledStartAt: newStart }));

    const after = await runRepository.findById(runId);
    expect(after?.scheduleRevision).toBe(1);
    expect(Date.parse(after!.scheduledStartAt)).toBe(Date.parse(newStart));
    const announcement = await runDiscordAnnouncementRepository.findBySourceKey(
      runRescheduledChannelSourceKey(runId, 1),
    );
    expect(announcement?.type).toBe("RUN_RESCHEDULED");
    expect(announcement?.previousScheduledStartAt).toBe(before!.scheduledStartAt);
  });

  it("reschedule announcement insert failure rolls back schedule and revision", async () => {
    const runId = await openRun(nextStart());
    const before = await runRepository.findById(runId);
    const newStart = rescheduleTarget(7);

    await expect(
      updateWithAnnouncement(
        runId,
        {
          scheduledStartAt: newStart,
          scheduleRevision: before!.scheduleRevision + 1,
          title: before!.title,
        },
        {
          runId,
          type: "RUN_RESCHEDULED",
          sourceKey: runRescheduledChannelSourceKey(runId, before!.scheduleRevision + 1),
          previousScheduledStartAt: before!.scheduledStartAt,
          scheduledStartAt: newStart,
          productLabel: "x",
          difficulty: "HEROIC",
          lootType: "UNSAVED",
        },
        { failAnnouncementInsert: true },
      ),
    ).rejects.toThrow();

    const after = await runRepository.findById(runId);
    expect(after?.scheduleRevision).toBe(before!.scheduleRevision);
    expect(after?.scheduledStartAt).toBe(before!.scheduledStartAt);
    expect(
      await runDiscordAnnouncementRepository.findBySourceKey(
        runRescheduledChannelSourceKey(runId, before!.scheduleRevision + 1),
      ),
    ).toBeNull();
  });

  it("reschedule Run mutation failure creates no announcement", async () => {
    const runId = await openRun(nextStart());
    const before = await runRepository.findById(runId);
    const newStart = rescheduleTarget(8);

    await expect(
      updateWithAnnouncement(
        runId,
        {
          scheduledStartAt: newStart,
          scheduleRevision: before!.scheduleRevision + 1,
        },
        {
          runId,
          type: "RUN_RESCHEDULED",
          sourceKey: runRescheduledChannelSourceKey(runId, before!.scheduleRevision + 1),
          previousScheduledStartAt: before!.scheduledStartAt,
          scheduledStartAt: newStart,
          productLabel: "x",
          difficulty: "HEROIC",
          lootType: "UNSAVED",
        },
        { failAfterRunUpdate: true },
      ),
    ).rejects.toThrow(/TEST_HOOK_FAIL_AFTER_RUN_UPDATE/);

    const after = await runRepository.findById(runId);
    expect(after?.scheduleRevision).toBe(before!.scheduleRevision);
    expect(after?.scheduledStartAt).toBe(before!.scheduledStartAt);
    expect(
      await runDiscordAnnouncementRepository.findBySourceKey(
        runRescheduledChannelSourceKey(runId, before!.scheduleRevision + 1),
      ),
    ).toBeNull();
  });
});
