import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import {
  CROSS_RUN_RESERVATION_MIN_GAP_MS,
  scheduledStartsCollideForReservation,
  signupRepository,
} from "@/repositories/signup.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { venomousCreateInput } from "@/lib/test-run-input";
import { signupService } from "@/services/signup.service";

/**
 * Cross-Run Character reservation: a Character already draft-selected or
 * SELECTED on one Run must not be offerable/selectable/publishable on a
 * different Run whose start is within 2 hours of that reservation. Every
 * fixture Run in this file shares `raidId`/`difficulty`/lootType/plannedBossCount
 * so the desired Discord channel name would collide too if this ever regressed
 * into a naming-based check — the real invariant under test is the start-time
 * gap + reservation source (RunRosterEntry / SELECTED).
 */

const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-cr0000000001",
  target: "aaaaaaaa-aaaa-4aaa-8aaa-cr0000000002",
};
const createdUserIds = Object.values(ids);
const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdQualificationIds: string[] = [];

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"] = "USER"): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@crtest.boostting.local`,
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
    if (error instanceof Error && error.message === `Expected domain error ${code}`) {
      throw error;
    }
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

function rosterBoosters<T extends { id: string }>(view: { boosters: T[] }): T[] {
  return view.boosters;
}

async function createTestUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@crtest.boostting.local`,
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
    else if (table === "BoosterQualification") await orm.BoosterQualification.where({ id }).delete();
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
  await orm.Character.create({
    id,
    userId,
    name,
    realm: "Reservation Lab",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity("Reservation Lab"),
    region: "EU",
    wowClass: "PALADIN",
    specialization: "Retribution",
    primaryRole: "DPS",
    itemLevel: 700,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
    await deleteIfPresent("RunSignup", (row as { id: string }).id);
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

const lead = asUser(ids.lead, "Reservation Lead", "RAID_LEAD");
const target = asUser(ids.target, "Reservation Target", "USER");

let hybrid = "";

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const userId of createdUserIds) {
    const runs = await orm.Run.where({ raidLeadId: userId }).select("id").all();
    for (const row of runs) {
      await cleanupRun((row as { id: string }).id);
    }
    const quals = await orm.BoosterQualification.where({ userId }).select("id").all();
    for (const row of quals) {
      await deleteIfPresent("BoosterQualification", (row as { id: string }).id);
    }
    const chars = await orm.Character.where({ userId }).select("id").all();
    for (const row of chars) {
      await deleteIfPresent("Character", (row as { id: string }).id);
    }
    await deleteIfPresent("User", userId);
  }

  await createTestUser(ids.lead, "Reservation Lead", "RAID_LEAD");
  await createTestUser(ids.target, "Reservation Target", "USER");

  hybrid = await createCharacter(ids.target, "Crhybrid");

  const qualId = crypto.randomUUID();
  createdQualificationIds.push(qualId);
  await orm.BoosterQualification.create({
    id: qualId,
    userId: ids.target,
    difficulty: "HEROIC",
    status: "APPROVED",
    notes: null,
    grantedAt: new Date().toISOString(),
    grantedById: null,
    revokedAt: null,
    revokedById: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}, 60_000);

afterAll(async () => {
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const id of createdQualificationIds) {
    await deleteIfPresent("BoosterQualification", id);
  }
  for (const id of createdCharacterIds) {
    await deleteIfPresent("Character", id);
  }
  for (const id of createdUserIds) {
    await deleteIfPresent("User", id);
  }
}, 60_000);

async function selectIntoRoster(runId: string, characterId: string) {
  const view = await rosterService.getRosterManagementView(lead, runId);
  const all = [...rosterBoosters(view), ...view.groups.lootbuddies];
  const signup = all.find((item) => item.character?.id === characterId);
  if (!signup) throw new Error("signup not found for character");
  await rosterService.setDraftSelection(lead, { runId, signupId: signup.id, selected: true, version: view.roster.version });
  return signup.id;
}

describe("scheduledStartsCollideForReservation", () => {
  const base = "2026-09-20T18:00:00.000Z";
  const baseMs = Date.parse(base);

  it("collides for identical starts and for every gap under 2 hours", () => {
    expect(CROSS_RUN_RESERVATION_MIN_GAP_MS).toBe(2 * 60 * 60 * 1000);
    expect(scheduledStartsCollideForReservation(base, base)).toBe(true);
    expect(scheduledStartsCollideForReservation(baseMs, baseMs + 1)).toBe(true);
    expect(scheduledStartsCollideForReservation(base, "2026-09-20T19:00:00.000Z")).toBe(true);
    expect(
      scheduledStartsCollideForReservation(baseMs, baseMs + CROSS_RUN_RESERVATION_MIN_GAP_MS - 1),
    ).toBe(true);
  });

  it("does not collide at exactly 2 hours or further", () => {
    expect(
      scheduledStartsCollideForReservation(baseMs, baseMs + CROSS_RUN_RESERVATION_MIN_GAP_MS),
    ).toBe(false);
    expect(
      scheduledStartsCollideForReservation(baseMs, baseMs + CROSS_RUN_RESERVATION_MIN_GAP_MS + 1),
    ).toBe(false);
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
    const sched = futureIso(200);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched); // same instant as runA

    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] });
    await selectIntoRoster(runA, hybrid);

    const active = await signupService.setCharacterOffers(target, { runId: runB, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] }).catch((error) => error);
    expect(isDomainError(active) && active.code).toBe("CHARACTER_ALREADY_SELECTED_OTHER_RUN");

    const options = await signupService.getSignupOptions(target, runB);
    expect(options.booster.eligible.some((item) => item.characterId === hybrid)).toBe(false);
    const ineligible = options.booster.ineligible.find((item) => item.characterId === hybrid);
    expect(ineligible?.reason).toBe("ALREADY_SELECTED_OTHER_RUN");
    expect(ineligible?.conflictingRunId).toBe(runA);
  });

  it("B: a Character with RunSignup.status SELECTED elsewhere is unavailable in a colliding Run", async () => {
    const sched = futureIso(210);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] });
    const rows = await signupRepository.listByRunAndUser(runA, ids.target);
    const signupId = rows.find((row) => row.character?.id === hybrid)!.id;
    await orm.RunSignup.where({ id: signupId }).update({ status: "SELECTED" });

    const options = await signupService.getSignupOptions(target, runB);
    const ineligible = options.booster.ineligible.find((item) => item.characterId === hybrid);
    expect(ineligible?.reason).toBe("ALREADY_SELECTED_OTHER_RUN");
    expect(ineligible?.conflictingRunTitle).toBeTruthy();

    await orm.RunSignup.where({ id: signupId }).update({ status: "PENDING" });
    await signupService.setCharacterOffers(target, { runId: runA, offers: [] });
  });

  it("C: draft-selected AND SELECTED on the same Run reports exactly one conflict, never two", async () => {
    const sched = futureIso(220);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] });
    const signupId = await selectIntoRoster(runA, hybrid);
    await orm.RunSignup.where({ id: signupId }).update({ status: "SELECTED" });

    const conflicts = await signupRepository.findReservationConflicts({
      characterIds: [hybrid],
      excludeRunId: runB,
      scheduledStartAt: (await runRepository.findById(runB))!.scheduledStartAt,
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.runId).toBe(runA);
  });

  it("D: starts at least 2 hours apart never conflict", async () => {
    const runA = await createOpenRun(lead, futureIso(230));
    const runC = await createOpenRun(lead, futureIso(232)); // exactly 2 hours later — allowed

    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] });
    await selectIntoRoster(runA, hybrid);

    const options = await signupService.getSignupOptions(target, runC);
    expect(options.booster.eligible.some((item) => item.characterId === hybrid)).toBe(true);
  });

  it("D2: starts less than 2 hours apart collide even when not identical", async () => {
    const runA = await createOpenRun(lead, futureIso(233));
    const runB = await createOpenRun(lead, futureIso(234)); // one hour later — collision window

    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] });
    await selectIntoRoster(runA, hybrid);

    const options = await signupService.getSignupOptions(target, runB);
    const ineligible = options.booster.ineligible.find((item) => item.characterId === hybrid);
    expect(ineligible?.reason).toBe("ALREADY_SELECTED_OTHER_RUN");
    expect(options.booster.eligible.some((item) => item.characterId === hybrid)).toBe(false);
  });

  it("E: the target Run's own existing offer/roster state is never a conflict with itself", async () => {
    const runA = await createOpenRun(lead, futureIso(240));

    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] });
    await selectIntoRoster(runA, hybrid);

    // Re-confirming the exact same desired set on the SAME run must never
    // trip the reservation check against itself.
    await expect(
      signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] }),
    ).resolves.toBeTruthy();

    const options = await signupService.getSignupOptions(target, runA);
    expect(options.booster.eligible.some((item) => item.characterId === hybrid)).toBe(true);
  });

  it("F: a COMPLETED colliding Run never blocks — terminal Runs release their reservation", async () => {
    const sched = futureIso(250);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] });
    await selectIntoRoster(runA, hybrid);
    await runRepository.updateFields(runA, { status: "COMPLETED" });

    const options = await signupService.getSignupOptions(target, runB);
    expect(options.booster.eligible.some((item) => item.characterId === hybrid)).toBe(true);
  });

  it("G: a CANCELLED colliding Run never blocks", async () => {
    const sched = futureIso(260);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] });
    await selectIntoRoster(runA, hybrid);
    await runRepository.updateFields(runA, { status: "CANCELLED" });

    const options = await signupService.getSignupOptions(target, runB);
    expect(options.booster.eligible.some((item) => item.characterId === hybrid)).toBe(true);
  });

  it("role independence: HEALER-reserved elsewhere still blocks a DPS attempt on the colliding Run", async () => {
    const sched = futureIso(270);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: hybrid, offeredRoles: ["HEALER"] }] });
    await selectIntoRoster(runA, hybrid);

    const result = await signupService
      .setCharacterOffers(target, { runId: runB, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] })
      .catch((error) => error);
    expect(isDomainError(result) && result.code).toBe("CHARACTER_ALREADY_SELECTED_OTHER_RUN");
  });

  it("releasing a draft selection immediately frees the Character for a colliding Run", async () => {
    const sched = futureIso(290);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] });
    const signupId = await selectIntoRoster(runA, hybrid);

    let options = await signupService.getSignupOptions(target, runB);
    expect(options.booster.eligible.some((item) => item.characterId === hybrid)).toBe(false);

    const view = await rosterService.getRosterManagementView(lead, runA);
    await rosterService.setDraftSelection(lead, { runId: runA, signupId, selected: false, version: view.roster.version });

    options = await signupService.getSignupOptions(target, runB);
    expect(options.booster.eligible.some((item) => item.characterId === hybrid)).toBe(true);
  });
});

describe("cross-Run Character reservation — write-boundary enforcement", () => {
  it("setCharacterOffers Confirm-time race: a Character reserved elsewhere after eligibility was read is rejected with no partial mutation", async () => {
    const sched = futureIso(300);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    // Simulate the read-then-write race: eligibility looked free, but by the
    // time Confirm runs the Character has been reserved on the colliding Run.
    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] });
    await selectIntoRoster(runA, hybrid);

    const before = await signupRepository.listByRunAndUser(runB, ids.target);
    expect(before.filter((row) => row.status !== "WITHDRAWN")).toHaveLength(0);

    await expectDomainCode(
      signupService.setCharacterOffers(target, { runId: runB, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] }),
      "CHARACTER_ALREADY_SELECTED_OTHER_RUN",
    );

    const after = await signupRepository.listByRunAndUser(runB, ids.target);
    expect(after.filter((row) => row.status !== "WITHDRAWN")).toHaveLength(0);
  });

  it("setDraftSelection rejects selecting a Character already reserved on a colliding Run, leaving the original selection intact", async () => {
    const sched = futureIso(310);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] });
    const signupIdA = await selectIntoRoster(runA, hybrid);

    await signupService.setCharacterOffers(target, { runId: runB, offers: [] }).catch(() => {});
    // Force a PENDING signup directly on runB to exercise setDraftSelection's
    // own reservation guard even when the earlier setCharacterOffers boundary
    // is bypassed (defense in depth at the roster-write boundary itself).
    const bypassSignupId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: bypassSignupId,
      runId: runB,
      userId: ids.target,
      characterId: hybrid,
      participationType: "BOOSTER",
      isBackup: false,
      status: "PENDING",
      lootbuddyMode: null,
      lootbuddyVerification: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await orm.RunSignupRole.create({
      id: crypto.randomUUID(),
      signupId: bypassSignupId,
      role: "DPS",
      createdAt: new Date().toISOString(),
    });

    const viewB = await rosterService.getRosterManagementView(lead, runB);
    await expectDomainCode(
      rosterService.setDraftSelection(lead, { runId: runB, signupId: bypassSignupId, selected: true, version: viewB.roster.version }),
      "CHARACTER_SCHEDULE_CONFLICT",
    );

    // runA's original selection is untouched.
    const viewA = await rosterService.getRosterManagementView(lead, runA);
    const stillSelected = rosterBoosters(viewA).find((item) => item.id === signupIdA)?.draftSelected;
    expect(stillSelected).toBe(true);
  });

  it("saveDraftSelection rejects a whole batch when any booster Character is reserved on a colliding Run", async () => {
    const sched = futureIso(315);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] });
    await selectIntoRoster(runA, hybrid);

    await signupService.setCharacterOffers(target, { runId: runB, offers: [] }).catch(() => {});
    const bypassSignupId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: bypassSignupId,
      runId: runB,
      userId: ids.target,
      characterId: hybrid,
      participationType: "BOOSTER",
      isBackup: false,
      status: "PENDING",
      publishedRole: null,
      lootbuddyMode: null,
      lootbuddyVerification: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await orm.RunSignupRole.create({
      id: crypto.randomUUID(),
      signupId: bypassSignupId,
      role: "DPS",
      createdAt: new Date().toISOString(),
    });

    const viewB = await rosterService.getRosterManagementView(lead, runB);
    await expectDomainCode(
      rosterService.saveDraftSelection(lead, {
        runId: runB,
        version: viewB.roster.version,
        selections: [{ signupId: bypassSignupId, selectedRole: null }],
      }),
      "CHARACTER_SCHEDULE_CONFLICT",
    );
    const after = await rosterService.getRosterManagementView(lead, runB);
    expect(after.roster.version).toBe(viewB.roster.version);
    expect(rosterBoosters(after).find((item) => item.id === bypassSignupId)?.draftSelected).toBe(false);
  });

  it("publishRoster is blocked when a draft-selected Character became reserved on another colliding Run before publish", async () => {
    const sched = futureIso(320);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: hybrid, offeredRoles: ["DPS"] }] });
    await selectIntoRoster(runA, hybrid);

    // Race: after runA's draft selection, the same Character gets reserved
    // (SELECTED) on the colliding runB before runA publishes.
    await signupService.setCharacterOffers(target, { runId: runB, offers: [] }).catch(() => {});
    const bypassId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: bypassId,
      runId: runB,
      userId: ids.target,
      characterId: hybrid,
      participationType: "BOOSTER",
      isBackup: false,
      status: "SELECTED",
      lootbuddyMode: null,
      lootbuddyVerification: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await orm.RunSignupRole.create({
      id: crypto.randomUUID(),
      signupId: bypassId,
      role: "DPS",
      createdAt: new Date().toISOString(),
    });

    const viewA = await rosterService.getRosterManagementView(lead, runA);
    await expectDomainCode(
      rosterService.publishRoster(lead, { runId: runA, version: viewA.roster.version, acknowledgeWarnings: true }),
      "ROSTER_HAS_SCHEDULE_CONFLICTS",
    );

    const runARecord = (await runRepository.findById(runA))!;
    expect(runARecord.status).not.toBe("PUBLISHED");

    const offered = await orm.RunSignupRole.where({ signupId: bypassId }).select("id").all();
    for (const offer of offered) {
      await deleteIfPresent("RunSignupRole", (offer as { id: string }).id);
    }
    await deleteIfPresent("RunSignup", bypassId);
  });
});
