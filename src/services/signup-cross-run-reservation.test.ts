import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { anyContentRunInput } from "@/lib/test-run-input";
import type { CharacterRole } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import {
  CROSS_RUN_RESERVATION_MIN_GAP_MS,
  scheduledStartsCollideForReservation,
  signupRepository,
} from "@/repositories/signup.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase, createTestCharacter, createTestUser, deleteCreatedRows } from "@/test/db-fixtures";
import { expectDomainError } from "@/test/domain-error";
import { HOUR_MS } from "@/test/time";

/**
 * Cross-Run Character reservation: a Character already draft-selected or
 * SELECTED on one Run must not be offerable/selectable/publishable on a
 * different Run whose start is within 2 hours of that reservation. Every
 * fixture Run in this file shares `raidId`/`difficulty`/lootType/plannedBossCount
 * so the desired Discord channel name would collide too if this ever regressed
 * into a naming-based check — the real invariant under test is the start-time
 * gap + reservation source (RunRosterEntry / SELECTED).
 *
 * Each test reserves its own Character, so no test inherits another's reservation.
 */
const created = { runIds: [] as string[], characterIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;
let target: AuthenticatedUser;

function futureIso(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * HOUR_MS).toISOString();
}

let characterSeq = 0;
/** A Retribution Paladin who can also heal, owned by the target Booster. */
async function createHybrid() {
  characterSeq += 1;
  const id = await createTestCharacter({
    userId: target.id,
    name: `Crhybrid${String.fromCharCode(96 + characterSeq)}`,
    realm: "Reservation Lab",
    wowClass: "PALADIN",
    specialization: "Retribution",
    primaryRole: "MELEE_DPS",
  });
  created.characterIds.push(id);
  await orm.CharacterPlayableSpec.create({ id: crypto.randomUUID(), characterId: id, specialization: "Holy", createdAt: new Date().toISOString() });
  return id;
}

async function createOpenRun(scheduledStartAt: string) {
  const { id } = await runService.createRun(lead, anyContentRunInput({ scheduledStartAt }));
  created.runIds.push(id);
  await runService.openRun(lead, id);
  return id;
}

async function offer(runId: string, characterId: string, role: CharacterRole = "MELEE_DPS") {
  return signupService.setCharacterOffers(target, { runId, offers: [{ characterId, offeredRoles: [role] }] });
}

/** The Raid Lead saves this Character's offer as the Run's only pick (Roster editor Save). */
async function selectIntoRoster(runId: string, characterId: string, role: CharacterRole = "MELEE_DPS") {
  const view = await rosterService.getRosterManagementView(lead, runId);
  const signup = view.boosters.find((item) => item.character?.id === characterId);
  if (!signup) throw new Error("signup not found for character");
  await rosterService.saveDraftSelection(lead, { runId, version: view.roster.version, selections: [{ signupId: signup.id, selectedRole: role }] });
  return signup.id;
}

/** A PENDING or SELECTED signup written directly, past setCharacterOffers' own reservation check. */
async function forceSignup(runId: string, characterId: string, status: "PENDING" | "SELECTED") {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id,
    runId,
    userId: target.id,
    characterId,
    participationType: "BOOSTER",
    isBackup: false,
    status,
    publishedRole: null,
    lootbuddyMode: null,
    lootbuddyVerification: null,
    createdAt: now,
    updatedAt: now,
  });
  await orm.RunSignupRole.create({ id: crypto.randomUUID(), signupId: id, role: "MELEE_DPS", createdAt: now });
  return id;
}

async function eligibleOn(runId: string, characterId: string) {
  const options = await signupService.getSignupOptions(target, runId);
  return {
    eligible: options.booster.eligible.some((item) => item.characterId === characterId),
    ineligible: options.booster.ineligible.find((item) => item.characterId === characterId),
  };
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  const leadId = await createTestUser({ name: "Reservation Lead", accountRole: "RAID_LEAD" });
  const targetId = await createTestUser({ name: "Reservation Target", isBooster: true });
  created.userIds.push(leadId, targetId);
  lead = testActor(leadId, "RAID_LEAD");
  target = testActor(targetId, "USER");
}, 60_000);

afterAll(async () => {
  await deleteCreatedRows(created);
}, 60_000);

