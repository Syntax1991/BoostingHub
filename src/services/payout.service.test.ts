import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { attendanceService } from "@/services/attendance.service";
import { allocateGold } from "@/services/payout-calculation";
import { payoutService } from "@/services/payout.service";
import { rosterService } from "@/services/roster.service";
import { runDetailService } from "@/services/run-detail.service";
import { runService } from "@/services/run.service";
import type { AttendanceStatus, CharacterRole, ParticipationType, WowClass } from "@/models/enums";

const raidId = WOW_RAID_CATALOG[0].id;
const ids = {
  user: "aaaaaaaa-aaaa-4aaa-8aaa-po0000000001",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-po0000000002",
  otherLead: "aaaaaaaa-aaaa-4aaa-8aaa-po0000000003",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-po0000000004",
  playerB: "aaaaaaaa-aaaa-4aaa-8aaa-po0000000005",
  playerC: "aaaaaaaa-aaaa-4aaa-8aaa-po0000000006",
  playerD: "aaaaaaaa-aaaa-4aaa-8aaa-po0000000007",
  playerE: "aaaaaaaa-aaaa-4aaa-8aaa-po0000000008",
};

const createdRunIds: string[] = [];
const createdUserIds = Object.values(ids);
const createdCharacterIds: string[] = [];
const createdAccessIds: string[] = [];
const createdSignupIds: string[] = [];

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@payout.boostting.local`,
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
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

async function createTestUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@payout.boostting.local`,
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
    else if (table === "BoosterAccess") await orm.BoosterAccess.where({ id }).delete();
    else if (table === "RunAttendance") await orm.RunAttendance.where({ id }).delete();
    else if (table === "RunSettlement") await orm.RunSettlement.where({ id }).delete();
    else if (table === "Run") await orm.Run.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

