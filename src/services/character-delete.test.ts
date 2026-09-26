import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { getCurrentLockoutRaids } from "@/lib/wow-raid-catalog";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { characterRepository } from "@/repositories/character.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { characterOperationsService } from "@/services/character-operations.service";
import { characterService } from "@/services/character.service";
import { runService } from "@/services/run.service";
import { attendanceRepository } from "@/repositories/attendance.repository";
import { attendanceService } from "@/services/attendance.service";
import { payoutService } from "@/services/payout.service";
import { rosterService } from "@/services/roster.service";
import { runDetailService } from "@/services/run-detail.service";

const token = Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 5).padEnd(5, "x");
const userIds: string[] = [];
const runIds: string[] = [];

function asUser(id: string, accountRole: AuthenticatedUser["accountRole"] = "USER"): AuthenticatedUser {
  return {
    id,
    name: `Del ${accountRole} ${token}`,
    email: `${id}@delete.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createUser(accountRole: AuthenticatedUser["accountRole"]) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name: `Del ${accountRole} ${token}`,
    email: `${id}@delete.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
  userIds.push(id);
  return asUser(id, accountRole);
}

let nameCounter = 0;
async function createCharacter(owner: AuthenticatedUser) {
  nameCounter += 1;
  return characterService.createCharacter(owner, {
    name: `Del${token}${String.fromCharCode(96 + nameCounter)}`,
    realm: "Twisting Nether",
    region: "EU",
    wowClass: "MAGE",
    specialization: "Arcane",
    itemLevel: 600,
  });
}

async function signup(runId: string, userId: string, characterId: string, status: "PENDING" | "WITHDRAWN" | "SELECTED" | "NOT_SELECTED") {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id,
    runId,
    userId,
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
  return id;
}

async function createRun(lead: AuthenticatedUser, status: "OPEN" | "COMPLETED") {
  const created = await runService.createRun(
    lead,
    venomousCreateInput({
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    }),
  );
  runIds.push(created.id);
  // Test-only shortcut to the lifecycle state under test.
  await orm.Run.where({ id: created.id }).update({ status });
  return created.id;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => null).catch((caught) => caught);
  expect(isDomainError(error) && error.code).toBe(code);
}

let owner: AuthenticatedUser;
let other: AuthenticatedUser;
let lead: AuthenticatedUser;
let admin: AuthenticatedUser;
let platformOwner: AuthenticatedUser;

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  owner = await createUser("USER");
  other = await createUser("USER");
  lead = await createUser("RAID_LEAD");
  admin = await createUser("ADMIN");
  // Only one OWNER may exist: reuse it when present (never deleted here), else create one.
  const existingOwner = (await orm.User.where({ accountRole: "OWNER" }).select("id").first()) as { id: string } | null;
  platformOwner = existingOwner ? asUser(existingOwner.id, "OWNER") : await createUser("OWNER");
});

afterAll(async () => {
  for (const runId of runIds) {
    // Payout lines / attendance reference signups with RESTRICT: settlement (cascades lines) first.
    await orm.RunSettlement.where({ runId }).deleteAll();
    await orm.RunAttendance.where({ runId }).deleteAll();
    const roster = (await orm.RunRoster.where({ runId }).first()) as { id: string } | null;
    if (roster) {
      await orm.RunRosterEntry.where({ rosterId: roster.id }).deleteAll();
      await orm.RunRoster.where({ id: roster.id }).delete();
    }
    for (const row of await orm.RunSignup.where({ runId }).select("id").all()) {
      await orm.RunSignupRole.where({ signupId: (row as { id: string }).id }).deleteAll();
      await orm.RunSignup.where({ id: (row as { id: string }).id }).delete();
    }
    await orm.Run.where({ id: runId }).delete();
  }
  for (const userId of userIds) {
    for (const row of await orm.Character.where({ userId }).select("id").all()) {
      await orm.Character.where({ id: (row as { id: string }).id }).delete();
    }
    await orm.BoosterQualification.where({ userId }).deleteAll();
    await orm.UserNotification.where({ userId }).deleteAll();
    for (const row of await orm.ActivityEvent.where({ userId }).select("id").all()) {
      await orm.ActivityEvent.where({ id: (row as { id: string }).id }).delete();
    }
    await orm.User.where({ id: userId }).delete();
  }
});

