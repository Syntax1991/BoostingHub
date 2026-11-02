import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { db, orm } from "@/lib/prisma";
import { anyContentRunInput, futureTestIso } from "@/lib/test-run-input";
import { asString } from "@/lib/persistence";
import { raidRepository } from "@/repositories/raid.repository";
import {
  runCancelledChannelSourceKey,
  runDiscordAnnouncementRepository,
  runReactivatedChannelSourceKey,
} from "@/repositories/run-discord-announcement.repository";
import { lockRosterInTx, rosterRepository } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { runStartSnapshotRepository } from "@/repositories/run-start-snapshot.repository";
import { attendanceRepository } from "@/repositories/attendance.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { testActor } from "@/test/actors";
import {
  assertIsolatedTestDatabase,
  createTestCharacter,
  createTestUser,
  deleteCreatedRows,
  waitForLockWaiter,
} from "@/test/db-fixtures";
import { expectDomainError } from "@/test/domain-error";

const created = { runIds: [] as string[], characterIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;
let playerId = "";
let playerChar = "";

/** The losing side of a Start/Cancel race, whichever way it goes. */
function rejectionCode(result: PromiseSettledResult<unknown>): unknown {
  if (result.status !== "rejected") return "fulfilled";
  return isDomainError(result.reason) ? result.reason.code : result.reason;
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  const leadId = await createTestUser({ name: "LC Lead", accountRole: "RAID_LEAD" });
  playerId = await createTestUser({ name: "LC Player", isBooster: true });
  created.userIds.push(leadId, playerId);
  lead = testActor(leadId, "RAID_LEAD");
  playerChar = await createTestCharacter({
    userId: playerId,
    name: "LcTank",
    realm: "Concurrency Lab",
    wowClass: "WARRIOR",
    specialization: "Protection",
    primaryRole: "TANK",
  });
  created.characterIds.push(playerChar);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  assertIsolatedTestDatabase();
  // Attendance references roster entries with RESTRICT, so it goes before its Run.
  for (const runId of created.runIds) await orm.RunAttendance.where({ runId }).deleteAndCount();
  await deleteCreatedRows(created);
});

async function createPublishedRunnableRun() {
  const run = await runService.createRun(
    lead,
    anyContentRunInput({
      scheduledStartAt: futureTestIso(12 + created.runIds.length),
      desiredTankCount: 1,
      desiredHealerCount: 0,
      desiredDpsCount: 0,
      title: `LC race ${created.runIds.length}`,
    }),
  );
  created.runIds.push(run.id);
  await runService.openRun(lead, run.id);

  const signupId = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id: signupId,
    runId: run.id,
    userId: playerId,
    characterId: playerChar,
    participationType: "BOOSTER",
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    lootbuddyMode: null,
    lootbuddyVerification: null,
    createdAt: now,
    updatedAt: now,
  });
  await orm.RunSignupRole.create({
    id: crypto.randomUUID(),
    signupId,
    role: "TANK",
    createdAt: now,
  });

  const view = await rosterService.getRosterManagementView(lead, run.id);
  await rosterService.saveDraftSelection(lead, {
    runId: run.id,
    version: view.roster.version,
    selections: [{ signupId, selectedRole: "TANK" }],
  });
  const ready = await rosterService.getRosterManagementView(lead, run.id);
  await rosterService.publishRoster(lead, {
    runId: run.id,
    version: ready.roster.version,
    acknowledgeWarnings: true,
  });

  expect((await runRepository.findById(run.id))?.status).toBe("PUBLISHED");
  return run.id;
}

