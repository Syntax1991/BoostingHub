import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { attendanceRepository } from "@/repositories/attendance.repository";
import { strikeRepository } from "@/repositories/strike.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { strikeService } from "@/services/strike.service";
import type { ParticipationType } from "@/models/enums";

const raidId = WOW_RAID_CATALOG[0].id;
const ids = {
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-sk0000000001",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-sk0000000002",
  otherLead: "aaaaaaaa-aaaa-4aaa-8aaa-sk0000000003",
  target: "aaaaaaaa-aaaa-4aaa-8aaa-sk0000000004",
  unrelated: "aaaaaaaa-aaaa-4aaa-8aaa-sk0000000005",
  plainUser: "aaaaaaaa-aaaa-4aaa-8aaa-sk0000000006",
};
const createdUserIds = Object.values(ids);
const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdStrikeIds: string[] = [];

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"] = "USER"): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@sktest.boostting.local`,
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
    email: `${id}@sktest.boostting.local`,
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
    else if (table === "RunAttendance") await orm.RunAttendance.where({ id }).delete();
    else if (table === "Run") await orm.Run.where({ id }).delete();
    else if (table === "Strike") await orm.Strike.where({ id }).delete();
    else if (table === "BoosterQualification") await orm.BoosterQualification.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

function futureIso(days = 10) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function createCharacter(userId: string, name: string) {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  await orm.Character.create({
    id,
    userId,
    name,
    realm: "Strike Lab",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity("Strike Lab"),
    region: "EU",
    wowClass: "WARRIOR",
    specialization: "Fury",
    primaryRole: "DPS",
    itemLevel: 700,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function createSignup(input: {
  runId: string;
  userId: string;
  characterId: string;
  participationType: ParticipationType;
}) {
  const id = crypto.randomUUID();
  await orm.RunSignup.create({
    id,
    runId: input.runId,
    userId: input.userId,
    characterId: input.characterId,
    participationType: input.participationType,
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

const admin = asUser(ids.admin, "Strike Admin", "ADMIN");
const lead = asUser(ids.lead, "Strike Lead", "RAID_LEAD");
const target = asUser(ids.target, "Strike Target");
const plainUser = asUser(ids.plainUser, "Strike Plain User");

let labRunId = "";
let otherRunId = "";
let targetCharacterId = "";
let labAttendanceId = "";

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const userId of createdUserIds) {
    const runs = await orm.Run.where({ raidLeadId: userId }).select("id").all();
    for (const row of runs) {
      await cleanupRun((row as { id: string }).id);
    }
    const strikes = await orm.Strike.where({ userId }).select("id").all();
    for (const row of strikes) {
      await deleteIfPresent("Strike", (row as { id: string }).id);
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
  await createTestUser(ids.admin, "Strike Admin", "ADMIN");
  await createTestUser(ids.lead, "Strike Lead", "RAID_LEAD");
  await createTestUser(ids.otherLead, "Strike Other Lead", "RAID_LEAD");
  await createTestUser(ids.target, "Strike Target", "USER");
  await createTestUser(ids.unrelated, "Strike Unrelated", "USER");
  await createTestUser(ids.plainUser, "Strike Plain User", "USER");

  targetCharacterId = await createCharacter(ids.target, "Skstriketarget");
  await orm.BoosterQualification.create({
    id: crypto.randomUUID(),
    userId: ids.target,
    difficulty: "HEROIC",
    status: "APPROVED",
    notes: "Strike test grant",
    grantedAt: new Date().toISOString(),
    grantedById: ids.admin,
    revokedAt: null,
    revokedById: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  labRunId = await runService.createRun(lead, {
    raidId,
    difficulty: "HEROIC",
    scheduledStartAt: futureIso(),
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
  }).then((run) => run.id);
  createdRunIds.push(labRunId);
  await runService.openRun(lead, labRunId);
  const signupId = await createSignup({
    runId: labRunId,
    userId: ids.target,
    characterId: targetCharacterId,
    participationType: "BOOSTER",
  });

  const draft = await rosterService.getRosterManagementView(lead, labRunId);
  await rosterService.setDraftSelection(lead, {
    runId: labRunId,
    signupId,
    selected: true,
    version: draft.roster.version,
  });
  const ready = await rosterService.getRosterManagementView(lead, labRunId);
  await rosterService.publishRoster(lead, {
    runId: labRunId,
    version: ready.roster.version,
    acknowledgeWarnings: true,
  });
  await runService.startRun(lead, labRunId);
  const attendance = await attendanceRepository.listByRunId(labRunId);
  labAttendanceId = attendance.find((row) => row.userId === ids.target)!.id;

  otherRunId = await runService.createRun(admin, {
    raidId,
    difficulty: "HEROIC",
    scheduledStartAt: futureIso(),
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    raidLeadId: ids.otherLead,
  }).then((run) => run.id);
  createdRunIds.push(otherRunId);
}, 60_000);

afterAll(async () => {
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const id of createdStrikeIds) {
    await deleteIfPresent("Strike", id);
  }
  const quals = await orm.BoosterQualification.where({ userId: ids.target }).select("id").all();
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

describe("strikeService.create", () => {
  it("ADMIN creates a general (user-only) strike", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      reason: "General staff note",
    });
    createdStrikeIds.push(created.id);
    expect(created.runId).toBeNull();
    expect(created.status).toBe("ACTIVE");
    expect(created.userId).toBe(ids.target);
  });

  it("ADMIN creates a run-linked strike for an associated user", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      runId: labRunId,
      reason: "No-show without notice",
    });
    createdStrikeIds.push(created.id);
    expect(created.runId).toBe(labRunId);
    expect(created.runTitle).toBeTruthy();
  });

  it("RAID_LEAD creates a strike for a user associated with their own run", async () => {
    const created = await strikeService.create(lead, {
      userId: ids.target,
      runId: labRunId,
      reason: "Late without notice",
    });
    createdStrikeIds.push(created.id);
    expect(created.status).toBe("ACTIVE");
  });

  it("RAID_LEAD is blocked from creating a strike on a run they do not manage", async () => {
    await expectDomainCode(
      strikeService.create(lead, {
        userId: ids.target,
        runId: otherRunId,
        reason: "Not their run",
      }),
      "STRIKE_NOT_MANAGEABLE",
    );
  });

  it("RAID_LEAD is blocked from creating a user-only strike (no run)", async () => {
    await expectDomainCode(
      strikeService.create(lead, {
        userId: ids.target,
        reason: "General note",
      }),
      "STRIKE_RUN_REQUIRED",
    );
  });

  it("RAID_LEAD is blocked when the target user has no signup history on their run", async () => {
    await expectDomainCode(
      strikeService.create(lead, {
        userId: ids.unrelated,
        runId: labRunId,
        reason: "Unrelated user",
      }),
      "STRIKE_USER_NOT_ASSOCIATED",
    );
  });

  it("USER cannot create a strike", async () => {
    await expectDomainCode(
      strikeService.create(plainUser, {
        userId: ids.target,
        reason: "Should be rejected",
      }),
      "STRIKE_NOT_MANAGEABLE",
    );
  });

  it("rejects an attendance id that does not exist", async () => {
    await expectDomainCode(
      strikeService.create(admin, {
        attendanceId: "00000000-0000-4000-8000-000000000000",
        reason: "Bad attendance",
      }),
      "STRIKE_ATTENDANCE_MISMATCH",
    );
  });

  it("derives userId and runId from attendance, ignoring conflicting client input", async () => {
    const created = await strikeService.create(lead, {
      userId: ids.unrelated,
      runId: otherRunId,
      attendanceId: labAttendanceId,
      reason: "Derived from attendance",
    });
    createdStrikeIds.push(created.id);
    expect(created.userId).toBe(ids.target);
    expect(created.runId).toBe(labRunId);
    expect(created.attendanceId).toBe(labAttendanceId);
  });
});

describe("strikeService.revoke", () => {
  it("ADMIN revoke succeeds with a required reason and preserves the row", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      reason: "To be revoked",
    });
    createdStrikeIds.push(created.id);

    const revoked = await strikeService.revoke(admin, created.id, "Staff correction");
    expect(revoked.status).toBe("REVOKED");
    expect(revoked.revokedById).toBe(ids.admin);
    expect(revoked.revokedReason).toBe("Staff correction");
    expect(revoked.revokedAt).toBeTruthy();

    const stillThere = await strikeRepository.findById(created.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere?.status).toBe("REVOKED");
  });

  it("rejects revoke without a reason", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      reason: "Needs reason to revoke",
    });
    createdStrikeIds.push(created.id);
    await expectDomainCode(strikeService.revoke(admin, created.id, "   "), "VALIDATION_FAILED");
  });

  it("RAID_LEAD cannot revoke a strike, including one they created", async () => {
    const created = await strikeService.create(lead, {
      userId: ids.target,
      runId: labRunId,
      reason: "Created by lead",
    });
    createdStrikeIds.push(created.id);
    await expectDomainCode(strikeService.revoke(lead, created.id, "Trying anyway"), "STRIKE_REVOKE_FORBIDDEN");
  });

  it("rejects revoking an already-revoked strike", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      reason: "Double revoke",
    });
    createdStrikeIds.push(created.id);
    await strikeService.revoke(admin, created.id, "First revoke");
    await expectDomainCode(strikeService.revoke(admin, created.id, "Second revoke"), "STRIKE_ALREADY_REVOKED");
  });
});

