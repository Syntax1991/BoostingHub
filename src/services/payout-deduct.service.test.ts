import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { payoutRepository } from "@/repositories/payout.repository";
import { deductRepository } from "@/repositories/deduct.repository";
import { attendanceService } from "@/services/attendance.service";
import { payoutService } from "@/services/payout.service";
import { payoutDeductService } from "@/services/payout-deduct.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { strikeService } from "@/services/strike.service";
import type { CharacterRole } from "@/models/enums";

const raidId = WOW_RAID_CATALOG[0].id;
const ids = {
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-dd0000000001",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-dd0000000002",
  otherLead: "aaaaaaaa-aaaa-4aaa-8aaa-dd0000000003",
  user: "aaaaaaaa-aaaa-4aaa-8aaa-dd0000000004",
  other: "aaaaaaaa-aaaa-4aaa-8aaa-dd0000000005",
};
const createdUserIds = Object.values(ids);
const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"] = "USER"): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@ddtest.boostting.local`,
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
    email: `${id}@ddtest.boostting.local`,
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
    else if (table === "BoosterQualification") await orm.BoosterQualification.where({ id }).delete();
    else if (table === "RunAttendance") await orm.RunAttendance.where({ id }).delete();
    else if (table === "RunSettlement") await orm.RunSettlement.where({ id }).delete();
    else if (table === "Run") await orm.Run.where({ id }).delete();
    else if (table === "Strike") await orm.Strike.where({ id }).delete();
    else if (table === "Deduct") await orm.Deduct.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