function futureIso(days = 12) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function createCharacter(input: {
  userId: string;
  name: string;
  wowClass: "SHAMAN" | "PALADIN" | "HUNTER" | "PRIEST" | "MONK" | "WARRIOR";
  specialization: string;
  primaryRole: CharacterRole;
}) {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  await orm.Character.create({
    id,
    userId: input.userId,
    name: input.name,
    realm: "Payout Lab",
    normalizedName: normalizeCharacterIdentity(input.name),
    normalizedRealm: normalizeCharacterIdentity("Payout Lab"),
    region: "EU",
    wowClass: input.wowClass,
    specialization: input.specialization,
    primaryRole: input.primaryRole,
    itemLevel: 700,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function approveAccess(characterId: string, userId: string, wowClass: WowClass, role: CharacterRole) {
  const id = crypto.randomUUID();
  createdAccessIds.push(id);
  await orm.BoosterAccess.create({
    id,
    userId,
    characterId,
    wowClass,
    role,
    difficulty: "HEROIC",
    status: "APPROVED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function createSignup(input: {
  runId: string;
  userId: string;
  characterId: string;
  participationType: ParticipationType;
  role: CharacterRole | null;
  isBackup?: boolean;
}) {
  const id = crypto.randomUUID();
  createdSignupIds.push(id);
  await orm.RunSignup.create({
    id,
    runId: input.runId,
    userId: input.userId,
    characterId: input.characterId,
    participationType: input.participationType,
    role: input.role,
    isBackup: input.isBackup ?? false,
    status: "PENDING",
    lootbuddyMode: input.participationType === "LOOTBUDDY" ? "LOOT_ONLY" : null,
    lootbuddyVerification: input.participationType === "LOOTBUDDY" ? "ACCESS" : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function createDraft(actor: AuthenticatedUser, extra: Record<string, unknown> = {}) {
  const created = await runService.createRun(actor, {
    raidId,
    difficulty: "HEROIC",
    scheduledStartAt: futureIso(),
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    raidLeadId: actor.accountRole === "ADMIN" ? ids.lead : undefined,
    ...extra,
  });
  createdRunIds.push(created.id);
  return created.id;
}

async function selectAndPublish(actor: AuthenticatedUser, runId: string, signupIds: string[]) {
  for (const signupId of signupIds) {
    const view = await rosterService.getRosterManagementView(actor, runId);
    await rosterService.setDraftSelection(actor, {
      runId,
      signupId,
      selected: true,
      version: view.roster.version,
    });
  }
  const ready = await rosterService.getRosterManagementView(actor, runId);
  await rosterService.publishRoster(actor, {
    runId,
    version: ready.roster.version,
    acknowledgeWarnings: true,
  });
}

async function cleanupRun(runId: string) {
  const settlement = await orm.RunSettlement.where({ runId }).first();
  if (settlement) {
    await deleteIfPresent("RunSettlement", (settlement as { id: string }).id);
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

const user = asUser(ids.user, "Payout User");
const lead = asUser(ids.lead, "Payout Lead", "RAID_LEAD");
const otherLead = asUser(ids.otherLead, "Payout Other Lead", "RAID_LEAD");
const admin = asUser(ids.admin, "Payout Admin", "ADMIN");

const characters: Record<string, string> = {};

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const userId of createdUserIds) {
    const runs = await orm.Run.where({ raidLeadId: userId }).select("id").all();
    for (const run of runs) {
      await cleanupRun((run as { id: string }).id);
    }
    const signups = await orm.RunSignup.where({ userId }).select("id").all();
    for (const row of signups) {
      await deleteIfPresent("RunSignup", (row as { id: string }).id);
    }
    const access = await orm.BoosterAccess.where({ userId }).select("id").all();
    for (const row of access) {
      await deleteIfPresent("BoosterAccess", (row as { id: string }).id);
    }
    const chars = await orm.Character.where({ userId }).select("id").all();
    for (const row of chars) {
      await deleteIfPresent("Character", (row as { id: string }).id);
    }
    await deleteIfPresent("User", userId);
  }
  await createTestUser(ids.user, "Payout User", "USER");
  await createTestUser(ids.lead, "Payout Lead", "RAID_LEAD");
  await createTestUser(ids.otherLead, "Payout Other Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "Payout Admin", "ADMIN");
  await createTestUser(ids.playerB, "Payout Player B", "USER");
  await createTestUser(ids.playerC, "Payout Player C", "USER");
  await createTestUser(ids.playerD, "Payout Player D", "USER");
  await createTestUser(ids.playerE, "Payout Player E", "USER");

  characters.user = await createCharacter({
    userId: ids.user,
    name: "Pykael",
    wowClass: "SHAMAN",
    specialization: "Elemental",
    primaryRole: "DPS",
  });
  characters.playerB = await createCharacter({
    userId: ids.playerB,
    name: "Pymira",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
  });
  characters.playerC = await createCharacter({
    userId: ids.playerC,
    name: "Pybrann",
    wowClass: "PALADIN",
    specialization: "Protection",
    primaryRole: "TANK",
  });
  characters.playerD = await createCharacter({
    userId: ids.playerD,
    name: "Pysylva",
    wowClass: "HUNTER",
    specialization: "Beast Mastery",
    primaryRole: "DPS",
  });
  characters.playerE = await createCharacter({
    userId: ids.playerE,
    name: "Pyaelira",
    wowClass: "MONK",
    specialization: "Mistweaver",
    primaryRole: "HEALER",
  });

  await approveAccess(characters.user, ids.user, "SHAMAN", "DPS");
  await approveAccess(characters.playerC, ids.playerC, "PALADIN", "TANK");
  await approveAccess(characters.playerD, ids.playerD, "HUNTER", "DPS");
  await approveAccess(characters.playerE, ids.playerE, "MONK", "HEALER");
}, 60_000);

afterAll(async () => {
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const id of createdSignupIds) {
    await deleteIfPresent("RunSignup", id);
  }
  for (const id of createdAccessIds) {
    await deleteIfPresent("BoosterAccess", id);
  }
  for (const id of createdCharacterIds) {
    await deleteIfPresent("Character", id);
  }
  for (const id of createdUserIds) {
    await deleteIfPresent("User", id);
  }
}, 60_000);

async function completedRun(statuses: Array<{
  userId: string;
  characterId: string;
  participationType: ParticipationType;
  role: CharacterRole | null;
  isBackup?: boolean;
  status: Exclude<AttendanceStatus, "UNMARKED">;
}>) {
  const runId = await createDraft(lead, { title: "Payout completed" });
  await runService.openRun(lead, runId);
  const signupIds: string[] = [];
  for (const row of statuses) {
    signupIds.push(
      await createSignup({
        runId,
        userId: row.userId,
        characterId: row.characterId,
        participationType: row.participationType,
        role: row.role,
        isBackup: row.isBackup,
      }),
    );
  }
  await selectAndPublish(lead, runId, signupIds);
  await runService.startRun(lead, runId);
  const rows = (await attendanceService.getManagerAttendance(lead, runId)).rows;
  const byCharacter = Object.fromEntries(rows.map((row) => [row.characterName, row]));
  for (const row of statuses) {
    const characterName =
      row.userId === ids.user
        ? "Pykael"
        : row.userId === ids.playerB
          ? "Pymira"
          : row.userId === ids.playerC
            ? "Pybrann"
            : row.userId === ids.playerD
              ? "Pysylva"
              : "Pyaelira";
    const target = byCharacter[characterName];
    if (!target) {
      throw new Error(`Missing attendance for ${characterName}`);
    }
    await attendanceService.setStatus(lead, { attendanceId: target.id, status: row.status });
  }
  await runService.completeRun(lead, runId);
  return runId;
}

const defaultRoster = [
  {
    userId: ids.user,
    characterId: "",
    participationType: "BOOSTER" as const,
    role: "DPS" as const,
    status: "PRESENT" as const,
  },
  {
    userId: ids.playerB,
    characterId: "",
    participationType: "LOOTBUDDY" as const,
    role: null,
    status: "LATE" as const,
  },
  {
    userId: ids.playerC,
    characterId: "",
    participationType: "BOOSTER" as const,
    role: "TANK" as const,
    status: "NO_SHOW" as const,
  },
  {
    userId: ids.playerD,
    characterId: "",
    participationType: "BOOSTER" as const,
    role: "DPS" as const,
    isBackup: true,
    status: "STANDBY" as const,
  },
];

function rosterWithCharacters() {
  return defaultRoster.map((row) => ({
    ...row,
    characterId:
      row.userId === ids.user
        ? characters.user
        : row.userId === ids.playerB
          ? characters.playerB
          : row.userId === ids.playerC
            ? characters.playerC
            : characters.playerD,
  }));
}

describe("prepare settlement", () => {
  it("rejects non-completed runs, USER, and other raid leads", { timeout: 20_000 }, async () => {
    const openId = await createDraft(lead, { title: "Payout open" });
    await runService.openRun(lead, openId);
    await expectDomainCode(payoutService.prepareSettlement(lead, openId, 1000), "PAYOUT_RUN_NOT_COMPLETED");
    await expectDomainCode(payoutService.prepareSettlement(user, openId, 1000), "PAYOUT_NOT_MANAGEABLE");

    const runId = await completedRun(rosterWithCharacters());
    await expectDomainCode(payoutService.prepareSettlement(user, runId, 1000), "PAYOUT_NOT_MANAGEABLE");
    await expectDomainCode(payoutService.prepareSettlement(otherLead, runId, 1000), "PAYOUT_NOT_MANAGEABLE");
  });

  it("lets assigned RAID_LEAD and ADMIN prepare one settlement per completed attendance set", { timeout: 20_000 }, async () => {
    const runId = await completedRun(rosterWithCharacters());
    await payoutService.prepareSettlement(lead, runId, 1000);
    const view = await payoutService.getPayoutView(lead, runId);
    expect(view.manager?.status).toBe("DRAFT");
    expect(view.manager?.entries).toHaveLength(4);
    expect(view.manager?.summary.distributedGold).toBe(1000);
    expect(view.manager?.summary.remainder).toBe(0);
    await expectDomainCode(payoutService.prepareSettlement(admin, runId, 2000), "PAYOUT_ALREADY_EXISTS");

    const adminRun = await completedRun([
      ...rosterWithCharacters().slice(0, 2),
      { userId: ids.playerE, characterId: characters.playerE, participationType: "BOOSTER", role: "HEALER", status: "LEFT_EARLY" },
    ]);
    await payoutService.prepareSettlement(admin, adminRun, 500);
    const adminView = await payoutService.getPayoutView(admin, adminRun);
    expect(adminView.manager?.entries).toHaveLength(3);
  });
});

describe("default share mapping", () => {
  it("maps attendance defaults the same for BOOSTER and LOOTBUDDY and ignores backup alone", { timeout: 20_000 }, async () => {
    const runId = await completedRun(rosterWithCharacters());
    await payoutService.prepareSettlement(lead, runId, 1000);
    const entries = (await payoutService.getPayoutView(lead, runId)).manager!.entries;
    const byStatus = Object.fromEntries(entries.map((row) => [row.attendanceStatus, row]));
    expect(byStatus.PRESENT?.shareUnits).toBe(100);
    expect(byStatus.LATE?.shareUnits).toBe(100);
    expect(byStatus.NO_SHOW?.shareUnits).toBe(0);
    expect(byStatus.STANDBY?.shareUnits).toBe(0);
    expect(byStatus.LATE?.participationType).toBe("LOOTBUDDY");
    expect(byStatus.STANDBY?.isBackup).toBe(true);
    expect(byStatus.PRESENT?.amountGold + byStatus.LATE?.amountGold).toBe(1000);

    const extraId = await completedRun([
      { userId: ids.user, characterId: characters.user, participationType: "BOOSTER", role: "DPS", status: "LEFT_EARLY" },
      { userId: ids.playerB, characterId: characters.playerB, participationType: "LOOTBUDDY", role: null, status: "EXCUSED" },
    ]);
    await payoutService.prepareSettlement(lead, extraId, 100);
    const extra = (await payoutService.getPayoutView(lead, extraId)).manager!.entries;
    expect(extra.find((row) => row.attendanceStatus === "LEFT_EARLY")?.shareUnits).toBe(100);
    expect(extra.find((row) => row.attendanceStatus === "EXCUSED")?.shareUnits).toBe(0);
    expect(extra.find((row) => row.attendanceStatus === "EXCUSED")?.amountGold).toBe(0);
  });
});

describe("draft editing and calculation", () => {
  it("recalculates from totalGold and shareUnits with deterministic remainder", { timeout: 20_000 }, async () => {
    const runId = await completedRun([
      { userId: ids.user, characterId: characters.user, participationType: "BOOSTER", role: "DPS", status: "PRESENT" },
      { userId: ids.playerB, characterId: characters.playerB, participationType: "LOOTBUDDY", role: null, status: "LATE" },
      { userId: ids.playerC, characterId: characters.playerC, participationType: "BOOSTER", role: "TANK", status: "LEFT_EARLY" },
      { userId: ids.playerD, characterId: characters.playerD, participationType: "BOOSTER", role: "DPS", isBackup: true, status: "EXCUSED" },
    ]);
    await payoutService.prepareSettlement(lead, runId, 1000);
    const prepared = (await payoutService.getPayoutView(lead, runId)).manager!;
    await payoutService.updateDraftTotal(lead, prepared.id, 1001);
    const byName = Object.fromEntries(prepared.entries.map((row) => [row.characterName, row]));
    await payoutService.updateShareUnits(lead, { payoutEntryId: byName.Pykael.id, shareUnits: 100 });
    await payoutService.updateShareUnits(lead, { payoutEntryId: byName.Pymira.id, shareUnits: 100 });
    await payoutService.updateShareUnits(lead, { payoutEntryId: byName.Pybrann.id, shareUnits: 50 });
    await payoutService.updateShareUnits(lead, {
      payoutEntryId: byName.Pysylva.id,
      shareUnits: 0,
      adjustmentReason: "excused unpaid",
    });
    const after = (await payoutService.getPayoutView(lead, runId)).manager!;
    const expected = allocateGold(
      1001,
      after.entries.map((row) => ({ attendanceId: row.attendanceId, shareUnits: row.shareUnits })),
    );
    const expectedByAttendance = Object.fromEntries(expected.map((row) => [row.attendanceId, row.amountGold]));
    for (const row of after.entries) {
      expect(row.amountGold).toBe(expectedByAttendance[row.attendanceId]);
    }
    expect(after.entries.reduce((sum, row) => sum + row.amountGold, 0)).toBe(1001);
    expect(after.summary.remainder).toBe(0);
    expect(after.entries.find((row) => row.characterName === "Pysylva")?.adjustmentReason).toBe("excused unpaid");

    await expectDomainCode(
      payoutService.updateShareUnits(lead, { payoutEntryId: byName.Pykael.id, shareUnits: -1 }),
      "PAYOUT_INVALID_SHARE",
    );
    await expectDomainCode(
      payoutService.updateShareUnits(lead, { payoutEntryId: byName.Pykael.id, shareUnits: 10001 }),
      "PAYOUT_INVALID_SHARE",
    );
    await expectDomainCode(payoutService.updateDraftTotal(lead, prepared.id, 0), "PAYOUT_INVALID_TOTAL");
    await expectDomainCode(
      payoutService.updateShareUnits(user, { payoutEntryId: byName.Pykael.id, shareUnits: 50 }),
      "PAYOUT_NOT_MANAGEABLE",
    );
    await expectDomainCode(
      payoutService.updateShareUnits(otherLead, { payoutEntryId: byName.Pykael.id, shareUnits: 50 }),
      "PAYOUT_NOT_MANAGEABLE",
    );
  });
});

describe("finalize and paid", () => {
  it("finalizes from authoritative state, snapshots names, and rejects later draft edits", { timeout: 20_000 }, async () => {
    const runId = await completedRun(rosterWithCharacters());
    await payoutService.prepareSettlement(lead, runId, 800);
    const draft = (await payoutService.getPayoutView(lead, runId)).manager!;
    await payoutService.finalizeSettlement(lead, draft.id);
    await orm.Character.where({ id: characters.user }).update({
      name: "RenamedAfterFinalize",
      updatedAt: new Date().toISOString(),
    });
    await orm.User.where({ id: ids.user }).update({
      name: "Renamed User",
      updatedAt: new Date().toISOString(),
    });
    const finalized = await payoutService.getPayoutView(lead, runId);
    expect(finalized.manager?.status).toBe("FINALIZED");
    expect(finalized.manager?.finalizedAt).toBeTruthy();
    expect(finalized.manager?.summary.distributedGold).toBe(800);
    expect(finalized.manager?.entries.some((row) => row.characterName === "Pykael")).toBe(true);
    expect(finalized.manager?.entries.some((row) => row.characterName === "RenamedAfterFinalize")).toBe(false);
    expect(finalized.manager?.entries.some((row) => row.userDisplayName === "Payout User")).toBe(true);
    await expectDomainCode(payoutService.updateDraftTotal(lead, draft.id, 900), "PAYOUT_FINALIZED");
    await expectDomainCode(
      payoutService.updateShareUnits(lead, { payoutEntryId: draft.entries[0].id, shareUnits: 50 }),
      "PAYOUT_FINALIZED",
    );

    await orm.Character.where({ id: characters.user }).update({
      name: "Pykael",
      updatedAt: new Date().toISOString(),
    });
    await orm.User.where({ id: ids.user }).update({
      name: "Payout User",
      updatedAt: new Date().toISOString(),
    });
  });

  it("lets only ADMIN mark paid and keeps PAID immutable", { timeout: 20_000 }, async () => {
    const runId = await completedRun(rosterWithCharacters());
    await payoutService.prepareSettlement(admin, runId, 600);
    const draft = (await payoutService.getPayoutView(admin, runId)).manager!;
    await expectDomainCode(payoutService.markPaid(admin, draft.id), "PAYOUT_NOT_DRAFT");
    await payoutService.finalizeSettlement(lead, draft.id);
    await expectDomainCode(payoutService.markPaid(lead, draft.id), "PAYOUT_ADMIN_REQUIRED");
    await payoutService.markPaid(admin, draft.id);
    const paid = await payoutService.getPayoutView(admin, runId);
    expect(paid.manager?.status).toBe("PAID");
    expect(paid.manager?.paidAt).toBeTruthy();
    await expectDomainCode(payoutService.markPaid(admin, draft.id), "PAYOUT_ALREADY_PAID");
    await expectDomainCode(payoutService.updateDraftTotal(admin, draft.id, 700), "PAYOUT_ALREADY_PAID");
  });
});

describe("user payout DTO", () => {
  it("hides draft splits and returns only own finalized lines", { timeout: 20_000 }, async () => {
    const runId = await completedRun(rosterWithCharacters());
    await payoutService.prepareSettlement(lead, runId, 1000);
    const draftView = await runDetailService.getRunDetail(user, runId);
    expect(draftView.payout.manager).toBeNull();
    expect(draftView.payout.own).toEqual([]);
    expect(draftView.payout.available).toBe(false);
    expect(draftView.payout.capabilities.canPrepare).toBe(false);

    const settlementId = (await payoutService.getPayoutView(lead, runId)).manager!.id;
    await payoutService.finalizeSettlement(lead, settlementId);
    const userView = await runDetailService.getRunDetail(user, runId);
    expect(userView.payout.manager).toBeNull();
    expect(userView.payout.own).toHaveLength(1);
    expect(userView.payout.own[0]?.amountGold).toBeGreaterThan(0);
    expect(userView.payout.own[0]).not.toHaveProperty("adjustmentReason");
    expect(JSON.stringify(userView.payout)).not.toContain("Pymira");
    expect(userView.payout.capabilities.canFinalize).toBe(false);
    expect(userView.payout.capabilities.canMarkPaid).toBe(false);

    const outsider = asUser(ids.playerE, "Payout Player E");
    const otherView = await runDetailService.getRunDetail(outsider, runId);
    expect(otherView.payout.own).toEqual([]);

    const leadView = await runDetailService.getRunDetail(lead, runId);
    expect(leadView.payout.manager?.entries.length).toBe(4);
    expect(leadView.payout.capabilities.canMarkPaid).toBe(false);
    const adminView = await runDetailService.getRunDetail(admin, runId);
    expect(adminView.payout.capabilities.canMarkPaid).toBe(true);
  });
});