describe("owner delete", () => {
  it("deletes the owner's character with its lockouts and records an activity event", async () => {
    const character = await createCharacter(owner);
    const raid = getCurrentLockoutRaids()[0]!;
    const now = new Date().toISOString();
    await orm.CharacterRaidLockout.create({
      id: crypto.randomUUID(),
      characterId: character.id,
      raidId: raid.id,
      difficulty: "HEROIC",
      resetIdentifier: getRegionalWeeklyReset("EU").resetIdentifier,
      bossesDefeated: 2,
      isComplete: false,
      createdAt: now,
      updatedAt: now,
    });

    await characterService.deleteCharacter(owner, character.id);

    expect(await characterRepository.findById(character.id)).toBeNull();
    expect(await orm.CharacterRaidLockout.where({ characterId: character.id }).all()).toHaveLength(0);
    const events = (await orm.ActivityEvent.where({ userId: owner.id, type: "CHARACTER_DELETED" }).all()) as unknown[];
    expect(events.length).toBeGreaterThan(0);
  });

  it("FKs: weekly unavailability cascades; the owner's default-Character pointer is cleared, the user stays", async () => {
    const character = await createCharacter(owner);
    const now = new Date().toISOString();
    await orm.CharacterWeeklyUnavailability.create({
      id: crypto.randomUUID(),
      characterId: character.id,
      resetIdentifier: getRegionalWeeklyReset("EU").resetIdentifier,
      difficulty: "HEROIC",
      createdAt: now,
      updatedAt: now,
    });
    await orm.User.where({ id: owner.id }).update({ defaultCharacterId: character.id });

    await characterService.deleteCharacter(owner, character.id);

    expect(await orm.CharacterWeeklyUnavailability.where({ characterId: character.id }).all()).toHaveLength(0);
    const user = (await orm.User.where({ id: owner.id }).first()) as { defaultCharacterId: string | null } | null;
    expect(user).not.toBeNull();
    expect(user!.defaultCharacterId).toBeNull();
  });

  it("never deletes someone else's character", async () => {
    const character = await createCharacter(other);
    await expectCode(characterService.deleteCharacter(owner, character.id), "CHARACTER_NOT_OWNED");
    expect(await characterRepository.findById(character.id)).not.toBeNull();
  });

  it("is refused while an unfinished run has a signup on it; a withdrawn signup does not block", async () => {
    const character = await createCharacter(owner);
    const runId = await createRun(lead, "OPEN");
    const signupId = await signup(runId, owner.id, character.id, "PENDING");

    await expectCode(characterService.deleteCharacter(owner, character.id), "CHARACTER_HAS_OPEN_SIGNUPS");
    expect(await characterRepository.findById(character.id)).not.toBeNull();

    await orm.RunSignup.where({ id: signupId }).update({ status: "WITHDRAWN" });
    await characterService.deleteCharacter(owner, character.id);
    expect(await characterRepository.findById(character.id)).toBeNull();
  });

  it.each(["SELECTED", "NOT_SELECTED"] as const)("an open-run %s signup also blocks (Replace can still pick it)", async (status) => {
    const character = await createCharacter(owner);
    const runId = await createRun(lead, "OPEN");
    await signup(runId, owner.id, character.id, status);
    await expectCode(characterService.deleteCharacter(owner, character.id), "CHARACTER_HAS_OPEN_SIGNUPS");
    expect(await characterRepository.findById(character.id)).not.toBeNull();
  });

  it("keeps finished-run history: the signup stays, its character link is cleared", async () => {
    const character = await createCharacter(owner);
    const runId = await createRun(lead, "COMPLETED");
    const signupId = await signup(runId, owner.id, character.id, "SELECTED");

    await characterService.deleteCharacter(owner, character.id);

    const row = (await orm.RunSignup.where({ id: signupId }).first()) as { characterId: string | null } | null;
    expect(row).not.toBeNull();
    expect(row!.characterId).toBeNull();
  });
});

