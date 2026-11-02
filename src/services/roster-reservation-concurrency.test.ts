import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { anyContentRunInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { rosterBuilderService } from "@/services/roster-builder.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase, createTestCharacter, createTestUser, deleteCreatedRows } from "@/test/db-fixtures";
import { HOUR_MS } from "@/test/time";

/**
 * Hard invariant: a Character cannot be draft-selected into two overlapping
 * Runs. Covers sequential, true concurrent, deselect/release, publish hold,
 * non-overlap allow, Auto Build Apply, multi-character lock ordering, and
 * same-Run self non-conflict.
 */
const created = { runIds: [] as string[], characterIds: [] as string[], userIds: [] as string[] };
let leadA: AuthenticatedUser;
let leadB: AuthenticatedUser;
let playerId = "";
let player2Id = "";
let sharedChar = "";
let secondChar = "";

function futureIso(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * HOUR_MS).toISOString();
}

async function createLead(name: string) {
  const id = await createTestUser({ name, accountRole: "RAID_LEAD" });
  created.userIds.push(id);
  return testActor(id, "RAID_LEAD");
}

/** A Retribution Paladin who can also heal, so a Run never refuses the offer for its role. */
async function createCharacter(userId: string, name: string) {
  const id = await createTestCharacter({
    userId,
    name,
    realm: "Antonidas",
    wowClass: "PALADIN",
    specialization: "Retribution",
    primaryRole: "MELEE_DPS",
  });
  created.characterIds.push(id);
  await orm.CharacterPlayableSpec.create({ id: crypto.randomUUID(), characterId: id, specialization: "Holy", createdAt: new Date().toISOString() });
  return id;
}

async function createOpenRun(lead: AuthenticatedUser, scheduledStartAt: string) {
  const { id } = await runService.createRun(lead, anyContentRunInput({ scheduledStartAt }));
  created.runIds.push(id);
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
  await orm.RunSignupRole.create({ id: crypto.randomUUID(), signupId, role: "MELEE_DPS", createdAt: now });
  return signupId;
}

/** Saves the Run's draft as exactly these Melee picks (the Roster editor's Save). */
async function saveDraft(lead: AuthenticatedUser, runId: string, signupIds: string[], version?: number) {
  const current = version ?? (await rosterService.getRosterManagementView(lead, runId)).roster.version;
  await rosterService.saveDraftSelection(lead, {
    runId,
    version: current,
    selections: signupIds.map((signupId) => ({ signupId, selectedRole: "MELEE_DPS" as const })),
  });
}

/** The outcome of a write: "ok", or the DomainError code (anything else is rethrown). */
async function outcome(write: Promise<unknown>): Promise<string> {
  try {
    await write;
    return "ok";
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
}

/** A pick refused because the Character is already selected on an overlapping Run: the pre-check sees the committed pick. */
const SCHEDULE_CONFLICT = "CHARACTER_SCHEDULE_CONFLICT";
/** The same refusal from the check under the Character lock, for a writer that passed the pre-check before the other committed. */
const RESERVED_UNDER_LOCK = "CHARACTER_ALREADY_SELECTED_OTHER_RUN";

/** A race has one winner; the loser is refused by whichever check sees the winner first. */
function expectOneWinner(results: string[]) {
  expect(results.filter((result) => result === "ok")).toHaveLength(1);
  expect([SCHEDULE_CONFLICT, RESERVED_UNDER_LOCK]).toContain(results.find((result) => result !== "ok"));
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  leadA = await createLead("Reservation Conc Lead A");
  leadB = await createLead("Reservation Conc Lead B");
  playerId = await createTestUser({ name: "Reservation Conc Player", isBooster: true });
  player2Id = await createTestUser({ name: "Reservation Conc Player2", isBooster: true });
  created.userIds.push(playerId, player2Id);
  sharedChar = await createCharacter(playerId, "Testmist");
  secondChar = await createCharacter(playerId, "Secondmist");
}, 60_000);

afterAll(async () => {
  await deleteCreatedRows(created);
}, 60_000);

