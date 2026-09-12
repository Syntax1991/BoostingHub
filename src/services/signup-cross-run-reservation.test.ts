import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";

/**
 * Cross-Run Character reservation: a Character already draft-selected or
 * SELECTED on one Run must not be offerable/selectable/publishable on a
 * different Run scheduled at the exact same instant. Every fixture Run in
 * this file shares `raidId`/`difficulty`/lootType/plannedBossCount so the
 * desired Discord channel name would collide too if this ever regressed into
 * a naming-based check — the real invariant under test is purely
 * `scheduledStartAt` + reservation source (RunRosterEntry / SELECTED).
 */

const raidId = WOW_RAID_CATALOG[0].id;
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
    .createRun(lead, {
      raidId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    })
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
  const all = [...view.groups.tanks, ...view.groups.healers, ...view.groups.dps, ...view.groups.lootbuddies];
  const signup = all.find((item) => item.character?.id === characterId);
  if (!signup) throw new Error("signup not found for character");
  await rosterService.setDraftSelection(lead, { runId, signupId: signup.id, selected: true, version: view.roster.version });
  return signup.id;
}

describe("cross-Run Character reservation — signup eligibility", () => {
  it("A: a Character draft-selected (still PENDING) into another Run's roster is unavailable in a colliding Run", async () => {
    const sched = futureIso(200);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched); // same instant as runA

    await signupService.setCharacterOffers(target, { runId: runA, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] });
    await selectIntoRoster(runA, hybrid);

    const active = await signupService.setCharacterOffers(target, { runId: runB, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] }).catch((error) => error);
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

    await signupService.setCharacterOffers(target, { runId: runA, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] });
    const rows = await signupRepository.listByRunAndUser(runA, ids.target);
    const signupId = rows.find((row) => row.character?.id === hybrid)!.id;
    await orm.RunSignup.where({ id: signupId }).update({ status: "SELECTED" });

    const options = await signupService.getSignupOptions(target, runB);
    const ineligible = options.booster.ineligible.find((item) => item.characterId === hybrid);
    expect(ineligible?.reason).toBe("ALREADY_SELECTED_OTHER_RUN");
    expect(ineligible?.conflictingRunTitle).toBeTruthy();

    await orm.RunSignup.where({ id: signupId }).update({ status: "PENDING" });
    await signupService.setCharacterOffers(target, { runId: runA, participationType: "BOOSTER", offers: [] });
  });

  it("C: draft-selected AND SELECTED on the same Run reports exactly one conflict, never two", async () => {
    const sched = futureIso(220);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] });
    const signupId = await selectIntoRoster(runA, hybrid);
    await orm.RunSignup.where({ id: signupId }).update({ status: "SELECTED" });

    const conflicts = await signupRepository.findReservationConflicts({
      characterIds: [hybrid],
      targetRunId: runB,
      scheduledStartAt: (await runRepository.findById(runB))!.scheduledStartAt,
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.runId).toBe(runA);
  });

  it("D: a different scheduledStartAt never conflicts", async () => {
    const runA = await createOpenRun(lead, futureIso(230));
    const runC = await createOpenRun(lead, futureIso(231)); // one hour later — no collision

    await signupService.setCharacterOffers(target, { runId: runA, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] });
    await selectIntoRoster(runA, hybrid);

    const options = await signupService.getSignupOptions(target, runC);
    expect(options.booster.eligible.some((item) => item.characterId === hybrid)).toBe(true);
  });

  it("E: the target Run's own existing offer/roster state is never a conflict with itself", async () => {
    const runA = await createOpenRun(lead, futureIso(240));

    await signupService.setCharacterOffers(target, { runId: runA, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] });
    await selectIntoRoster(runA, hybrid);

    // Re-confirming the exact same desired set on the SAME run must never
    // trip the reservation check against itself.
    await expect(
      signupService.setCharacterOffers(target, { runId: runA, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] }),
    ).resolves.toBeTruthy();

    const options = await signupService.getSignupOptions(target, runA);
    expect(options.booster.eligible.some((item) => item.characterId === hybrid)).toBe(true);
  });

  it("F: a COMPLETED colliding Run never blocks — terminal Runs release their reservation", async () => {
    const sched = futureIso(250);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] });
    await selectIntoRoster(runA, hybrid);
    await runRepository.updateFields(runA, { status: "COMPLETED" });

    const options = await signupService.getSignupOptions(target, runB);
    expect(options.booster.eligible.some((item) => item.characterId === hybrid)).toBe(true);
  });

  it("G: a CANCELLED colliding Run never blocks", async () => {
    const sched = futureIso(260);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] });
    await selectIntoRoster(runA, hybrid);
    await runRepository.updateFields(runA, { status: "CANCELLED" });

    const options = await signupService.getSignupOptions(target, runB);
    expect(options.booster.eligible.some((item) => item.characterId === hybrid)).toBe(true);
  });

  it("role independence: HEALER-reserved elsewhere still blocks a DPS attempt on the colliding Run", async () => {
    const sched = futureIso(270);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "HEALER" }] });
    await selectIntoRoster(runA, hybrid);

    const result = await signupService
      .setCharacterOffers(target, { runId: runB, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] })
      .catch((error) => error);
    expect(isDomainError(result) && result.code).toBe("CHARACTER_ALREADY_SELECTED_OTHER_RUN");
  });

  it("LOOTBUDDY audit: a BOOSTER reservation elsewhere does NOT block a LOOTBUDDY offer for the same Character (deliberately unenforced)", async () => {
    const sched = futureIso(280);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] });
    await selectIntoRoster(runA, hybrid);

    const result = await signupService.setCharacterOffers(target, {
      runId: runB,
      participationType: "LOOTBUDDY",
      offers: [{ characterId: hybrid }],
      lootbuddyMode: "LOOT_ONLY",
      lootbuddyVerification: "NONE",
    });
    expect(result.created + result.reactivated).toBeGreaterThan(0);

    await signupService.setCharacterOffers(target, { runId: runB, participationType: "LOOTBUDDY", offers: [] });
  });

  it("releasing a draft selection immediately frees the Character for a colliding Run", async () => {
    const sched = futureIso(290);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] });
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
    await signupService.setCharacterOffers(target, { runId: runA, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] });
    await selectIntoRoster(runA, hybrid);

    const before = await signupRepository.listByRunAndUser(runB, ids.target);
    expect(before.filter((row) => row.status !== "WITHDRAWN")).toHaveLength(0);

    await expectDomainCode(
      signupService.setCharacterOffers(target, { runId: runB, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] }),
      "CHARACTER_ALREADY_SELECTED_OTHER_RUN",
    );

    const after = await signupRepository.listByRunAndUser(runB, ids.target);
    expect(after.filter((row) => row.status !== "WITHDRAWN")).toHaveLength(0);
  });

  it("setDraftSelection rejects selecting a Character already reserved on a colliding Run, leaving the original selection intact", async () => {
    const sched = futureIso(310);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] });
    const signupIdA = await selectIntoRoster(runA, hybrid);

    await signupService.setCharacterOffers(target, { runId: runB, participationType: "BOOSTER", offers: [] }).catch(() => {});
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
      role: "DPS",
      isBackup: false,
      status: "PENDING",
      lootbuddyMode: null,
      lootbuddyVerification: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const viewB = await rosterService.getRosterManagementView(lead, runB);
    await expectDomainCode(
      rosterService.setDraftSelection(lead, { runId: runB, signupId: bypassSignupId, selected: true, version: viewB.roster.version }),
      "CHARACTER_ALREADY_SELECTED_OTHER_RUN",
    );

    // runA's original selection is untouched.
    const viewA = await rosterService.getRosterManagementView(lead, runA);
    const stillSelected = viewA.groups.dps.find((item) => item.id === signupIdA)?.draftSelected;
    expect(stillSelected).toBe(true);
  });

  it("publishRoster is blocked when a draft-selected Character became reserved on another colliding Run before publish", async () => {
    const sched = futureIso(320);
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(lead, sched);

    await signupService.setCharacterOffers(target, { runId: runA, participationType: "BOOSTER", offers: [{ characterId: hybrid, role: "DPS" }] });
    await selectIntoRoster(runA, hybrid);

    // Race: after runA's draft selection, the same Character gets reserved
    // (SELECTED) on the colliding runB before runA publishes.
    await signupService.setCharacterOffers(target, { runId: runB, participationType: "BOOSTER", offers: [] }).catch(() => {});
    const bypassId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: bypassId,
      runId: runB,
      userId: ids.target,
      characterId: hybrid,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: false,
      status: "SELECTED",
      lootbuddyMode: null,
      lootbuddyVerification: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const viewA = await rosterService.getRosterManagementView(lead, runA);
    await expectDomainCode(
      rosterService.publishRoster(lead, { runId: runA, version: viewA.roster.version, acknowledgeWarnings: true }),
      "CHARACTER_ALREADY_SELECTED_OTHER_RUN",
    );

    const runARecord = (await runRepository.findById(runA))!;
    expect(runARecord.status).not.toBe("PUBLISHED");

    await deleteIfPresent("RunSignup", bypassId);
  });
});