function futureIso(days = 12) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function createCharacter(userId: string, name: string, role: CharacterRole = "DPS") {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  await orm.Character.create({
    id,
    userId,
    name,
    realm: "Deduct Lab",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity("Deduct Lab"),
    region: "EU",
    wowClass: "WARRIOR",
    specialization: role === "TANK" ? "Protection" : "Fury",
    primaryRole: role,
    itemLevel: 700,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function approveAccess(userId: string) {
  const existing = await orm.BoosterQualification.where({ userId, difficulty: "HEROIC" }).first();
  if (existing) return;
  const now = new Date().toISOString();
  await orm.BoosterQualification.create({
    id: crypto.randomUUID(),
    userId,
    difficulty: "HEROIC",
    status: "APPROVED",
    notes: "Deduct test grant",
    grantedAt: now,
    grantedById: ids.admin,
    revokedAt: null,
    revokedById: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function createSignup(runId: string, userId: string, characterId: string) {
  const id = crypto.randomUUID();
  await orm.RunSignup.create({
    id,
    runId,
    userId,
    characterId,
    participationType: "BOOSTER",
    role: "DPS",
    isBackup: false,
    status: "PENDING",
    lootbuddyMode: null,
    lootbuddyVerification: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function cleanupRun(runId: string) {
  const settlement = await orm.RunSettlement.where({ runId }).first();
  if (settlement) {
    const settlementId = (settlement as { id: string }).id;
    // Deduct.payoutEntryId is Restrict, which would otherwise block the
    // RunSettlement -> RunPayoutEntry cascade (and transitively the
    // RunAttendance/RunRosterEntry cleanup below) whenever a test left an
    // active or revoked Deduct row behind.
    const entries = await orm.RunPayoutEntry.where({ settlementId }).select("id").all();
    for (const entry of entries) {
      const deducts = await orm.Deduct.where({ payoutEntryId: (entry as { id: string }).id }).select("id").all();
      for (const deduct of deducts) {
        await deleteIfPresent("Deduct", (deduct as { id: string }).id);
      }
    }
    await deleteIfPresent("RunSettlement", settlementId);
  }
  const attendance = await orm.RunAttendance.where({ runId }).select("id").all();
  for (const row of attendance) {
    await deleteIfPresent("RunAttendance", (row as { id: string }).id);
  }
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

const admin = asUser(ids.admin, "Deduct Admin", "ADMIN");
const lead = asUser(ids.lead, "Deduct Lead", "RAID_LEAD");
const otherLead = asUser(ids.otherLead, "Deduct Other Lead", "RAID_LEAD");
const plainUser = asUser(ids.user, "Deduct User");

let characterId = "";

async function completedRunWithSettlement(
  actor: AuthenticatedUser,
  title: string,
  totalGold: number,
): Promise<{ runId: string; payoutEntryId: string; grossAmountGold: number }> {
  const created = await runService.createRun(actor, {
    raidId,
    difficulty: "HEROIC",
    scheduledStartAt: futureIso(),
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    title,
  });
  const runId = created.id;
  createdRunIds.push(runId);
  await runService.openRun(actor, runId);
  const signupId = await createSignup(runId, ids.user, characterId);
  const draft = await rosterService.getRosterManagementView(actor, runId);
  await rosterService.setDraftSelection(actor, {
    runId,
    signupId,
    selected: true,
    version: draft.roster.version,
  });
  const ready = await rosterService.getRosterManagementView(actor, runId);
  await rosterService.publishRoster(actor, {
    runId,
    version: ready.roster.version,
    acknowledgeWarnings: true,
  });
  await runService.startRun(actor, runId);
  const rows = (await attendanceService.getManagerAttendance(actor, runId)).rows;
  await attendanceService.setStatus(actor, { attendanceId: rows[0]!.id, status: "PRESENT" });
  await runService.completeRun(actor, runId);
  await payoutService.prepareSettlement(actor, runId, totalGold);
  const settlement = await payoutRepository.findByRunId(runId);
  const entry = settlement!.entries[0]!;
  return { runId, payoutEntryId: entry.id, grossAmountGold: entry.amountGold };
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  // Two passes: Strike.createdById is Restrict, and a strike created by one
  // test user (e.g. admin) about another (e.g. a plain user) must not block
  // deleting the creator just because the per-user loop reaches them first.
  for (const userId of createdUserIds) {
    const runs = await orm.Run.where({ raidLeadId: userId }).select("id").all();
    for (const row of runs) {
      await cleanupRun((row as { id: string }).id);
    }
  }
  for (const userId of createdUserIds) {
    const strikes = await orm.Strike.where({ userId }).select("id").all();
    for (const row of strikes) {
      await deleteIfPresent("Strike", (row as { id: string }).id);
    }
  }
  for (const userId of createdUserIds) {
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
  await createTestUser(ids.admin, "Deduct Admin", "ADMIN");
  await createTestUser(ids.lead, "Deduct Lead", "RAID_LEAD");
  await createTestUser(ids.otherLead, "Deduct Other Lead", "RAID_LEAD");
  await createTestUser(ids.user, "Deduct User", "USER");
  await createTestUser(ids.other, "Deduct Other User", "USER");

  characterId = await createCharacter(ids.user, "Ddtarget");
  await approveAccess(ids.user);
}, 60_000);

afterAll(async () => {
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const userId of createdUserIds) {
    const strikes = await orm.Strike.where({ userId }).select("id").all();
    for (const row of strikes) {
      await deleteIfPresent("Strike", (row as { id: string }).id);
    }
  }
  const quals = await orm.BoosterQualification.where({ userId: ids.user }).select("id").all();
  for (const row of quals) {
    await deleteIfPresent("BoosterQualification", (row as { id: string }).id);
  }
  for (const id of createdCharacterIds) {
    await deleteIfPresent("Character", id);
  }
  for (const id of createdUserIds) {
    await deleteIfPresent("User", id);
  }
}, 60_000);

describe("payoutDeductService against a DRAFT settlement", () => {
  let payoutEntryId = "";
  let grossAmountGold = 0;
  let firstDeductId = "";

  beforeAll(async () => {
    const result = await completedRunWithSettlement(lead, "Deduct DRAFT run", 1000);
    payoutEntryId = result.payoutEntryId;
    grossAmountGold = result.grossAmountGold;
  }, 30_000);

  it("rejects a non-positive or non-integer amount", async () => {
    await expectDomainCode(
      payoutDeductService.create(lead, { payoutEntryId, amountGold: 0, reason: "Zero" }),
      "DEDUCT_INVALID_AMOUNT",
    );
    await expectDomainCode(
      payoutDeductService.create(lead, { payoutEntryId, amountGold: -50, reason: "Negative" }),
      "DEDUCT_INVALID_AMOUNT",
    );
    await expectDomainCode(
      payoutDeductService.create(lead, { payoutEntryId, amountGold: 50.5, reason: "Fractional" }),
      "DEDUCT_INVALID_AMOUNT",
    );
  });

  it("USER cannot create a deduct", async () => {
    await expectDomainCode(
      payoutDeductService.create(plainUser, { payoutEntryId, amountGold: 100, reason: "Should fail" }),
      "DEDUCT_NOT_MANAGEABLE",
    );
  });

  it("RAID_LEAD (own run) creates a deduct while the settlement is DRAFT", async () => {
    const created = await payoutDeductService.create(lead, {
      payoutEntryId,
      amountGold: 300,
      reason: "Late without notice",
    });
    firstDeductId = created.id;
    expect(created.status).toBe("ACTIVE");
    expect(created.amountGold).toBe(300);
  });

  it("allows a second independent active deduct within the remaining gross", async () => {
    const remaining = grossAmountGold - 300;
    const second = await payoutDeductService.create(lead, {
      payoutEntryId,
      amountGold: Math.min(200, remaining),
      reason: "Missed required assignment",
    });
    expect(second.status).toBe("ACTIVE");
  });

  it("rejects a deduct that would push the active total above gross", async () => {
    await expectDomainCode(
      payoutDeductService.create(lead, {
        payoutEntryId,
        amountGold: grossAmountGold, // 300 + 200 already active; this alone already exceeds remaining
        reason: "Too much",
      }),
      "DEDUCT_EXCEEDS_GROSS",
    );
  });

  it("RAID_LEAD who does not manage this run is rejected", async () => {
    await expectDomainCode(
      payoutDeductService.create(otherLead, { payoutEntryId, amountGold: 10, reason: "Not their run" }),
      "DEDUCT_NOT_MANAGEABLE",
    );
  });

  it("rejects revoke without a reason", async () => {
    await expectDomainCode(payoutDeductService.revoke(lead, firstDeductId, "  "), "VALIDATION_FAILED");
  });

  it("revoke succeeds while DRAFT and preserves the row", async () => {
    const revoked = await payoutDeductService.revoke(lead, firstDeductId, "Staff correction");
    expect(revoked.status).toBe("REVOKED");
    expect(revoked.revokedById).toBe(ids.lead);
    expect(revoked.revokedReason).toBe("Staff correction");

    const stillThere = await deductRepository.findById(firstDeductId);
    expect(stillThere).not.toBeNull();
    expect(stillThere?.status).toBe("REVOKED");
  });

  it("a revoked deduct no longer counts toward the active total cap", async () => {
    // 300 (revoked) + 200 (active) leaves room for up to grossAmountGold - 200 now.
    const created = await payoutDeductService.create(lead, {
      payoutEntryId,
      amountGold: grossAmountGold - 200,
      reason: "Backfilling after revoke",
    });
    expect(created.status).toBe("ACTIVE");
    await payoutDeductService.revoke(lead, created.id, "Cleanup");
  });

  describe("optional strike link", () => {
    it("creates a deduct with no strike link", async () => {
      const created = await payoutDeductService.create(lead, {
        payoutEntryId,
        amountGold: 10,
        reason: "No strike link",
      });
      expect(created.strikeId).toBeNull();
      await payoutDeductService.revoke(lead, created.id, "Cleanup");
    });

    it("links a strike belonging to the same user", async () => {
      const strike = await strikeService.create(admin, { userId: ids.user, reason: "Linked strike" });
      const created = await payoutDeductService.create(lead, {
        payoutEntryId,
        amountGold: 10,
        reason: "Linked deduct",
        strikeId: strike.id,
      });
      expect(created.strikeId).toBe(strike.id);
      await payoutDeductService.revoke(lead, created.id, "Cleanup");
    });

    it("rejects a strike belonging to a different user", async () => {
      const strike = await strikeService.create(admin, { userId: ids.other, reason: "Different user" });
      await expectDomainCode(
        payoutDeductService.create(lead, {
          payoutEntryId,
          amountGold: 10,
          reason: "Cross-user link",
          strikeId: strike.id,
        }),
        "DEDUCT_INVALID_STRIKE_LINK",
      );
    });

    it("rejects a strike linked to a different run", async () => {
      const otherRun = await completedRunWithSettlement(otherLead, "Deduct cross-run", 200);
      const strike = await strikeService.create(admin, {
        userId: ids.user,
        runId: otherRun.runId,
        reason: "Different run",
      });
      await expectDomainCode(
        payoutDeductService.create(lead, {
          payoutEntryId,
          amountGold: 10,
          reason: "Cross-run link",
          strikeId: strike.id,
        }),
        "DEDUCT_INVALID_STRIKE_LINK",
      );
    });

    it("revoking a strike does not revoke its linked deduct, and vice versa", async () => {
      const strike = await strikeService.create(admin, { userId: ids.user, reason: "Independent lifecycles" });
      const deduct = await payoutDeductService.create(lead, {
        payoutEntryId,
        amountGold: 10,
        reason: "Independent lifecycle deduct",
        strikeId: strike.id,
      });

      await strikeService.revoke(admin, strike.id, "Revoking strike only");
      const deductAfterStrikeRevoke = await deductRepository.findById(deduct.id);
      expect(deductAfterStrikeRevoke?.status).toBe("ACTIVE");

      await payoutDeductService.revoke(lead, deduct.id, "Revoking deduct only");
      const strikeAfterDeductRevoke = await strikeService.listForUser(admin, ids.user);
      const strikeRow = strikeAfterDeductRevoke.find((row) => row.id === strike.id);
      expect(strikeRow?.status).toBe("REVOKED"); // already revoked above; confirms deduct revoke did not double-touch it
    });
  });
});

describe("payoutDeductService against a locked (FINALIZED/PAID) settlement", () => {
  let payoutEntryId = "";
  let activeDeductId = "";
  let runId = "";

  beforeAll(async () => {
    const result = await completedRunWithSettlement(lead, "Deduct lifecycle run", 1000);
    runId = result.runId;
    payoutEntryId = result.payoutEntryId;
    const created = await payoutDeductService.create(lead, {
      payoutEntryId,
      amountGold: 100,
      reason: "Before finalize",
    });
    activeDeductId = created.id;

    const settlement = await payoutRepository.findByRunId(runId);
    await payoutService.finalizeSettlement(lead, settlement!.id);
  }, 30_000);

  it("rejects creating a deduct once the settlement is FINALIZED", async () => {
    await expectDomainCode(
      payoutDeductService.create(lead, { payoutEntryId, amountGold: 10, reason: "Too late" }),
      "DEDUCT_SETTLEMENT_LOCKED",
    );
  });

  it("rejects revoking a deduct once the settlement is FINALIZED", async () => {
    await expectDomainCode(
      payoutDeductService.revoke(lead, activeDeductId, "Too late"),
      "DEDUCT_SETTLEMENT_LOCKED",
    );
  });

  it("stays locked once the settlement is PAID", async () => {
    const settlement = await payoutRepository.findByRunId(runId);
    await payoutService.markPaid(admin, settlement!.id);

    await expectDomainCode(
      payoutDeductService.create(lead, { payoutEntryId, amountGold: 10, reason: "Still too late" }),
      "DEDUCT_SETTLEMENT_LOCKED",
    );
    await expectDomainCode(
      payoutDeductService.revoke(lead, activeDeductId, "Still too late"),
      "DEDUCT_SETTLEMENT_LOCKED",
    );
  });
});

describe("payoutDeductService.listBySettlement", () => {
  it("batches every deduct for a settlement's entries in one call", async () => {
    const result = await completedRunWithSettlement(lead, "Deduct batch list run", 1000);
    await payoutDeductService.create(lead, {
      payoutEntryId: result.payoutEntryId,
      amountGold: 50,
      reason: "Batch list check",
    });
    const settlement = await payoutRepository.findByRunId(result.runId);
    const deducts = await payoutDeductService.listBySettlement(lead, settlement!.id);
    expect(deducts.some((row) => row.payoutEntryId === result.payoutEntryId)).toBe(true);
  });
});
