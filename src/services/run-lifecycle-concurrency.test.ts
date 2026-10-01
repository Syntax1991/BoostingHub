import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { db, orm } from "@/lib/prisma";
import { futureTestIso, venomousCreateInput } from "@/lib/test-run-input";
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

const ids = {
  lead: "cccccccc-cccc-4ccc-8ccc-lc0000000001",
  player: "cccccccc-cccc-4ccc-8ccc-lc0000000002",
};

const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdSignupIds: string[] = [];

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@lc.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
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
    email: `${id}@lc.boostting.local`,
    emailVerified: true,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
    isBooster: accountRole === "USER",
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
  const attendance = await orm.RunAttendance.where({ runId }).select("id").all();
  for (const row of attendance) {
    await orm.RunAttendance.where({ id: asString((row as Record<string, unknown>).id) }).delete();
  }
  try {
    await orm.RunStartSnapshot.where({ runId }).delete();
  } catch {
    // none
  }
  const notes = await orm.UserNotification.where({ runId }).select("id").all();
  for (const row of notes) {
    await orm.UserNotification.where({ id: asString((row as Record<string, unknown>).id) }).delete();
  }
  const announcements = await orm.RunDiscordAnnouncement.where({ runId }).select("id").all();
  for (const row of announcements) {
    await orm.RunDiscordAnnouncement.where({ id: asString((row as Record<string, unknown>).id) }).delete();
  }
  const roster = (await orm.RunRoster.where({ runId }).first()) as Record<string, unknown> | null;
  if (roster) {
    const rosterId = asString(roster.id);
    const entries = await orm.RunRosterEntry.where({ rosterId }).select("id").all();
    for (const entry of entries) {
      await orm.RunRosterEntry.where({ id: asString((entry as Record<string, unknown>).id) }).delete();
    }
    const externals = await orm.RunExternalBooster.where({ rosterId }).select("id").all();
    for (const external of externals) {
      await orm.RunExternalBooster.where({ id: asString((external as Record<string, unknown>).id) }).delete();
    }
    await orm.RunRoster.where({ id: rosterId }).delete();
  }
  const signups = await orm.RunSignup.where({ runId }).select("id").all();
  for (const row of signups) {
    const signupId = asString((row as Record<string, unknown>).id);
    const roles = await orm.RunSignupRole.where({ signupId }).select("id").all();
    for (const role of roles) {
      await orm.RunSignupRole.where({ id: asString((role as Record<string, unknown>).id) }).delete();
    }
    await orm.RunSignup.where({ id: signupId }).delete();
  }
  try {
    await orm.Run.where({ id: runId }).delete();
  } catch {
    // gone
  }
}

const lead = asUser(ids.lead, "LC Lead", "RAID_LEAD");
let playerChar = "";

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const id of Object.values(ids)) {
    try {
      await orm.User.where({ id }).delete();
    } catch {
      // gone
    }
  }
  await createTestUser(ids.lead, "LC Lead", "RAID_LEAD");
  await createTestUser(ids.player, "LC Player", "USER");
  playerChar = crypto.randomUUID();
  createdCharacterIds.push(playerChar);
  await orm.Character.create({
    id: playerChar,
    userId: ids.player,
    name: "LcTank",
    realm: "Concurrency Lab",
    normalizedName: normalizeCharacterIdentity("LcTank"),
    normalizedRealm: normalizeCharacterIdentity("Concurrency Lab"),
    region: "EU",
    wowClass: "WARRIOR",
    specialization: "Protection",
    primaryRole: "TANK",
    itemLevel: 700,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

afterAll(async () => {
  for (const runId of createdRunIds.splice(0)) {
    await cleanupRun(runId);
  }
  for (const id of createdCharacterIds.splice(0)) {
    try {
      await orm.Character.where({ id }).delete();
    } catch {
      // gone
    }
  }
  for (const id of Object.values(ids)) {
    try {
      await orm.User.where({ id }).delete();
    } catch {
      // gone
    }
  }
});

async function createPublishedRunnableRun() {
  const created = await runService.createRun(
    lead,
    venomousCreateInput({
      scheduledStartAt: futureTestIso(12 + createdRunIds.length),
      desiredTankCount: 1,
      desiredHealerCount: 0,
      desiredDpsCount: 0,
      title: `LC race ${createdRunIds.length}`,
    }),
  );
  createdRunIds.push(created.id);
  await runService.openRun(lead, created.id);

  const signupId = crypto.randomUUID();
  createdSignupIds.push(signupId);
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id: signupId,
    runId: created.id,
    userId: ids.player,
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

  const view = await rosterService.getRosterManagementView(lead, created.id);
  await rosterService.saveDraftSelection(lead, {
    runId: created.id,
    version: view.roster.version,
    selections: [{ signupId, selectedRole: "TANK" }],
  });
  const ready = await rosterService.getRosterManagementView(lead, created.id);
  await rosterService.publishRoster(lead, {
    runId: created.id,
    version: ready.roster.version,
    acknowledgeWarnings: true,
  });

  const run = await runRepository.findById(created.id);
  expect(run?.status).toBe("PUBLISHED");
  return created.id;
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
        expect(cancelled.status).toBe("rejected");
        expect(isDomainError((cancelled as PromiseRejectedResult).reason)).toBe(true);
        expect(snapshot).not.toBeNull();
        expect(attendanceCount).toBeGreaterThan(0);
        expect(run.signupsOpen).toBe(false);
      } else {
        expect(run?.status).toBe("CANCELLED");
        expect(cancelled.status).toBe("fulfilled");
        expect(started.status).toBe("rejected");
        expect(isDomainError((started as PromiseRejectedResult).reason)).toBe(true);
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
    await new Promise((resolve) => setTimeout(resolve, 150));
    releaseCancel();
    await cancelTx;

    await expectDomainCode(startPromise, "RUN_NOT_PUBLISHED");
    expect(await runRepository.findById(runId)).toMatchObject({ status: "CANCELLED", cancelRevision: 1 });
    expect(await runStartSnapshotRepository.findByRunId(runId)).toBeNull();
    expect(await attendanceRepository.countByRunId(runId)).toBe(0);
    vi.restoreAllMocks();
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
      const txOrm = ((tx.orm as { public?: typeof orm }).public ?? (tx.orm as unknown as typeof orm)) as typeof orm;
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
        startedById: ids.lead,
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
    await new Promise((resolve) => setTimeout(resolve, 150));
    releaseStart();
    await startHold;

    await expectDomainCode(cancelPromise, "RUN_CANNOT_CANCEL");
    expect(await runRepository.findById(runId)).toMatchObject({ status: "IN_PROGRESS", cancelRevision: 0 });
    expect(await runStartSnapshotRepository.findByRunId(runId)).not.toBeNull();
    expect(await attendanceRepository.countByRunId(runId)).toBeGreaterThan(0);
    vi.restoreAllMocks();
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
      expect(rejected).toHaveLength(1);
      expect(isDomainError((rejected[0] as PromiseRejectedResult).reason)).toBe(true);

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