describe("lifecycle concurrency — Start vs Cancel", () => {
  it("real concurrent race: exactly one lifecycle operation succeeds; never CANCELLED with start evidence", async () => {
    for (let round = 0; round < 5; round += 1) {
      const runId = await createPublishedRunnableRun();
      const [started, cancelled] = await Promise.allSettled([
        runService.startRun(lead, { runId }),
        runService.cancelRun(lead, runId),
      ]);

      const successes = [started, cancelled].filter((result) => result.status === "fulfilled");
      expect(successes).toHaveLength(1);

      const run = await runRepository.findById(runId);
      const snapshot = await runStartSnapshotRepository.findByRunId(runId);
      const attendanceCount = await attendanceRepository.countByRunId(runId);

      if (run?.status === "IN_PROGRESS") {
        expect(started.status).toBe("fulfilled");
        expect(rejectionCode(cancelled)).toBe("RUN_CANNOT_CANCEL");
        expect(snapshot).not.toBeNull();
        expect(attendanceCount).toBeGreaterThan(0);
        expect(run.signupsOpen).toBe(false);
      } else {
        expect(run?.status).toBe("CANCELLED");
        expect(cancelled.status).toBe("fulfilled");
        expect(rejectionCode(started)).toBe("RUN_NOT_PUBLISHED");
        expect(snapshot).toBeNull();
        expect(attendanceCount).toBe(0);
      }
    }
  });

  it("deterministic: Cancel holds RunRoster lock first → Start fails RUN_NOT_PUBLISHED", async () => {
    const runId = await createPublishedRunnableRun();
    const roster = await rosterRepository.findByRunId(runId);
    expect(roster).toBeTruthy();

    let releaseCancel!: () => void;
    const cancelMayCommit = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    let signalLocked!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });

    const cancelTx = runRepository.cancelWithDiscordAnnouncement(
      runId,
      {
        scheduledStartAt: (await runRepository.findById(runId))!.scheduledStartAt,
        productLabel: "LC",
        difficulty: "HEROIC",
        lootType: "UNSAVED",
      },
      {
        afterRosterLocked: async () => {
          signalLocked();
          await cancelMayCommit;
        },
      },
    );
    await lockHeld;

    const originalStart = attendanceRepository.startRunWithAttendance.bind(attendanceRepository);
    let reachedStartWrite!: () => void;
    const startQueued = new Promise<void>((resolve) => {
      reachedStartWrite = resolve;
    });
    vi.spyOn(attendanceRepository, "startRunWithAttendance").mockImplementation(async (...args) => {
      reachedStartWrite();
      return originalStart(...args);
    });

    const startPromise = runService.startRun(lead, { runId });
    await startQueued;
    try {
      await waitForLockWaiter();
    } finally {
      releaseCancel();
    }
    await cancelTx;

    await expectDomainError(startPromise, "RUN_NOT_PUBLISHED");
    expect(await runRepository.findById(runId)).toMatchObject({ status: "CANCELLED", cancelRevision: 1 });
    expect(await runStartSnapshotRepository.findByRunId(runId)).toBeNull();
    expect(await attendanceRepository.countByRunId(runId)).toBe(0);
  });

  it("deterministic: Start commits under RunRoster lock first → Cancel fails RUN_CANNOT_CANCEL", async () => {
    const runId = await createPublishedRunnableRun();
    const roster = await rosterRepository.findByRunId(runId);
    expect(roster).toBeTruthy();

    let releaseStart!: () => void;
    const startMayCommit = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    let signalLocked!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });

    const startHold = db.transaction(async (tx) => {
      const txOrm = tx.orm.public;
      await lockRosterInTx(txOrm, roster!.id);
      signalLocked();
      await startMayCommit;
      const now = new Date().toISOString();
      const signup = (await txOrm.RunSignup.where({ runId, status: "SELECTED" }).first()) as Record<
        string,
        unknown
      > | null;
      expect(signup).toBeTruthy();
      let entry = (await txOrm.RunRosterEntry.where({
        rosterId: roster!.id,
        signupId: asString(signup!.id),
      }).first()) as Record<string, unknown> | null;
      if (!entry) {
        const entryId = crypto.randomUUID();
        await txOrm.RunRosterEntry.create({
          id: entryId,
          rosterId: roster!.id,
          signupId: asString(signup!.id),
          selected: true,
          selectedRole: "TANK",
          createdAt: now,
          updatedAt: now,
        });
        entry = { id: entryId };
      }
      await txOrm.RunAttendance.create({
        id: crypto.randomUUID(),
        runId,
        rosterEntryId: asString(entry.id),
        status: "UNMARKED",
        createdAt: now,
        updatedAt: now,
      });
      await txOrm.RunStartSnapshot.create({
        id: crypto.randomUUID(),
        runId,
        startedAt: now,
        startedById: lead.id,
        createdAt: now,
        updatedAt: now,
      });
      await txOrm.Run.where({ id: runId }).update({
        status: "IN_PROGRESS",
        signupsOpen: false,
        updatedAt: now,
      });
    });
    await lockHeld;

    const originalCancel = runRepository.cancelWithDiscordAnnouncement.bind(runRepository);
    let reachedCancelWrite!: () => void;
    const cancelQueued = new Promise<void>((resolve) => {
      reachedCancelWrite = resolve;
    });
    vi.spyOn(runRepository, "cancelWithDiscordAnnouncement").mockImplementation((...args) => {
      reachedCancelWrite();
      return originalCancel(...args);
    });

    const cancelPromise = runService.cancelRun(lead, runId);
    await cancelQueued;
    try {
      await waitForLockWaiter();
    } finally {
      releaseStart();
    }
    await startHold;

    await expectDomainError(cancelPromise, "RUN_CANNOT_CANCEL");
    expect(await runRepository.findById(runId)).toMatchObject({ status: "IN_PROGRESS", cancelRevision: 0 });
    expect(await runStartSnapshotRepository.findByRunId(runId)).not.toBeNull();
    expect(await attendanceRepository.countByRunId(runId)).toBeGreaterThan(0);
  });
});

