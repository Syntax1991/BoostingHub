import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { payoutRepository } from "@/repositories/payout.repository";
import { attendanceService } from "@/services/attendance.service";
import { payoutService } from "@/services/payout.service";
import { payoutDeductService } from "@/services/payout-deduct.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";

const raidId = WOW_RAID_CATALOG[0].id;
const ids = {
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-pa0000000001",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-pa0000000002",
  user: "aaaaaaaa-aaaa-4aaa-8aaa-pa0000000003",
};
const createdUserIds = Object.values(ids);
const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"] = "USER"): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@patest.boostting.local`,
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
    email: `${id}@patest.boostting.local`,
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
    else if (table === "Deduct") await orm.Deduct.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

function futureIso(days = 12) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function cleanupRun(runId: string) {
  const settlement = await orm.RunSettlement.where({ runId }).first();
  if (settlement) {
    const settlementId = (settlement as { id: string }).id;
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

const lead = asUser(ids.lead, "Accounting Lead", "RAID_LEAD");
const plainUser = asUser(ids.user, "Accounting User");

let characterId = "";

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
  await createTestUser(ids.admin, "Accounting Admin", "ADMIN");
  await createTestUser(ids.lead, "Accounting Lead", "RAID_LEAD");
  await createTestUser(ids.user, "Accounting User", "USER");

  characterId = crypto.randomUUID();
  createdCharacterIds.push(characterId);
  await orm.Character.create({
    id: characterId,
    userId: ids.user,
    name: "Patarget",
    realm: "Accounting Lab",
    normalizedName: normalizeCharacterIdentity("Patarget"),
    normalizedRealm: normalizeCharacterIdentity("Accounting Lab"),
    region: "EU",
    wowClass: "WARRIOR",
    specialization: "Fury",
    primaryRole: "DPS",
    itemLevel: 700,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await orm.BoosterQualification.create({
    id: crypto.randomUUID(),
    userId: ids.user,
    difficulty: "HEROIC",
    status: "APPROVED",
    notes: "Accounting test grant",
    grantedAt: new Date().toISOString(),
    grantedById: ids.admin,
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
  for (const id of createdCharacterIds) {
    await deleteIfPresent("Character", id);
  }
  const quals = await orm.BoosterQualification.where({ userId: ids.user }).select("id").all();
  for (const row of quals) {
    await deleteIfPresent("BoosterQualification", (row as { id: string }).id);
  }
  for (const id of createdUserIds) {
    await deleteIfPresent("User", id);
  }
}, 60_000);

describe("payoutService.getPayoutView gross/deduct/net accounting", () => {
  it("keeps the gross exact-sum invariant, derives net without redistribution, and never persists net", async () => {
    const created = await runService.createRun(lead, {
      raidId,
      difficulty: "HEROIC",
      scheduledStartAt: futureIso(),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      title: "Accounting run",
    });
    const runId = created.id;
    createdRunIds.push(runId);
    await runService.openRun(lead, runId);
    const signupId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: signupId,
      runId,
      userId: ids.user,
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
    const draft = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.setDraftSelection(lead, { runId, signupId, selected: true, version: draft.roster.version });
    const ready = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, { runId, version: ready.roster.version, acknowledgeWarnings: true });
    await runService.startRun(lead, runId);
    const rows = (await attendanceService.getManagerAttendance(lead, runId)).rows;
    await attendanceService.setStatus(lead, { attendanceId: rows[0]!.id, status: "PRESENT" });
    await runService.completeRun(lead, runId);
    await payoutService.prepareSettlement(lead, runId, 1000);

    const settlement = await payoutRepository.findByRunId(runId);
    const entry = settlement!.entries[0]!;
    expect(entry.amountGold).toBe(1000); // sole participant: gross exact-sum unaffected by anything below

    await payoutDeductService.create(lead, { payoutEntryId: entry.id, amountGold: 150, reason: "Late" });
    const revokedDeduct = await payoutDeductService.create(lead, {
      payoutEntryId: entry.id,
      amountGold: 50,
      reason: "Reverted adjustment",
    });
    await payoutDeductService.revoke(lead, revokedDeduct.id, "Mistake, reverting");

    const managerView = await payoutService.getPayoutView(lead, runId);
    const managerEntry = managerView.manager!.entries[0]!;
    expect(managerEntry.grossAmountGold).toBe(1000);
    expect(managerEntry.amountGold).toBe(1000); // gross allocation field itself is untouched
    expect(managerEntry.deductTotal).toBe(150); // revoked deduct excluded
    expect(managerEntry.netAmountGold).toBe(850);
    expect(managerEntry.deducts).toHaveLength(2); // both active and revoked visible to managers

    expect(managerView.manager!.summary.grossTotal).toBe(1000);
    expect(managerView.manager!.summary.deductTotal).toBe(150);
    expect(managerView.manager!.summary.netTotal).toBe(850);
    expect(managerView.manager!.summary.retainedTotal).toBe(150);
    // Gross exact-sum invariant: unaffected by deducts entirely.
    expect(
      managerView.manager!.entries.reduce((sum, row) => sum + row.amountGold, 0),
    ).toBe(managerView.manager!.summary.grossTotal);

    const settlementAfter = await payoutRepository.findById(settlement!.id);
    await payoutService.finalizeSettlement(lead, settlementAfter!.id);

    const ownView = await payoutService.getPayoutView(plainUser, runId);
    const ownEntry = ownView.own[0]!;
    expect(ownEntry.grossAmountGold).toBe(1000);
    expect(ownEntry.deductTotal).toBe(150);
    expect(ownEntry.netAmountGold).toBe(850);
    expect(ownEntry.deducts).toEqual([{ amountGold: 150, reason: "Late" }]); // revoked deduct hidden from own view
  }, 30_000);
});
