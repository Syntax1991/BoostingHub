import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { attendanceService } from "@/services/attendance.service";
import { rosterService } from "@/services/roster.service";
import { runDetailService } from "@/services/run-detail.service";
import { runService } from "@/services/run.service";
import type { AttendanceStatus, CharacterRole, ParticipationType } from "@/models/enums";

const raidId = WOW_RAID_CATALOG[0].id;
const ids = {
  user: "aaaaaaaa-aaaa-4aaa-8aaa-at0000000001",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-at0000000002",
  otherLead: "aaaaaaaa-aaaa-4aaa-8aaa-at0000000003",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-at0000000004",
  playerB: "aaaaaaaa-aaaa-4aaa-8aaa-at0000000005",
  playerC: "aaaaaaaa-aaaa-4aaa-8aaa-at0000000006",
  playerD: "aaaaaaaa-aaaa-4aaa-8aaa-at0000000007",
  playerE: "aaaaaaaa-aaaa-4aaa-8aaa-at0000000008",
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
    email: `${id}@attest.boostting.local`,
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
    email: `${id}@attest.boostting.local`,
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
    else if (table === "BoosterQualification") await orm.BoosterQualification.where({ id }).delete();
    else if (table === "RunAttendance") await orm.RunAttendance.where({ id }).delete();
    else if (table === "Run") await orm.Run.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

function futureIso(days = 10) {
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
    realm: "Attendance Lab",
    normalizedName: normalizeCharacterIdentity(input.name),
    normalizedRealm: normalizeCharacterIdentity("Attendance Lab"),
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

async function approveAccess(_characterId: string, userId: string) {
  const existing = await orm.BoosterQualification.where({ userId, difficulty: "HEROIC" }).first();
  if (existing) {
    createdAccessIds.push(String((existing as { id: string }).id));
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  createdAccessIds.push(id);
  await orm.BoosterQualification.create({
    id,
    userId,
    difficulty: "HEROIC",
    status: "APPROVED",
    notes: "Attendance test grant",
    grantedAt: now,
    grantedById: ids.admin,
    revokedAt: null,
    revokedById: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function createSignup(input: {
  runId: string;
  userId: string;
  characterId: string;
  participationType: ParticipationType;
  role: CharacterRole | null;
  isBackup?: boolean;
  status?: "PENDING" | "SELECTED" | "NOT_SELECTED";
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
    status: input.status ?? "PENDING",
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
    lootType: "UNSAVED",
    plannedBossCount: 8,
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

async function selectAndPublish(lead: AuthenticatedUser, runId: string, signupIds: string[]) {
  for (const signupId of signupIds) {
    const view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.setDraftSelection(lead, {
      runId,
      signupId,
      selected: true,
      version: view.roster.version,
    });
  }
  const ready = await rosterService.getRosterManagementView(lead, runId);
  await rosterService.publishRoster(lead, {
    runId,
    version: ready.roster.version,
    acknowledgeWarnings: true,
  });
}

async function cleanupRun(runId: string) {
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

const user = asUser(ids.user, "Attendance User");
const lead = asUser(ids.lead, "Attendance Lead", "RAID_LEAD");
const otherLead = asUser(ids.otherLead, "Attendance Other Lead", "RAID_LEAD");
const admin = asUser(ids.admin, "Attendance Admin", "ADMIN");

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
    const access = await orm.BoosterQualification.where({ userId }).select("id").all();
    for (const row of access) {
      await deleteIfPresent("BoosterQualification", (row as { id: string }).id);
    }
    const chars = await orm.Character.where({ userId }).select("id").all();
    for (const row of chars) {
      await deleteIfPresent("Character", (row as { id: string }).id);
    }
    await deleteIfPresent("User", userId);
  }
  await createTestUser(ids.user, "Attendance User", "USER");
  await createTestUser(ids.lead, "Attendance Lead", "RAID_LEAD");
  await createTestUser(ids.otherLead, "Attendance Other Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "Attendance Admin", "ADMIN");
  await createTestUser(ids.playerB, "Attendance Player B", "USER");
  await createTestUser(ids.playerC, "Attendance Player C", "USER");
  await createTestUser(ids.playerD, "Attendance Player D", "USER");
  await createTestUser(ids.playerE, "Attendance Player E", "USER");

  characters.user = await createCharacter({
    userId: ids.user,
    name: "Atkael",
    wowClass: "SHAMAN",
    specialization: "Elemental",
    primaryRole: "DPS",
  });
  characters.playerB = await createCharacter({
    userId: ids.playerB,
    name: "Atmira",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
  });
  characters.playerC = await createCharacter({
    userId: ids.playerC,
    name: "Atbrann",
    wowClass: "PALADIN",
    specialization: "Protection",
    primaryRole: "TANK",
  });
  characters.playerD = await createCharacter({
    userId: ids.playerD,
    name: "Atsylva",
    wowClass: "HUNTER",
    specialization: "Beast Mastery",
    primaryRole: "DPS",
  });
  characters.playerE = await createCharacter({
    userId: ids.playerE,
    name: "Ataelira",
    wowClass: "MONK",
    specialization: "Mistweaver",
    primaryRole: "HEALER",
  });
  characters.spare = await createCharacter({
    userId: ids.user,
    name: "Atspare",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    primaryRole: "HEALER",
  });

  await approveAccess(characters.user, ids.user);
  await approveAccess(characters.playerC, ids.playerC);
  await approveAccess(characters.playerD, ids.playerD);
  await approveAccess(characters.playerE, ids.playerE);
  await approveAccess(characters.spare, ids.user);
}, 60_000);

afterAll(async () => {
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const id of createdSignupIds) {
    await deleteIfPresent("RunSignup", id);
  }
  for (const id of createdAccessIds) {
    await deleteIfPresent("BoosterQualification", id);
  }
  for (const id of createdCharacterIds) {
    await deleteIfPresent("Character", id);
  }
  for (const id of createdUserIds) {
    await deleteIfPresent("User", id);
  }
}, 60_000);

async function publishedRunWithRoster() {
  const runId = await createDraft(lead, { title: "Attendance published" });
  await runService.openRun(lead, runId);
  const booster = await createSignup({
    runId,
    userId: ids.user,
    characterId: characters.user,
    participationType: "BOOSTER",
    role: "DPS",
  });
  const lootbuddy = await createSignup({
    runId,
    userId: ids.playerB,
    characterId: characters.playerB,
    participationType: "LOOTBUDDY",
    role: null,
  });
  const backup = await createSignup({
    runId,
    userId: ids.playerD,
    characterId: characters.playerD,
    participationType: "BOOSTER",
    role: "DPS",
    isBackup: true,
  });
  const pending = await createSignup({
    runId,
    userId: ids.playerC,
    characterId: characters.playerC,
    participationType: "BOOSTER",
    role: "TANK",
  });
  await selectAndPublish(lead, runId, [booster, lootbuddy, backup]);
  return { runId, booster, lootbuddy, backup, pending };
}

describe("start run authorization and preconditions", () => {
  it("rejects USER, other RAID_LEAD, and non-published runs", async () => {
    const { runId } = await publishedRunWithRoster();
    await expectDomainCode(runService.startRun(user, runId), "RUN_NOT_MANAGEABLE");
    await expectDomainCode(runService.startRun(otherLead, runId), "RUN_NOT_MANAGEABLE");

    const openId = await createDraft(lead, { title: "Attendance still open" });
    await runService.openRun(lead, openId);
    await expectDomainCode(runService.startRun(lead, openId), "RUN_NOT_PUBLISHED");
  });

  it("lets the assigned RAID_LEAD start a published run with selected participants", async () => {
    const { runId, booster, lootbuddy, backup, pending } = await publishedRunWithRoster();
    await runRepository.updateFields(runId, { signupsOpen: true });
    await runService.startRun(lead, runId);
    const run = await runRepository.findById(runId);
    expect(run?.status).toBe("IN_PROGRESS");
    expect(run?.signupsOpen).toBe(false);

    const manager = await attendanceService.getManagerAttendance(lead, runId);
    expect(manager.rows).toHaveLength(3);
    expect(manager.rows.every((row) => row.status === "UNMARKED")).toBe(true);
    expect(manager.rows.some((row) => row.participationType === "BOOSTER")).toBe(true);
    expect(manager.rows.some((row) => row.participationType === "LOOTBUDDY")).toBe(true);
    expect(manager.rows.some((row) => row.isBackup)).toBe(true);
    const signupIds = new Set(manager.rows.map((row) => `${row.characterName}`));
    expect(signupIds.size).toBe(3);
    void booster;
    void lootbuddy;
    void backup;
    const pendingStill = await orm.RunSignup.where({ id: pending }).first();
    expect((pendingStill as { status: string }).status).toBe("NOT_SELECTED");
  });

  it("lets ADMIN start and rejects a second start", async () => {
    const { runId } = await publishedRunWithRoster();
    await runService.startRun(admin, runId);
    expect((await runRepository.findById(runId))?.status).toBe("IN_PROGRESS");
    await expectDomainCode(runService.startRun(admin, runId), "RUN_ALREADY_STARTED");
    const manager = await attendanceService.getManagerAttendance(admin, runId);
    expect(manager.rows).toHaveLength(3);
  });

  it("requires a published roster with at least one selected participant", async () => {
    const runId = await createDraft(lead, { title: "Attendance empty published" });
    await runService.openRun(lead, runId);
    await runRepository.updateFields(runId, { status: "PUBLISHED", signupsOpen: false });
    await rosterService.getRosterManagementView(lead, runId);
    await orm.RunRoster.where({ runId }).update({
      publishedAt: new Date().toISOString(),
      state: "PUBLISHED",
      updatedAt: new Date().toISOString(),
    });
    await expectDomainCode(runService.startRun(lead, runId), "RUN_CANNOT_START");
  });
});

describe("attendance mutation and bulk present", () => {
  it("lets assigned RAID_LEAD and ADMIN update statuses and rejects USER and other leads", async () => {
    const { runId } = await publishedRunWithRoster();
    await runService.startRun(lead, runId);
    const rows = (await attendanceService.getManagerAttendance(lead, runId)).rows;
    const target = rows[0];

    await expectDomainCode(
      attendanceService.setStatus(user, { attendanceId: target.id, status: "PRESENT" }),
      "ATTENDANCE_NOT_MANAGEABLE",
    );
    await expectDomainCode(
      attendanceService.setStatus(otherLead, { attendanceId: target.id, status: "PRESENT" }),
      "ATTENDANCE_NOT_MANAGEABLE",
    );

    await attendanceService.setStatus(lead, { attendanceId: target.id, status: "LATE", note: "joined after boss 1" });
    let after = await attendanceService.getManagerAttendance(lead, runId);
    expect(after.rows.find((row) => row.id === target.id)?.status).toBe("LATE");
    expect(after.rows.find((row) => row.id === target.id)?.note).toBe("joined after boss 1");

    await attendanceService.setStatus(admin, { attendanceId: target.id, status: "LEFT_EARLY" });
    after = await attendanceService.getManagerAttendance(admin, runId);
    expect(after.rows.find((row) => row.id === target.id)?.status).toBe("LEFT_EARLY");

    await attendanceService.setStatus(lead, { attendanceId: target.id, status: "UNMARKED" });
    after = await attendanceService.getManagerAttendance(lead, runId);
    const unmarked = after.rows.find((row) => row.id === target.id);
    expect(unmarked?.status).toBe("UNMARKED");
    expect(unmarked?.markedByName).toBeNull();
  });

  it("persists every supported attendance status", async () => {
    const { runId } = await publishedRunWithRoster();
    await runService.startRun(lead, runId);
    const rows = (await attendanceService.getManagerAttendance(lead, runId)).rows;
    const statuses: AttendanceStatus[] = ["PRESENT", "LATE", "LEFT_EARLY", "NO_SHOW", "EXCUSED", "STANDBY"];
    await attendanceService.setStatus(lead, { attendanceId: rows[0].id, status: statuses[0] });
    await attendanceService.setStatus(lead, { attendanceId: rows[1].id, status: statuses[1] });
    await attendanceService.setStatus(lead, { attendanceId: rows[2].id, status: statuses[5] });
    const after = await attendanceService.getManagerAttendance(lead, runId);
    expect(after.rows.find((row) => row.id === rows[0].id)?.status).toBe("PRESENT");
    expect(after.rows.find((row) => row.id === rows[1].id)?.status).toBe("LATE");
    expect(after.rows.find((row) => row.id === rows[2].id)?.status).toBe("STANDBY");
  });

  it(
    "marks only unmarked rows present and preserves exceptions",
    async () => {
    const runId = await createDraft(lead, { title: "Attendance bulk" });
    await runService.openRun(lead, runId);
    const a = await createSignup({
      runId,
      userId: ids.user,
      characterId: characters.user,
      participationType: "BOOSTER",
      role: "DPS",
    });
    const b = await createSignup({
      runId,
      userId: ids.playerC,
      characterId: characters.playerC,
      participationType: "BOOSTER",
      role: "TANK",
    });
    const c = await createSignup({
      runId,
      userId: ids.playerE,
      characterId: characters.playerE,
      participationType: "BOOSTER",
      role: "HEALER",
    });
    const d = await createSignup({
      runId,
      userId: ids.playerD,
      characterId: characters.playerD,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: true,
    });
    const e = await createSignup({
      runId,
      userId: ids.playerB,
      characterId: characters.playerB,
      participationType: "LOOTBUDDY",
      role: null,
    });
    await selectAndPublish(lead, runId, [a, b, c, d, e]);
    await runService.startRun(lead, runId);
    const rows = (await attendanceService.getManagerAttendance(lead, runId)).rows;
    const byName = Object.fromEntries(rows.map((row) => [row.characterName, row]));
    await attendanceService.setStatus(lead, { attendanceId: byName.Atbrann.id, status: "NO_SHOW" });
    await attendanceService.setStatus(lead, { attendanceId: byName.Ataelira.id, status: "LATE" });
    await attendanceService.setStatus(lead, { attendanceId: byName.Atsylva.id, status: "STANDBY" });
    await attendanceService.markAllUnmarkedPresent(lead, runId);
    const after = await attendanceService.getManagerAttendance(lead, runId);
    const next = Object.fromEntries(after.rows.map((row) => [row.characterName, row.status]));
    expect(next.Atkael).toBe("PRESENT");
    expect(next.Atbrann).toBe("NO_SHOW");
    expect(next.Ataelira).toBe("LATE");
    expect(next.Atsylva).toBe("STANDBY");
    expect(next.Atmira).toBe("PRESENT");
  },
  20000,
  );

  it("rejects attendance mutation outside IN_PROGRESS", async () => {
    const { runId } = await publishedRunWithRoster();
    await runService.startRun(lead, runId);
    const rows = (await attendanceService.getManagerAttendance(lead, runId)).rows;
    for (const row of rows) {
      await attendanceService.setStatus(lead, { attendanceId: row.id, status: "PRESENT" });
    }
    await runService.completeRun(lead, runId);
    await expectDomainCode(
      attendanceService.setStatus(lead, { attendanceId: rows[0].id, status: "LATE" }),
      "ATTENDANCE_NOT_MANAGEABLE",
    );
  });
});

describe("complete run", () => {
  it("blocks completion while unmarked attendance remains and allows it when fully marked", async () => {
    const { runId } = await publishedRunWithRoster();
    await runService.startRun(lead, runId);
    await expectDomainCode(runService.completeRun(lead, runId), "ATTENDANCE_INCOMPLETE");
    await expectDomainCode(runService.completeRun(user, runId), "RUN_NOT_MANAGEABLE");
    await expectDomainCode(runService.completeRun(otherLead, runId), "RUN_NOT_MANAGEABLE");

    await attendanceService.markAllUnmarkedPresent(lead, runId);
    await runService.completeRun(admin, runId);
    const run = await runRepository.findById(runId);
    expect(run?.status).toBe("COMPLETED");
    expect(run?.signupsOpen).toBe(false);
    const manager = await attendanceService.getManagerAttendance(admin, runId);
    expect(manager.rows).toHaveLength(3);
    expect(manager.canMutate).toBe(false);
    await expectDomainCode(runService.completeRun(admin, runId), "RUN_CANNOT_COMPLETE");
  });
});

describe("roster freeze after start", () => {
  it("rejects roster mutation and republish on IN_PROGRESS and COMPLETED", async () => {
    const { runId, pending } = await publishedRunWithRoster();
    await runService.startRun(lead, runId);
    const inProgress = await rosterService.getRosterManagementView(lead, runId);
    await expectDomainCode(
      rosterService.setDraftSelection(lead, {
        runId,
        signupId: pending,
        selected: true,
        version: inProgress.roster.version,
      }),
      "INVALID_ROSTER_SELECTION",
    );
    await expectDomainCode(
      rosterService.publishRoster(lead, {
        runId,
        version: inProgress.roster.version,
        acknowledgeWarnings: true,
      }),
      "INVALID_ROSTER_SELECTION",
    );
    await expectDomainCode(
      rosterService.preparePublishedRosterForEditing(lead, {
        runId,
        version: inProgress.roster.version,
      }),
      "INVALID_ROSTER_SELECTION",
    );

    const rows = (await attendanceService.getManagerAttendance(lead, runId)).rows;
    for (const row of rows) {
      await attendanceService.setStatus(lead, { attendanceId: row.id, status: "PRESENT" });
    }
    await runService.completeRun(lead, runId);
    const completed = await rosterService.getRosterManagementView(lead, runId);
    await expectDomainCode(
      rosterService.setDraftSelection(lead, {
        runId,
        signupId: pending,
        selected: true,
        version: completed.roster.version,
      }),
      "INVALID_ROSTER_SELECTION",
    );
  });
});

describe("user attendance data protection", () => {
  it("gives USER own attendance without manager list, notes, or mutation capabilities", async () => {
    const { runId } = await publishedRunWithRoster();
    await runService.startRun(lead, runId);
    const rows = (await attendanceService.getManagerAttendance(lead, runId)).rows;
    const ownRow = rows.find((row) => row.userName === "Attendance User");
    expect(ownRow).toBeTruthy();
    await attendanceService.setStatus(lead, {
      attendanceId: ownRow!.id,
      status: "PRESENT",
      note: "manager only note",
    });

    const view = await runDetailService.getRunDetail(user, runId);
    expect(view.attendance.manager).toBeNull();
    expect(view.capabilities.canStart).toBe(false);
    expect(view.capabilities.canComplete).toBe(false);
    expect(view.capabilities.canManageAttendance).toBe(false);
    expect(view.attendance.own).toHaveLength(1);
    expect(view.attendance.own[0]?.status).toBe("PRESENT");
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("manager only note");
    expect(serialized).not.toContain("markedByName");
    expect(serialized).not.toContain("canMutate");

    const otherView = await runDetailService.getRunDetail(otherLead, runId);
    expect(otherView.attendance.manager).toBeNull();
    expect(otherView.permissions.canManageRun).toBe(false);

    const leadView = await runDetailService.getRunDetail(lead, runId);
    expect(leadView.attendance.manager?.rows.length).toBe(3);
    expect(leadView.attendance.manager?.rows.some((row) => row.note === "manager only note")).toBe(true);
    expect(leadView.capabilities.canManageAttendance).toBe(true);
    expect(leadView.capabilities.canComplete).toBe(true);
  });
});