describe("lifecycle concurrency — double Cancel", () => {
  it("real concurrent double Cancel: one success, cancelRevision=1, single RUN_CANCELLED rev1", async () => {
    for (let round = 0; round < 5; round += 1) {
      const runId = await createPublishedRunnableRun();
      const results = await Promise.allSettled([
        runService.cancelRun(lead, runId),
        runService.cancelRun(lead, runId),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected.map(rejectionCode)).toEqual(["RUN_CANNOT_CANCEL"]);

      expect(await runRepository.findById(runId)).toMatchObject({
        status: "CANCELLED",
        cancelRevision: 1,
      });
      expect(
        await runDiscordAnnouncementRepository.findBySourceKey(runCancelledChannelSourceKey(runId, 1)),
      ).toMatchObject({ status: "PENDING" });
      expect(
        await runDiscordAnnouncementRepository.findBySourceKey(runCancelledChannelSourceKey(runId, 2)),
      ).toBeNull();
    }
  });
});

describe("lifecycle concurrency — Reactivate ABA", () => {
  it("stale expectedCancelRevision=1 against CANCELLED rev2 is blocked; rev2 Reactivate succeeds", async () => {
    const runId = await createPublishedRunnableRun();
    await runService.cancelRun(lead, runId);
    expect(await runRepository.findById(runId)).toMatchObject({
      status: "CANCELLED",
      cancelRevision: 1,
      cancelledFromStatus: "PUBLISHED",
    });

    // Capture stale rev1 intent, then advance the cycle.
    const staleExpectedRevision = 1;
    await runService.reactivateRun(lead, runId);
    await runService.cancelRun(lead, runId);
    const afterRev2 = await runRepository.findById(runId);
    expect(afterRev2).toMatchObject({
      status: "CANCELLED",
      cancelRevision: 2,
      cancelledFromStatus: "PUBLISHED",
    });

    await expect(
      runRepository.reactivateWithDiscordAnnouncement(runId, staleExpectedRevision, {
        scheduledStartAt: afterRev2!.scheduledStartAt,
        productLabel: "stale",
        difficulty: "HEROIC",
        lootType: "UNSAVED",
      }),
    ).rejects.toMatchObject({ code: "RUN_CANNOT_REACTIVATE" });

    expect(await runRepository.findById(runId)).toMatchObject({
      status: "CANCELLED",
      cancelRevision: 2,
      cancelledFromStatus: "PUBLISHED",
    });
    expect(
      await runDiscordAnnouncementRepository.findBySourceKey(runReactivatedChannelSourceKey(runId, 1)),
    ).toMatchObject({ status: "SKIPPED" });
    expect(
      await runDiscordAnnouncementRepository.findBySourceKey(runReactivatedChannelSourceKey(runId, 2)),
    ).toBeNull();

    await runService.reactivateRun(lead, runId);
    expect(await runRepository.findById(runId)).toMatchObject({
      status: "PUBLISHED",
      cancelRevision: 2,
      cancelledFromStatus: null,
    });
    expect(
      await runDiscordAnnouncementRepository.findBySourceKey(runReactivatedChannelSourceKey(runId, 2)),
    ).toMatchObject({ status: "PENDING" });
  });
});
