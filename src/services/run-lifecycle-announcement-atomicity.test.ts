import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { venomousCreateInput, venomousUpdateInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import {
  runCancelledChannelSourceKey,
  runDiscordAnnouncementRepository,
  runRescheduledChannelSourceKey,
} from "@/repositories/run-discord-announcement.repository";
import { runRepository } from "@/repositories/run.repository";
import { runService } from "@/services/run.service";

const ids = {
  lead: "b5555555-5555-4555-8555-555555555501",
  admin: "b5555555-5555-4555-8555-555555555502",
};

const createdRunIds: string[] = [];
let scheduleSlot = 0;
function futureIso(days = 14) {
  const slot = scheduleSlot++;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000 + slot * 3 * 60 * 60 * 1000).toISOString();
}

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@atomic.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createTestUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@atomic.boostting.local`,
    emailVerified: true,
    discordUserId: null,
    discordUsername: null,
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

async function cleanupAll() {
  for (const runId of createdRunIds.splice(0)) {
    const announcements = await orm.RunDiscordAnnouncement.where({ runId }).select("id").all();
    for (const row of announcements) {
      await orm.RunDiscordAnnouncement.where({ id: (row as { id: string }).id }).delete();
    }
    try {
      await orm.Run.where({ id: runId }).delete();
    } catch {
      // gone
    }
  }
  for (const userId of Object.values(ids)) {
    try {
      await orm.User.where({ id: userId }).delete();
    } catch {
      // gone
    }
  }
}

const lead = asUser(ids.lead, "Atomic Lead", "RAID_LEAD");

async function openRun(scheduledStartAt: string) {
  const created = await runService.createRun(
    lead,
    venomousCreateInput({
      scheduledStartAt,
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 1,
    }),
  );
  createdRunIds.push(created.id);
  await runService.openRun(lead, created.id);
  return created.id;
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanupAll();
  await createTestUser(ids.lead, "Atomic Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "Atomic Admin", "ADMIN");
});

afterAll(async () => {
  await cleanupAll();
});

describe("lifecycle announcement atomicity", () => {
  it("successful cancel persists CANCELLED and RUN_CANCELLED announcement together", async () => {
    const runId = await openRun(futureIso());
    await runService.cancelRun(lead, runId);
    const run = await runRepository.findById(runId);
    expect(run?.status).toBe("CANCELLED");
    const announcement = await runDiscordAnnouncementRepository.findBySourceKey(
      runCancelledChannelSourceKey(runId),
    );
    expect(announcement?.type).toBe("RUN_CANCELLED");
    expect(announcement?.status).toBe("PENDING");
  });

  it("announcement insert failure during cancel rolls back — Run stays open", async () => {
    const runId = await openRun(futureIso());
    const before = await runRepository.findById(runId);
    expect(before?.status).toBe("OPEN");

    await expect(
      runRepository.cancelWithDiscordAnnouncement(
        runId,
        {
          runId,
          type: "RUN_CANCELLED",
          sourceKey: runCancelledChannelSourceKey(runId),
          previousScheduledStartAt: null,
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
    expect(await runDiscordAnnouncementRepository.findBySourceKey(runCancelledChannelSourceKey(runId))).toBeNull();
  });

  it("Run mutation failure during cancel creates no announcement", async () => {
    const runId = await openRun(futureIso());
    const before = await runRepository.findById(runId);

    await expect(
      runRepository.cancelWithDiscordAnnouncement(
        runId,
        {
          runId,
          type: "RUN_CANCELLED",
          sourceKey: runCancelledChannelSourceKey(runId),
          previousScheduledStartAt: null,
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
    expect(await runDiscordAnnouncementRepository.findBySourceKey(runCancelledChannelSourceKey(runId))).toBeNull();
  });

  it("successful reschedule persists scheduleRevision and RUN_RESCHEDULED together", async () => {
    const runId = await openRun(futureIso());
    const before = await runRepository.findById(runId);
    const nextStart = futureIso(20);
    await runService.updateRun(lead, venomousUpdateInput(runId, before!, { scheduledStartAt: nextStart }));

    const after = await runRepository.findById(runId);
    expect(after?.scheduleRevision).toBe(1);
    expect(Date.parse(after!.scheduledStartAt)).toBe(Date.parse(nextStart));
    const announcement = await runDiscordAnnouncementRepository.findBySourceKey(
      runRescheduledChannelSourceKey(runId, 1),
    );
    expect(announcement?.type).toBe("RUN_RESCHEDULED");
    expect(announcement?.previousScheduledStartAt).toBe(before!.scheduledStartAt);
  });

  it("reschedule announcement insert failure rolls back schedule and revision", async () => {
    const runId = await openRun(futureIso());
    const before = await runRepository.findById(runId);
    const nextStart = futureIso(21);

    await expect(
      runRepository.updateFieldsWithDiscordAnnouncement(
        runId,
        {
          scheduledStartAt: nextStart,
          scheduleRevision: before!.scheduleRevision + 1,
          title: before!.title,
        },
        {
          runId,
          type: "RUN_RESCHEDULED",
          sourceKey: runRescheduledChannelSourceKey(runId, before!.scheduleRevision + 1),
          previousScheduledStartAt: before!.scheduledStartAt,
          scheduledStartAt: nextStart,
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
    const runId = await openRun(futureIso());
    const before = await runRepository.findById(runId);
    const nextStart = futureIso(22);

    await expect(
      runRepository.updateFieldsWithDiscordAnnouncement(
        runId,
        {
          scheduledStartAt: nextStart,
          scheduleRevision: before!.scheduleRevision + 1,
        },
        {
          runId,
          type: "RUN_RESCHEDULED",
          sourceKey: runRescheduledChannelSourceKey(runId, before!.scheduleRevision + 1),
          previousScheduledStartAt: before!.scheduledStartAt,
          scheduledStartAt: nextStart,
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