describe("strikeService history preservation and visibility", () => {
  it("survives the target user's account role change", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      reason: "Role change survival",
    });
    createdStrikeIds.push(created.id);

    await orm.User.where({ id: ids.target }).update({ accountRole: "RAID_LEAD" });
    const stillThere = await strikeRepository.findById(created.id);
    expect(stillThere?.userId).toBe(ids.target);
    await orm.User.where({ id: ids.target }).update({ accountRole: "USER" });
  });

  it("survives the target user's character deactivation", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      reason: "Character deactivation survival",
    });
    createdStrikeIds.push(created.id);

    await orm.Character.where({ id: targetCharacterId }).update({ isActive: false });
    const stillThere = await strikeRepository.findById(created.id);
    expect(stillThere?.userId).toBe(ids.target);
    await orm.Character.where({ id: targetCharacterId }).update({ isActive: true });
  });

  it("USER may read their own strike history without internal notes", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      reason: "Own history visible",
      notes: "Internal-only detail",
    });
    createdStrikeIds.push(created.id);

    const own = await strikeService.listOwn(target);
    const row = own.find((entry) => entry.id === created.id);
    expect(row).toBeTruthy();
    expect(row && "notes" in row).toBe(false);
  });

  it("USER cannot read another user's strike history", async () => {
    await expectDomainCode(strikeService.listForUser(plainUser, ids.target), "NOT_AUTHORIZED");
  });
});