describe("admin delete", () => {
  it("lets an ADMIN delete any user's character and records the target", async () => {
    const character = await createCharacter(other);
    const result = await characterOperationsService.deleteCharacter(admin, character.id);
    expect(result.label).toContain(character.name);
    expect(await characterRepository.findById(character.id)).toBeNull();
    const events = (await orm.ActivityEvent.where({ userId: admin.id, type: "ADMIN_CHARACTER_DELETED" }).all()) as Array<{
      message: string;
    }>;
    expect(events.some((event) => event.message.includes(`targetCharacterId=${character.id}`))).toBe(true);
  });

  it("applies the same open-signup guard", async () => {
    const character = await createCharacter(other);
    const runId = await createRun(lead, "OPEN");
    await signup(runId, other.id, character.id, "SELECTED");
    await expectCode(characterOperationsService.deleteCharacter(admin, character.id), "CHARACTER_HAS_OPEN_SIGNUPS");
    expect(await characterRepository.findById(character.id)).not.toBeNull();
  });

  it("protects the Platform Owner's characters from ADMINs; the Owner may delete them", async () => {
    const character = await createCharacter(platformOwner);
    await expectCode(characterOperationsService.deleteCharacter(admin, character.id), "OWNER_ROLE_PROTECTED");
    expect(await characterRepository.findById(character.id)).not.toBeNull();
    await characterOperationsService.deleteCharacter(platformOwner, character.id);
    expect(await characterRepository.findById(character.id)).toBeNull();
  });

  it("refuses non-admins", async () => {
    const character = await createCharacter(other);
    const error = await characterOperationsService.deleteCharacter(lead, character.id).catch((caught) => caught);
    expect(isDomainError(error)).toBe(true);
    expect(await characterRepository.findById(character.id)).not.toBeNull();
  });
});