describe("scheduledStartsCollideForReservation", () => {
  const base = "2026-09-20T18:00:00.000Z";
  const baseMs = Date.parse(base);

  it("collides for identical starts and for every gap under 2 hours", () => {
    // The 2-hour window is the product rule; a changed constant must fail here.
    expect(CROSS_RUN_RESERVATION_MIN_GAP_MS).toBe(2 * 60 * 60 * 1000);
    expect(scheduledStartsCollideForReservation(base, base)).toBe(true);
    expect(scheduledStartsCollideForReservation(baseMs, baseMs + 1)).toBe(true);
    expect(scheduledStartsCollideForReservation(base, "2026-09-20T19:00:00.000Z")).toBe(true);
    expect(scheduledStartsCollideForReservation(baseMs, baseMs + CROSS_RUN_RESERVATION_MIN_GAP_MS - 1)).toBe(true);
  });

  it("does not collide at exactly 2 hours or further", () => {
    expect(scheduledStartsCollideForReservation(baseMs, baseMs + CROSS_RUN_RESERVATION_MIN_GAP_MS)).toBe(false);
    expect(scheduledStartsCollideForReservation(baseMs, baseMs + CROSS_RUN_RESERVATION_MIN_GAP_MS + 1)).toBe(false);
    expect(scheduledStartsCollideForReservation(base, "2026-09-21T18:00:00.000Z")).toBe(false);
  });

  it("is symmetric for colliding and non-colliding pairs", () => {
    const near = "2026-09-20T19:30:00.000Z";
    const far = "2026-09-20T20:00:00.000Z";
    expect(scheduledStartsCollideForReservation(base, near)).toBe(true);
    expect(scheduledStartsCollideForReservation(near, base)).toBe(true);
    expect(scheduledStartsCollideForReservation(base, far)).toBe(false);
    expect(scheduledStartsCollideForReservation(far, base)).toBe(false);
  });
});

describe("cross-Run Character reservation — signup eligibility", () => {
  it("A: a Character draft-selected (still PENDING) into another Run's roster is unavailable in a colliding Run", async () => {
    const hybrid = await createHybrid();
    const sched = futureIso(200);
    const runA = await createOpenRun(sched);
    const runB = await createOpenRun(sched); // same instant as runA

    await offer(runA, hybrid);
    await selectIntoRoster(runA, hybrid);

    await expectDomainError(offer(runB, hybrid), "CHARACTER_ALREADY_SELECTED_OTHER_RUN");
    const { eligible, ineligible } = await eligibleOn(runB, hybrid);
    expect(eligible).toBe(false);
    expect(ineligible).toMatchObject({ reason: "ALREADY_SELECTED_OTHER_RUN", conflictingRunId: runA });
  });

  it("B: a Character with RunSignup.status SELECTED elsewhere is unavailable in a colliding Run", async () => {
    const hybrid = await createHybrid();
    const sched = futureIso(210);
    const runA = await createOpenRun(sched);
    const runB = await createOpenRun(sched);
    await forceSignup(runA, hybrid, "SELECTED");

    const { ineligible } = await eligibleOn(runB, hybrid);
    expect(ineligible).toMatchObject({ reason: "ALREADY_SELECTED_OTHER_RUN", conflictingRunId: runA });
    expect(ineligible?.conflictingRunTitle).toBe((await runRepository.findById(runA))!.title);
  });

  it("C: draft-selected AND SELECTED on the same Run reports exactly one conflict, never two", async () => {
    const hybrid = await createHybrid();
    const sched = futureIso(220);
    const runA = await createOpenRun(sched);
    const runB = await createOpenRun(sched);

    await offer(runA, hybrid);
    const signupId = await selectIntoRoster(runA, hybrid);
    await orm.RunSignup.where({ id: signupId }).update({ status: "SELECTED" });

    const conflicts = await signupRepository.findReservationConflicts({
      characterIds: [hybrid],
      excludeRunId: runB,
      scheduledStartAt: (await runRepository.findById(runB))!.scheduledStartAt,
    });
    expect(conflicts.map((conflict) => conflict.runId)).toEqual([runA]);
  });

  it("D: starts at least 2 hours apart never conflict", async () => {
    const hybrid = await createHybrid();
    const runA = await createOpenRun(futureIso(230));
    const runC = await createOpenRun(futureIso(232)); // exactly 2 hours later — allowed

    await offer(runA, hybrid);
    await selectIntoRoster(runA, hybrid);

    expect((await eligibleOn(runC, hybrid)).eligible).toBe(true);
  });

  it("D2: starts less than 2 hours apart collide even when not identical", async () => {
    const hybrid = await createHybrid();
    const runA = await createOpenRun(futureIso(233));
    const runB = await createOpenRun(futureIso(234)); // one hour later — collision window

    await offer(runA, hybrid);
    await selectIntoRoster(runA, hybrid);

    const { eligible, ineligible } = await eligibleOn(runB, hybrid);
    expect(eligible).toBe(false);
    expect(ineligible?.reason).toBe("ALREADY_SELECTED_OTHER_RUN");
  });

  it("E: the target Run's own existing offer/roster state is never a conflict with itself", async () => {
    const hybrid = await createHybrid();
    const runA = await createOpenRun(futureIso(240));

    await offer(runA, hybrid);
    await selectIntoRoster(runA, hybrid);

    // Re-confirming the exact same desired set on the SAME run is a no-op, never a self-conflict.
    await expect(offer(runA, hybrid)).resolves.toMatchObject({ created: 0, reactivated: 0, withdrawn: 0, kept: 1 });
    expect((await eligibleOn(runA, hybrid)).eligible).toBe(true);
  });

  it("F: a COMPLETED colliding Run never blocks — terminal Runs release their reservation", async () => {
    const hybrid = await createHybrid();
    const sched = futureIso(250);
    const runA = await createOpenRun(sched);
    const runB = await createOpenRun(sched);

    await offer(runA, hybrid);
    await selectIntoRoster(runA, hybrid);
    await runRepository.updateFields(runA, { status: "COMPLETED" });

    expect((await eligibleOn(runB, hybrid)).eligible).toBe(true);
  });

  it("G: a CANCELLED colliding Run never blocks", async () => {
    const hybrid = await createHybrid();
    const sched = futureIso(260);
    const runA = await createOpenRun(sched);
    const runB = await createOpenRun(sched);

    await offer(runA, hybrid);
    await selectIntoRoster(runA, hybrid);
    await runRepository.updateFields(runA, { status: "CANCELLED" });

    expect((await eligibleOn(runB, hybrid)).eligible).toBe(true);
  });

  it("role independence: HEALER-reserved elsewhere still blocks a DPS attempt on the colliding Run", async () => {
    const hybrid = await createHybrid();
    const sched = futureIso(270);
    const runA = await createOpenRun(sched);
    const runB = await createOpenRun(sched);

    await offer(runA, hybrid, "HEALER");
    await selectIntoRoster(runA, hybrid, "HEALER");

    await expectDomainError(offer(runB, hybrid), "CHARACTER_ALREADY_SELECTED_OTHER_RUN");
  });

  it("releasing a draft selection immediately frees the Character for a colliding Run", async () => {
    const hybrid = await createHybrid();
    const sched = futureIso(290);
    const runA = await createOpenRun(sched);
    const runB = await createOpenRun(sched);

    await offer(runA, hybrid);
    await selectIntoRoster(runA, hybrid);
    expect((await eligibleOn(runB, hybrid)).eligible).toBe(false);

    const view = await rosterService.getRosterManagementView(lead, runA);
    await rosterService.saveDraftSelection(lead, { runId: runA, version: view.roster.version, selections: [] });

    expect((await eligibleOn(runB, hybrid)).eligible).toBe(true);
  });
});