describe("cross-run Character reservation concurrency", () => {
  it("1+2: a sequential second pick on an overlapping Run is rejected", async () => {
    const sched = futureIso(400);
    const runA = await createOpenRun(leadA, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, playerId, sharedChar);
    const signupB = await forcePendingSignup(runB, playerId, sharedChar);

    await saveDraft(leadA, runA, [signupA]);

    expect(await outcome(saveDraft(leadB, runB, [signupB]))).toBe(SCHEDULE_CONFLICT);
    const conflicts = await signupRepository.findReservationConflicts({
      characterIds: [sharedChar],
      excludeRunId: runB,
      scheduledStartAt: sched,
    });
    expect(conflicts.map((conflict) => conflict.runId)).toEqual([runA]);
  });

  it("3+9: true concurrent manual picks — exactly one succeeds", async () => {
    const sched = futureIso(410);
    const runA = await createOpenRun(leadA, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, playerId, sharedChar);
    const signupB = await forcePendingSignup(runB, playerId, sharedChar);

    const results = await Promise.all([outcome(saveDraft(leadA, runA, [signupA])), outcome(saveDraft(leadB, runB, [signupB]))]);

    expectOneWinner(results);
    const selectedA = (await rosterRepository.findByRunId(runA))?.selectedSignupIds.includes(signupA) ?? false;
    const selectedB = (await rosterRepository.findByRunId(runB))?.selectedSignupIds.includes(signupB) ?? false;
    expect([selectedA, selectedB]).toEqual([results[0] === "ok", results[1] === "ok"]);
  });

  it("4: same Character on non-overlapping Runs is allowed", async () => {
    const runA = await createOpenRun(leadA, futureIso(420));
    const runC = await createOpenRun(leadB, futureIso(422)); // +2h
    const signupA = await forcePendingSignup(runA, playerId, sharedChar);
    const signupC = await forcePendingSignup(runC, playerId, sharedChar);

    await saveDraft(leadA, runA, [signupA]);
    expect(await outcome(saveDraft(leadB, runC, [signupC]))).toBe("ok");
  });

  it("5: deselect releases reservation for overlapping Run", async () => {
    const sched = futureIso(430);
    const runA = await createOpenRun(leadA, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, playerId, sharedChar);
    const signupB = await forcePendingSignup(runB, playerId, sharedChar);

    await saveDraft(leadA, runA, [signupA]);
    expect(await outcome(saveDraft(leadB, runB, [signupB]))).toBe(SCHEDULE_CONFLICT);

    await saveDraft(leadA, runA, []);
    expect(await outcome(saveDraft(leadB, runB, [signupB]))).toBe("ok");
  });

  it("6: publish keeps reservation (overlapping second pick still blocked)", async () => {
    const sched = futureIso(440);
    const runA = await createOpenRun(leadA, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, playerId, sharedChar);
    const signupB = await forcePendingSignup(runB, playerId, sharedChar);

    await saveDraft(leadA, runA, [signupA]);
    const viewA = await rosterService.getRosterManagementView(leadA, runA);
    await rosterService.publishRoster(leadA, { runId: runA, version: viewA.roster.version, acknowledgeWarnings: true });
    expect((await runRepository.findById(runA))?.status).toBe("PUBLISHED");

    expect(await outcome(saveDraft(leadB, runB, [signupB]))).toBe(SCHEDULE_CONFLICT);
  });

  it("7+8: Auto Build Apply racing a manual save books the Character once", async () => {
    const sched = futureIso(450);
    const runA = await createOpenRun(leadA, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, playerId, sharedChar);
    const signupB = await forcePendingSignup(runB, playerId, sharedChar);
    const proposalB = await rosterBuilderService.proposeRoster(leadB, runB);
    expect(proposalB.applySelections).toEqual([{ signupId: signupB, selectedRole: "MELEE_DPS" }]);

    const results = await Promise.all([
      outcome(saveDraft(leadA, runA, [signupA])),
      outcome(
        rosterBuilderService.applyRosterProposal(leadB, {
          runId: runB,
          expectedVersion: proposalB.rosterVersion,
          selections: proposalB.applySelections,
        }),
      ),
    ]);

    expectOneWinner(results);
  });

  it("10: stale client select after reservation elsewhere is rejected server-side", async () => {
    const sched = futureIso(460);
    const runA = await createOpenRun(leadA, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, playerId, sharedChar);
    const signupB = await forcePendingSignup(runB, playerId, sharedChar);

    const staleVersionB = (await rosterService.getRosterManagementView(leadB, runB)).roster.version;
    await saveDraft(leadA, runA, [signupA]);

    expect(await outcome(saveDraft(leadB, runB, [signupB], staleVersionB))).toBe(SCHEDULE_CONFLICT);
  });

  it("11+12: multi-character save locks without deadlock; same-Run keep does not self-conflict", async () => {
    const sched = futureIso(470);
    const runA = await createOpenRun(leadA, sched);
    const otherChar = await createCharacter(player2Id, "Lockmate");
    const signupShared = await forcePendingSignup(runA, playerId, sharedChar);
    const signupOther = await forcePendingSignup(runA, player2Id, otherChar);

    await saveDraft(leadA, runA, [signupShared, signupOther]);

    // Re-save including already-selected Characters must not self-conflict.
    expect(await outcome(saveDraft(leadA, runA, [signupShared, signupOther]))).toBe("ok");
  });

  it("audit: same User may use different Characters on overlapping Runs (policy unchanged)", async () => {
    const sched = futureIso(480);
    const runA = await createOpenRun(leadA, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, playerId, sharedChar);
    const signupB = await forcePendingSignup(runB, playerId, secondChar);

    await saveDraft(leadA, runA, [signupA]);
    expect(await outcome(saveDraft(leadB, runB, [signupB]))).toBe("ok");
  });
});