describe("delete after completed-run history (settlement / payout preservation)", () => {
  async function qualify(userId: string) {
    const now = new Date().toISOString();
    await orm.BoosterQualification.create({
      id: crypto.randomUUID(),
      userId,
      difficulty: "HEROIC",
      status: "APPROVED",
      notes: "Delete history test",
      grantedAt: now,
      grantedById: admin.id,
      revokedAt: null,
      revokedById: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Real lifecycle: signup → roster publish → start → attendance → complete → prepare + finalize payout. */
  async function completedRunWithSettlement(booster: AuthenticatedUser, characterId: string) {
    const created = await runService.createRun(
      lead,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        scheduledStartAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
    );
    runIds.push(created.id);
    await runService.openRun(lead, created.id);
    const signupId = crypto.randomUUID();
    const now = new Date().toISOString();
    await orm.RunSignup.create({
      id: signupId,
      runId: created.id,
      userId: booster.id,
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
    await orm.RunSignupRole.create({ id: crypto.randomUUID(), signupId, role: "DPS", createdAt: now });
    const view = await rosterService.getRosterManagementView(lead, created.id);
    await rosterService.setDraftSelection(lead, { runId: created.id, signupId, selected: true, version: view.roster.version });
    const ready = await rosterService.getRosterManagementView(lead, created.id);
    await rosterService.publishRoster(lead, { runId: created.id, version: ready.roster.version, acknowledgeWarnings: true });
    await runService.startRun(lead, { runId: created.id });
    const [attendance] = await attendanceRepository.listByRunId(created.id);
    await attendanceService.setStatus(lead, { attendanceId: attendance!.id, status: "PRESENT" });
    await runService.completeRun(lead, created.id);
    const settlement = await payoutService.prepareSettlement(lead, created.id, { totalGold: 1_000_000, raidLeadCutMode: "SHARE" });
    await payoutService.finalizeSettlement(lead, settlement.id);
    return { runId: created.id, signupId, attendanceId: attendance!.id, settlementId: settlement.id };
  }

  it("deletes the Character but keeps user, signup, attendance, settlement and payout snapshots intact and renderable", async () => {
    const booster = await createUser("USER");
    await qualify(booster.id);
    const character = await createCharacter(booster);
    const history = await completedRunWithSettlement(booster, character.id);

    const payoutBefore = (await orm.RunPayoutEntry.where({ settlementId: history.settlementId }).first()) as Record<string, unknown>;
    expect(payoutBefore.characterId).toBe(character.id);
    expect(Number(payoutBefore.amountGold)).toBeGreaterThan(0);

    await characterService.deleteCharacter(booster, character.id);

    // Character gone, user stays.
    expect(await characterRepository.findById(character.id)).toBeNull();
    expect(await orm.User.where({ id: booster.id }).first()).not.toBeNull();

    // Completed signup + attendance remain; the Character link is cleared.
    const signupRow = (await orm.RunSignup.where({ id: history.signupId }).first()) as Record<string, unknown> | null;
    expect(signupRow).not.toBeNull();
    expect(signupRow!.characterId).toBeNull();
    expect(signupRow!.status).toBe("SELECTED");
    expect(await orm.RunAttendance.where({ id: history.attendanceId }).first()).not.toBeNull();

    // Settlement and payout line remain with snapshots and amounts untouched.
    const settlementRow = (await orm.RunSettlement.where({ id: history.settlementId }).first()) as Record<string, unknown> | null;
    expect(settlementRow?.status).toBe("FINALIZED");
    const payoutAfter = (await orm.RunPayoutEntry.where({ settlementId: history.settlementId }).first()) as Record<string, unknown>;
    expect(payoutAfter.characterId).toBeNull();
    for (const field of ["characterName", "characterRealm", "userDisplayName", "shareUnits", "amountGold", "attendanceStatus", "participationType"]) {
      expect(payoutAfter[field]).toEqual(payoutBefore[field]);
    }

    // Historical projections still render without the Character relation.
    const payoutView = await payoutService.getPayoutView(lead, history.runId);
    expect(payoutView.manager?.status).toBe("FINALIZED");
    expect(payoutView.manager?.entries[0]?.characterName).toBe(character.name);
    expect(payoutView.manager?.entries[0]?.amountGold).toBe(Number(payoutBefore.amountGold));
    const ownView = await payoutService.getPayoutView(booster, history.runId);
    expect(ownView.own[0]?.characterName).toBe(character.name);
    const managerAttendance = await attendanceService.getManagerAttendance(lead, history.runId);
    expect(JSON.stringify(managerAttendance)).toContain(booster.name);
    expect(await attendanceService.getOwnAttendance(booster, history.runId)).toHaveLength(1);
    const detail = await runDetailService.getRunDetail(lead, history.runId);
    expect(detail.run.status).toBe("COMPLETED");
    const boosterDetail = await runDetailService.getRunDetail(booster, history.runId);
    expect(boosterDetail.payout.own[0]?.amountGold).toBe(Number(payoutBefore.amountGold));
  }, 60_000);

  it("relations: availability blocks + WCL data cascade; legacy Booster Access and account qualification stay", async () => {
    const character = await createCharacter(owner);
    const now = new Date().toISOString();
    await orm.CharacterAvailabilityBlock.create({
      id: crypto.randomUUID(),
      characterId: character.id,
      startsAt: now,
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      reason: null,
      createdAt: now,
      updatedAt: now,
    });
    await orm.CharacterWclPerformance.create({
      id: crypto.randomUUID(),
      characterId: character.id,
      zoneId: 1,
      encounterId: 0,
      difficulty: 4,
      metricKey: "dps",
      bestPct: 90,
      avgPct: 80,
      fetchedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const accessId = crypto.randomUUID();
    await orm.BoosterAccess.create({
      id: accessId,
      userId: owner.id,
      characterId: character.id,
      wowClass: "MAGE",
      role: "DPS",
      difficulty: "MYTHIC",
      status: "APPROVED",
      approvedAt: now,
      approvedById: null,
      reviewedAt: null,
      reviewedById: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    });

    await characterService.deleteCharacter(owner, character.id);

    expect(await orm.CharacterAvailabilityBlock.where({ characterId: character.id }).all()).toHaveLength(0);
    expect(await orm.CharacterWclPerformance.where({ characterId: character.id }).all()).toHaveLength(0);
    const access = (await orm.BoosterAccess.where({ id: accessId }).first()) as Record<string, unknown> | null;
    expect(access).not.toBeNull();
    expect(access!.characterId).toBeNull();
    expect(access!.userId).toBe(owner.id);
    await orm.BoosterAccess.where({ id: accessId }).delete();
  });
});