describe("cross-Run Character reservation — write-boundary enforcement", () => {
  it("setCharacterOffers Confirm-time race: a Character reserved elsewhere after eligibility was read is rejected with no partial mutation", async () => {
    const hybrid = await createHybrid();
    const sched = futureIso(300);
    const runA = await createOpenRun(sched);
    const runB = await createOpenRun(sched);

    // Eligibility looked free, but by Confirm the Character is reserved on the colliding Run.
    await offer(runA, hybrid);
    await selectIntoRoster(runA, hybrid);

    await expectDomainError(offer(runB, hybrid), "CHARACTER_ALREADY_SELECTED_OTHER_RUN");
    const after = await signupRepository.listByRunAndUser(runB, target.id);
    expect(after.filter((row) => row.status !== "WITHDRAWN")).toEqual([]);
  });

  it("saveDraftSelection rejects a whole batch when any booster Character is reserved on a colliding Run, leaving both rosters as they were", async () => {
    const hybrid = await createHybrid();
    const sched = futureIso(315);
    const runA = await createOpenRun(sched);
    const runB = await createOpenRun(sched);

    await offer(runA, hybrid);
    const signupIdA = await selectIntoRoster(runA, hybrid);
    // Defense in depth at the roster-write boundary: the offer check is bypassed.
    const bypassSignupId = await forceSignup(runB, hybrid, "PENDING");

    const viewB = await rosterService.getRosterManagementView(lead, runB);
    await expectDomainError(
      rosterService.saveDraftSelection(lead, {
        runId: runB,
        version: viewB.roster.version,
        selections: [{ signupId: bypassSignupId, selectedRole: "MELEE_DPS" }],
      }),
      "CHARACTER_SCHEDULE_CONFLICT",
    );

    const after = await rosterService.getRosterManagementView(lead, runB);
    expect(after.roster.version).toBe(viewB.roster.version);
    expect(after.boosters.find((item) => item.id === bypassSignupId)?.draftSelected).toBe(false);
    const viewA = await rosterService.getRosterManagementView(lead, runA);
    expect(viewA.boosters.find((item) => item.id === signupIdA)?.draftSelected).toBe(true);
  });

  it("publishRoster is blocked when a draft-selected Character became reserved on another colliding Run before publish", async () => {
    const hybrid = await createHybrid();
    const sched = futureIso(320);
    const runA = await createOpenRun(sched);
    const runB = await createOpenRun(sched);

    await offer(runA, hybrid);
    await selectIntoRoster(runA, hybrid);
    // Race: after runA's draft selection, the same Character becomes SELECTED on the colliding runB.
    await forceSignup(runB, hybrid, "SELECTED");

    const viewA = await rosterService.getRosterManagementView(lead, runA);
    await expectDomainError(
      rosterService.publishRoster(lead, { runId: runA, version: viewA.roster.version, acknowledgeWarnings: true }),
      "ROSTER_HAS_SCHEDULE_CONFLICTS",
    );
    expect((await runRepository.findById(runA))!.status).not.toBe("PUBLISHED");
  });
});
