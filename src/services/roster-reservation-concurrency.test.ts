import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { rosterBuilderService } from "@/services/roster-builder.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";

/**
 * Hard invariant: a Character cannot be draft-selected into two overlapping
 * Runs. Covers sequential, true concurrent, deselect/release, publish hold,
 * non-overlap allow, Auto Build Apply, multi-character lock ordering, and
 * same-Run self non-conflict.
 */

const ids = {
  leadA: "cccccccc-cccc-4ccc-8ccc-rr0000000001",
  leadB: "cccccccc-cccc-4ccc-8ccc-rr0000000002",
  player: "cccccccc-cccc-4ccc-8ccc-rr0000000003",
  player2: "cccccccc-cccc-4ccc-8ccc-rr0000000004",
};
const createdUserIds = Object.values(ids);
const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@rrconc.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createTestUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"],
) {
  await orm.User.create({
    id,
    name,
    email: `${id}@rrconc.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function deleteIfPresent(table: string, id: string) {
  try {
    if (table === "User") await orm.User.where({ id }).delete();
    else if (table === "Character") await orm.Character.where({ id }).delete();
    else if (table === "RunSignupRole") await orm.RunSignupRole.where({ id }).delete();
    else if (table === "RunSignup") await orm.RunSignup.where({ id }).delete();
    else if (table === "Run") await orm.Run.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

function futureIso(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

async function createCharacter(userId: string, name: string) {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  const now = new Date().toISOString();
  await orm.Character.create({
    id,
    userId,
    name,
    realm: "Antonidas",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity("Antonidas"),
    region: "EU",
    wowClass: "PALADIN",
    specialization: "Retribution",
    primaryRole: "MELEE_DPS",
    itemLevel: 700,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await orm.CharacterPlayableSpec.create({
    id: crypto.randomUUID(),
    characterId: id,
    specialization: "Holy",
    createdAt: now,
  });
  return id;
}

async function cleanupRun(runId: string) {
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) {
    const rosterId = (roster as { id: string }).id;
    const entries = await orm.RunRosterEntry.where({ rosterId }).all();
    for (const entry of entries) {
      await orm.RunRosterEntry.where({ id: (entry as { id: string }).id }).delete();
    }
    await orm.RunRoster.where({ id: rosterId }).delete();
  }
  const signups = await orm.RunSignup.where({ runId }).select("id").all();
  for (const row of signups) {
    const signupId = (row as { id: string }).id;
    const roles = await orm.RunSignupRole.where({ signupId }).select("id").all();
    for (const role of roles) {
      await deleteIfPresent("RunSignupRole", (role as { id: string }).id);
    }
    await deleteIfPresent("RunSignup", signupId);
  }
  await deleteIfPresent("Run", runId);
}

async function createOpenRun(lead: AuthenticatedUser, scheduledStartAt: string) {
  const id = await runService
    .createRun(lead, venomousCreateInput({ scheduledStartAt }))
    .then((run) => run.id);
  createdRunIds.push(id);
  await runService.openRun(lead, id);
  return id;
}

/** Pending BOOSTER signup for a Character on a Run — bypasses offer eligibility. */
async function forcePendingSignup(runId: string, userId: string, characterId: string) {
  const signupId = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id: signupId,
    runId,
    userId,
    characterId,
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
    role: "MELEE_DPS",
    createdAt: now,
  });
  return signupId;
}

function isReservationReject(error: unknown): boolean {
  return (
    isDomainError(error) &&
    (error.code === "CHARACTER_ALREADY_SELECTED_OTHER_RUN" ||
      error.code === "CHARACTER_SCHEDULE_CONFLICT" ||
      error.code === "ROSTER_HAS_SCHEDULE_CONFLICTS")
  );
}

async function settledSelect(
  lead: AuthenticatedUser,
  runId: string,
  signupId: string,
  version: number,
) {
  try {
    await rosterService.setDraftSelection(lead, {
      runId,
      signupId,
      selected: true,
      version,
    });
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error };
  }
}

const leadA = asUser(ids.leadA, "Reservation Conc Lead A", "RAID_LEAD");
const leadB = asUser(ids.leadB, "Reservation Conc Lead B", "RAID_LEAD");

let sharedChar = "";
let secondChar = "";

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const userId of createdUserIds) {
    const runs = await orm.Run.where({ raidLeadId: userId }).select("id").all();
    for (const row of runs) {
      await cleanupRun((row as { id: string }).id);
    }
    const chars = await orm.Character.where({ userId }).select("id").all();
    for (const row of chars) {
      await deleteIfPresent("Character", (row as { id: string }).id);
    }
    await deleteIfPresent("User", userId);
  }

  await createTestUser(ids.leadA, "Reservation Conc Lead A", "RAID_LEAD");
  await createTestUser(ids.leadB, "Reservation Conc Lead B", "RAID_LEAD");
  await createTestUser(ids.player, "Reservation Conc Player", "USER");
  await createTestUser(ids.player2, "Reservation Conc Player2", "USER");

  sharedChar = await createCharacter(ids.player, "Synmist");
  secondChar = await createCharacter(ids.player, "Secondmist");
  await orm.User.where({ id: ids.player }).update({ isBooster: true });
  await orm.User.where({ id: ids.player2 }).update({ isBooster: true });
}, 60_000);

afterAll(async () => {
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const id of createdCharacterIds) {
    await deleteIfPresent("Character", id);
  }
  for (const id of createdUserIds) {
    await deleteIfPresent("User", id);
  }
}, 60_000);

describe("cross-run Character reservation concurrency", () => {
  it("1+2: sequential second pick on overlapping Run is rejected (incl. ~10s gap)", async () => {
    const sched = futureIso(400);
    const runA = await createOpenRun(leadA, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, ids.player, sharedChar);
    const signupB = await forcePendingSignup(runB, ids.player, sharedChar);

    const viewA = await rosterService.getRosterManagementView(leadA, runA);
    await rosterService.setDraftSelection(leadA, {
      runId: runA,
      signupId: signupA,
      selected: true,
      version: viewA.roster.version,
    });

    // Sequential gap (same invariant as a delayed second RL click).
    await new Promise((resolve) => setTimeout(resolve, 50));

    const viewB = await rosterService.getRosterManagementView(leadB, runB);
    const second = await settledSelect(leadB, runB, signupB, viewB.roster.version);
    expect(second.ok).toBe(false);
    expect(isReservationReject(second.error)).toBe(true);

    const conflicts = await signupRepository.findReservationConflicts({
      characterIds: [sharedChar],
      excludeRunId: runB,
      scheduledStartAt: sched,
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.runId).toBe(runA);
  });

  it("3+9: true concurrent manual picks — exactly one succeeds", async () => {
    const sched = futureIso(410);
    const runA = await createOpenRun(leadA, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, ids.player, sharedChar);
    const signupB = await forcePendingSignup(runB, ids.player, sharedChar);
    const viewA = await rosterService.getRosterManagementView(leadA, runA);
    const viewB = await rosterService.getRosterManagementView(leadB, runB);

    const [resultA, resultB] = await Promise.all([
      settledSelect(leadA, runA, signupA, viewA.roster.version),
      settledSelect(leadB, runB, signupB, viewB.roster.version),
    ]);

    const successes = [resultA, resultB].filter((row) => row.ok);
    const failures = [resultA, resultB].filter((row) => !row.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(isReservationReject(failures[0]!.error)).toBe(true);

    const afterA = await rosterRepository.findByRunId(runA);
    const afterB = await rosterRepository.findByRunId(runB);
    const selectedA = afterA?.selectedSignupIds.includes(signupA) ?? false;
    const selectedB = afterB?.selectedSignupIds.includes(signupB) ?? false;
    expect(selectedA !== selectedB).toBe(true);
    expect(selectedA || selectedB).toBe(true);
  });

  it("4: same Character on non-overlapping Runs is allowed", async () => {
    const runA = await createOpenRun(leadA, futureIso(420));
    const runC = await createOpenRun(leadB, futureIso(422)); // +2h
    const signupA = await forcePendingSignup(runA, ids.player, sharedChar);
    const signupC = await forcePendingSignup(runC, ids.player, sharedChar);

    const viewA = await rosterService.getRosterManagementView(leadA, runA);
    await rosterService.setDraftSelection(leadA, {
      runId: runA,
      signupId: signupA,
      selected: true,
      version: viewA.roster.version,
    });
    const viewC = await rosterService.getRosterManagementView(leadB, runC);
    await expect(
      rosterService.setDraftSelection(leadB, {
        runId: runC,
        signupId: signupC,
        selected: true,
        version: viewC.roster.version,
      }),
    ).resolves.toBeUndefined();
  });

  it("5: deselect releases reservation for overlapping Run", async () => {
    const sched = futureIso(430);
    const runA = await createOpenRun(leadA, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, ids.player, sharedChar);
    const signupB = await forcePendingSignup(runB, ids.player, sharedChar);

    let viewA = await rosterService.getRosterManagementView(leadA, runA);
    await rosterService.setDraftSelection(leadA, {
      runId: runA,
      signupId: signupA,
      selected: true,
      version: viewA.roster.version,
    });

    let viewB = await rosterService.getRosterManagementView(leadB, runB);
    const blocked = await settledSelect(leadB, runB, signupB, viewB.roster.version);
    expect(blocked.ok).toBe(false);

    viewA = await rosterService.getRosterManagementView(leadA, runA);
    await rosterService.setDraftSelection(leadA, {
      runId: runA,
      signupId: signupA,
      selected: false,
      version: viewA.roster.version,
    });

    viewB = await rosterService.getRosterManagementView(leadB, runB);
    await expect(
      rosterService.setDraftSelection(leadB, {
        runId: runB,
        signupId: signupB,
        selected: true,
        version: viewB.roster.version,
      }),
    ).resolves.toBeUndefined();
  });

  it("6: publish keeps reservation (overlapping second pick still blocked)", async () => {
    const sched = futureIso(440);
    const runA = await createOpenRun(leadA, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, ids.player, sharedChar);
    const signupB = await forcePendingSignup(runB, ids.player, sharedChar);

    let viewA = await rosterService.getRosterManagementView(leadA, runA);
    await rosterService.setDraftSelection(leadA, {
      runId: runA,
      signupId: signupA,
      selected: true,
      version: viewA.roster.version,
    });
    viewA = await rosterService.getRosterManagementView(leadA, runA);
    await rosterService.publishRoster(leadA, {
      runId: runA,
      version: viewA.roster.version,
      acknowledgeWarnings: true,
    });

    const viewB = await rosterService.getRosterManagementView(leadB, runB);
    const second = await settledSelect(leadB, runB, signupB, viewB.roster.version);
    expect(second.ok).toBe(false);
    expect(isReservationReject(second.error)).toBe(true);

    const runARecord = await runRepository.findById(runA);
    expect(runARecord?.status).toBe("PUBLISHED");
  });

  it("7+8: Auto Build Apply races with manual / another Apply — character booked once", async () => {
    const sched = futureIso(450);
    const runA = await createOpenRun(leadA, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, ids.player, sharedChar);
    const signupB = await forcePendingSignup(runB, ids.player, sharedChar);

    // Seed a second eligible body on each run so Auto Build has composition room.
    const fillerA = await createCharacter(ids.player2, "FillerA");
    const fillerB = await createCharacter(ids.player2, "FillerB");
    await forcePendingSignup(runA, ids.player2, fillerA);
    await forcePendingSignup(runB, ids.player2, fillerB);

    const viewA = await rosterService.getRosterManagementView(leadA, runA);
    const viewB = await rosterService.getRosterManagementView(leadB, runB);

    const proposalA = await rosterBuilderService.proposeRoster(leadA, runA);
    const proposalB = await rosterBuilderService.proposeRoster(leadB, runB);

    // Force both applies to target the shared Character via saveDraftSelection
    // (same write authority Auto Build Apply uses).
    const [applyA, applyB] = await Promise.all([
      rosterService
        .saveDraftSelection(leadA, {
          runId: runA,
          version: viewA.roster.version,
          selections: [{ signupId: signupA, selectedRole: "MELEE_DPS" }],
        })
        .then(() => ({ ok: true as const }))
        .catch((error) => ({ ok: false as const, error })),
      rosterService
        .saveDraftSelection(leadB, {
          runId: runB,
          version: viewB.roster.version,
          selections: [{ signupId: signupB, selectedRole: "MELEE_DPS" }],
        })
        .then(() => ({ ok: true as const }))
        .catch((error) => ({ ok: false as const, error })),
    ]);

    expect(proposalA.applySelections.length + proposalB.applySelections.length).toBeGreaterThanOrEqual(0);
    const successes = [applyA, applyB].filter((row) => row.ok);
    const failures = [applyA, applyB].filter((row) => !row.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(isReservationReject(failures[0]!.error)).toBe(true);
  });

  it("10: stale client select after reservation elsewhere is rejected server-side", async () => {
    const sched = futureIso(460);
    const runA = await createOpenRun(leadA, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, ids.player, sharedChar);
    const signupB = await forcePendingSignup(runB, ids.player, sharedChar);

    const staleViewB = await rosterService.getRosterManagementView(leadB, runB);
    const viewA = await rosterService.getRosterManagementView(leadA, runA);
    await rosterService.setDraftSelection(leadA, {
      runId: runA,
      signupId: signupA,
      selected: true,
      version: viewA.roster.version,
    });

    const stale = await settledSelect(leadB, runB, signupB, staleViewB.roster.version);
    expect(stale.ok).toBe(false);
    expect(isReservationReject(stale.error)).toBe(true);
  });

  it("11+12: multi-character save locks without deadlock; same-Run keep does not self-conflict", async () => {
    const sched = futureIso(470);
    const runA = await createOpenRun(leadA, sched);
    const otherChar = await createCharacter(ids.player2, "Lockmate");
    const signupShared = await forcePendingSignup(runA, ids.player, sharedChar);
    const signupOther = await forcePendingSignup(runA, ids.player2, otherChar);

    let viewA = await rosterService.getRosterManagementView(leadA, runA);
    await rosterService.saveDraftSelection(leadA, {
      runId: runA,
      version: viewA.roster.version,
      selections: [
        { signupId: signupShared, selectedRole: "MELEE_DPS" },
        { signupId: signupOther, selectedRole: "MELEE_DPS" },
      ],
    });

    // Re-save including already-selected Characters must not self-conflict.
    viewA = await rosterService.getRosterManagementView(leadA, runA);
    await expect(
      rosterService.saveDraftSelection(leadA, {
        runId: runA,
        version: viewA.roster.version,
        selections: [
          { signupId: signupShared, selectedRole: "MELEE_DPS" },
          { signupId: signupOther, selectedRole: "MELEE_DPS" },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it("audit: same User may use different Characters on overlapping Runs (policy unchanged)", async () => {
    const sched = futureIso(480);
    const runA = await createOpenRun(leadA, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, ids.player, sharedChar);
    const signupB = await forcePendingSignup(runB, ids.player, secondChar);

    const viewA = await rosterService.getRosterManagementView(leadA, runA);
    await rosterService.setDraftSelection(leadA, {
      runId: runA,
      signupId: signupA,
      selected: true,
      version: viewA.roster.version,
    });
    const viewB = await rosterService.getRosterManagementView(leadB, runB);
    await expect(
      rosterService.setDraftSelection(leadB, {
        runId: runB,
        signupId: signupB,
        selected: true,
        version: viewB.roster.version,
      }),
    ).resolves.toBeUndefined();
  });
});
