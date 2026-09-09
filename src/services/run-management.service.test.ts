import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { runDetailService } from "@/services/run-detail.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";

const raidId = WOW_RAID_CATALOG[0].id;
const ids = {
  user: "aaaaaaaa-aaaa-4aaa-8aaa-rm0000000001",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-rm0000000002",
  otherLead: "aaaaaaaa-aaaa-4aaa-8aaa-rm0000000003",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-rm0000000004",
  character: "aaaaaaaa-aaaa-4aaa-8aaa-rmc000000001",
  access: "aaaaaaaa-aaaa-4aaa-8aaa-rma000000001",
};

const createdRunIds: string[] = [];
const createdSignupIds: string[] = [];

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@rmtest.boostting.local`,
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
    email: `${id}@rmtest.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function deleteIfPresent(table: "User" | "Character" | "RunSignup" | "BoosterAccess" | "Run", id: string) {
  try {
    if (table === "User") await orm.User.where({ id }).delete();
    else if (table === "Character") await orm.Character.where({ id }).delete();
    else if (table === "RunSignup") await orm.RunSignup.where({ id }).delete();
    else if (table === "BoosterAccess") await orm.BoosterAccess.where({ id }).delete();
    else await orm.Run.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

function futureIso(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
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

const user = asUser(ids.user, "Runmgmt User");
const lead = asUser(ids.lead, "Runmgmt Lead", "RAID_LEAD");
const otherLead = asUser(ids.otherLead, "Runmgmt Other Lead", "RAID_LEAD");
const admin = asUser(ids.admin, "Runmgmt Admin", "ADMIN");

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const id of [ids.user, ids.lead, ids.otherLead, ids.admin, ids.character, ids.access]) {
    await deleteIfPresent("RunSignup", id);
    await deleteIfPresent("BoosterAccess", id);
    await deleteIfPresent("Character", id);
    await deleteIfPresent("User", id);
  }
  await createTestUser(ids.user, "Runmgmt User", "USER");
  await createTestUser(ids.lead, "Runmgmt Lead", "RAID_LEAD");
  await createTestUser(ids.otherLead, "Runmgmt Other Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "Runmgmt Admin", "ADMIN");
});

afterAll(async () => {
  for (const id of createdSignupIds) {
    await deleteIfPresent("RunSignup", id);
  }
  for (const id of createdRunIds) {
    const roster = await orm.RunRoster.where({ runId: id }).first();
    if (roster) {
      const rosterId = (roster as { id: string }).id;
      const entries = await orm.RunRosterEntry.where({ rosterId }).all();
      for (const entry of entries) {
        await orm.RunRosterEntry.where({ id: (entry as { id: string }).id }).delete();
      }
      await orm.RunRoster.where({ id: rosterId }).delete();
    }
    await deleteIfPresent("Run", id);
  }
  await deleteIfPresent("BoosterAccess", ids.access);
  await deleteIfPresent("Character", ids.character);
  await deleteIfPresent("User", ids.user);
  await deleteIfPresent("User", ids.lead);
  await deleteIfPresent("User", ids.otherLead);
  await deleteIfPresent("User", ids.admin);
});

describe("run creation authorization", () => {
  it("rejects USER create", async () => {
    await expectDomainCode(
      runService.createRun(user, {
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
      "NOT_AUTHORIZED",
    );
  });

  it("lets a RAID_LEAD create a self-led draft", async () => {
    const id = await createDraft(lead, { title: "Self-led draft" });
    const run = await runRepository.findById(id);
    expect(run?.status).toBe("DRAFT");
    expect(run?.signupsOpen).toBe(false);
    expect(run?.raidLeadId).toBe(ids.lead);
    expect(run?.title).toBe("Self-led draft");
    const roster = await orm.RunRoster.where({ runId: id }).first();
    expect(roster).toBeTruthy();
    expect((roster as { state: string }).state).toBe("DRAFT");
  });

  it("rejects a RAID_LEAD forging another raidLeadId", async () => {
    await expectDomainCode(
      runService.createRun(lead, {
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 1,
        raidLeadId: ids.otherLead,
      }),
      "RUN_RAID_LEAD_INVALID",
    );
  });

  it("lets ADMIN assign an eligible raid lead and rejects a USER lead", async () => {
    const id = await createDraft(admin, { raidLeadId: ids.lead, title: "Admin assigned" });
    const run = await runRepository.findById(id);
    expect(run?.raidLeadId).toBe(ids.lead);

    await expectDomainCode(
      runService.createRun(admin, {
        raidId,
        difficulty: "NORMAL",
        scheduledStartAt: futureIso(),
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 1,
        raidLeadId: ids.user,
      }),
      "RUN_RAID_LEAD_INVALID",
    );
  });
});

describe("run creation domain", () => {
  it("rejects an invalid schedule and negative composition", async () => {
    await expectDomainCode(
      runService.createRun(lead, {
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: "not-a-date",
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
      "RUN_SCHEDULE_INVALID",
    );
    await expectDomainCode(
      runService.createRun(lead, {
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
      "RUN_SCHEDULE_INVALID",
    );
    await expectDomainCode(
      runService.createRun(lead, {
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: -1,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
      "VALIDATION_FAILED",
    );
  });

  it("defaults title from raid and difficulty", async () => {
    const id = await createDraft(lead, { title: undefined });
    const run = await runRepository.findById(id);
    expect(run?.title).toContain("Manaforge Omega");
    expect(run?.raidId).toBe(raidId);
    expect(run?.difficulty).toBe("HEROIC");
  });
});

describe("draft visibility", () => {
  it("hides DRAFT from USER discovery and detail", async () => {
    const id = await createDraft(lead, { title: "Hidden draft" });
    const listed = await runService.listRuns(user);
    expect(listed.some((run) => run.id === id)).toBe(false);
    await expectDomainCode(runDetailService.getRunDetail(user, id), "NOT_FOUND");

    const assigned = await runDetailService.getRunDetail(lead, id);
    expect(assigned.permissions.canManageRun).toBe(true);
    const asAdmin = await runDetailService.getRunDetail(admin, id);
    expect(asAdmin.permissions.canManageRun).toBe(true);
  });
});

describe("open run", () => {
  it("opens a draft atomically with signups and rejects invalid callers", async () => {
    const id = await createDraft(lead, { title: "Open me" });
    await expectDomainCode(runService.openRun(user, id), "RUN_NOT_MANAGEABLE");
    await expectDomainCode(runService.openRun(otherLead, id), "RUN_NOT_MANAGEABLE");

    await runService.openRun(lead, id);
    const opened = await runRepository.findById(id);
    expect(opened?.status).toBe("OPEN");
    expect(opened?.signupsOpen).toBe(true);

    await expectDomainCode(runService.openRun(lead, id), "RUN_ALREADY_OPEN");
  });
});

describe("edit run", () => {
  it("lets DRAFT and OPEN-without-signups change identity, then locks after signup history", async () => {
    const id = await createDraft(lead, { title: "Editable" });
    await runService.updateRun(lead, {
      runId: id,
      title: "Edited draft",
      raidId,
      difficulty: "MYTHIC",
      scheduledStartAt: futureIso(8),
      desiredTankCount: 3,
      desiredHealerCount: 5,
      desiredDpsCount: 12,
    });
    let run = await runRepository.findById(id);
    expect(run?.title).toBe("Edited draft");
    expect(run?.difficulty).toBe("MYTHIC");
    expect(run?.desiredTankCount).toBe(3);

    await runService.openRun(lead, id);
    await runService.updateRun(lead, {
      runId: id,
      title: "Still identity-editable",
      raidId,
      difficulty: "NORMAL",
      scheduledStartAt: futureIso(9),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    run = await runRepository.findById(id);
    expect(run?.difficulty).toBe("NORMAL");

    const signupId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: signupId,
      runId: id,
      userId: ids.user,
      characterId: null,
      participationType: "LOOTBUDDY",
      role: null,
      isBackup: false,
      status: "WITHDRAWN",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    createdSignupIds.push(signupId);

    await expectDomainCode(
      runService.updateRun(lead, {
        runId: id,
        title: "Locked identity",
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(10),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
      "RUN_IDENTITY_LOCKED",
    );

    await runService.updateRun(lead, {
      runId: id,
      title: "Schedule still editable",
      raidId,
      difficulty: "NORMAL",
      scheduledStartAt: futureIso(11),
      desiredTankCount: 1,
      desiredHealerCount: 2,
      desiredDpsCount: 8,
    });
    run = await runRepository.findById(id);
    expect(run?.title).toBe("Schedule still editable");
    expect(run?.difficulty).toBe("NORMAL");
    expect(run?.desiredTankCount).toBe(1);
    expect(await runRepository.countSignups(id)).toBe(1);
  });

  it("rejects planning edits after publish and cross-lead mutation", async () => {
    const id = await createDraft(lead, { title: "Publish lock" });
    await runRepository.updateFields(id, { status: "PUBLISHED", signupsOpen: false });
    await expectDomainCode(
      runService.updateRun(lead, {
        runId: id,
        title: "Nope",
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
      "RUN_EDIT_LOCKED",
    );

    const otherId = await createDraft(otherLead, { title: "Other lead run" });
    await expectDomainCode(
      runService.updateRun(lead, {
        runId: otherId,
        title: "Stolen",
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
      "RUN_NOT_MANAGEABLE",
    );

    await runService.updateRun(admin, {
      runId: otherId,
      title: "Admin can edit",
      raidId,
      difficulty: "HEROIC",
      scheduledStartAt: futureIso(),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    expect((await runRepository.findById(otherId))?.title).toBe("Admin can edit");
  });
});

describe("raid lead reassignment", () => {
  it("blocks RAID_LEAD reassignment and allows ADMIN before publish", async () => {
    const id = await createDraft(lead, { title: "Reassign me" });
    await runService.openRun(lead, id);
    await expectDomainCode(
      runService.updateRun(lead, {
        runId: id,
        title: "Reassign me",
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        raidLeadId: ids.otherLead,
      }),
      "RUN_RAID_LEAD_INVALID",
    );

    await runService.updateRun(admin, {
      runId: id,
      title: "Reassign me",
      raidId,
      difficulty: "HEROIC",
      scheduledStartAt: futureIso(),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.otherLead,
    });
    expect((await runRepository.findById(id))?.raidLeadId).toBe(ids.otherLead);
    expect((await runDetailService.getRunDetail(lead, id)).permissions.canManageRun).toBe(false);
    expect((await runDetailService.getRunDetail(otherLead, id)).permissions.canManageRun).toBe(true);

    await expectDomainCode(
      runService.updateRun(admin, {
        runId: id,
        title: "Reassign me",
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        raidLeadId: ids.user,
      }),
      "RUN_RAID_LEAD_INVALID",
    );

    await runRepository.updateFields(id, { status: "PUBLISHED" });
    await expectDomainCode(
      runService.updateRun(admin, {
        runId: id,
        title: "Reassign me",
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        raidLeadId: ids.lead,
      }),
      "RUN_EDIT_LOCKED",
    );
  });
});

describe("signup window", () => {
  it("closes and reopens independently of status while preserving signups", async () => {
    const id = await createDraft(lead, { title: "Window" });
    await expectDomainCode(runService.setSignupWindow(lead, id, true), "RUN_INVALID_TRANSITION");
    await runService.openRun(lead, id);

    const signupId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: signupId,
      runId: id,
      userId: ids.user,
      participationType: "LOOTBUDDY",
      isBackup: false,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    createdSignupIds.push(signupId);

    await runService.setSignupWindow(lead, id, false);
    let run = await runRepository.findById(id);
    expect(run?.status).toBe("OPEN");
    expect(run?.signupsOpen).toBe(false);
    await expectDomainCode(runService.setSignupWindow(lead, id, false), "RUN_SIGNUPS_ALREADY_CLOSED");

    await runService.setSignupWindow(lead, id, true);
    run = await runRepository.findById(id);
    expect(run?.signupsOpen).toBe(true);

    await runRepository.updateFields(id, { status: "ROSTERING" });
    await runService.setSignupWindow(lead, id, false);
    await runService.setSignupWindow(lead, id, true);
    expect((await runRepository.findById(id))?.status).toBe("ROSTERING");
    expect(await runRepository.countSignups(id)).toBe(1);

    await runRepository.updateFields(id, { status: "PUBLISHED", signupsOpen: false });
    await expectDomainCode(runService.setSignupWindow(lead, id, true), "RUN_INVALID_TRANSITION");
    await runRepository.updateFields(id, { status: "CANCELLED" });
    await expectDomainCode(runService.setSignupWindow(lead, id, true), "RUN_INVALID_TRANSITION");
  });
});

describe("cancel run", () => {
  it("cancels allowed states, closes signups, and preserves history", async () => {
    const draftId = await createDraft(lead, { title: "Cancel draft" });
    await runService.cancelRun(lead, draftId);
    expect((await runRepository.findById(draftId))?.status).toBe("CANCELLED");
    await expectDomainCode(runService.cancelRun(lead, draftId), "RUN_CANNOT_CANCEL");

    const openId = await createDraft(lead, { title: "Cancel open" });
    await runService.openRun(lead, openId);
    const signupId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: signupId,
      runId: openId,
      userId: ids.user,
      participationType: "LOOTBUDDY",
      isBackup: false,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    createdSignupIds.push(signupId);
    await runService.cancelRun(admin, openId);
    const cancelled = await runRepository.findById(openId);
    expect(cancelled?.status).toBe("CANCELLED");
    expect(cancelled?.signupsOpen).toBe(false);
    expect(await runRepository.countSignups(openId)).toBe(1);

    const rosteringId = await createDraft(lead, { title: "Cancel rostering" });
    await runRepository.updateFields(rosteringId, { status: "ROSTERING", signupsOpen: true });
    await runService.cancelRun(lead, rosteringId);
    expect((await runRepository.findById(rosteringId))?.status).toBe("CANCELLED");

    const publishedId = await createDraft(lead, { title: "Cancel published" });
    await runRepository.updateFields(publishedId, { status: "PUBLISHED", signupsOpen: false });
    await runService.cancelRun(lead, publishedId);
    expect((await runRepository.findById(publishedId))?.status).toBe("CANCELLED");

    const inProgressId = await createDraft(lead, { title: "No cancel in progress" });
    await runRepository.updateFields(inProgressId, { status: "IN_PROGRESS" });
    await expectDomainCode(runService.cancelRun(lead, inProgressId), "RUN_CANNOT_CANCEL");

    const completedId = await createDraft(lead, { title: "No cancel completed" });
    await runRepository.updateFields(completedId, { status: "COMPLETED" });
    await expectDomainCode(runService.cancelRun(lead, completedId), "RUN_CANNOT_CANCEL");
  }, 15_000);
});

describe("opened run signup integration", () => {
  it("lets an eligible user signup after Open Run and keeps DRAFT closed", async () => {
    const now = new Date().toISOString();
    await orm.Character.create({
      id: ids.character,
      userId: ids.user,
      name: "Runmgmtpal",
      realm: "Runmgmtrealm",
      normalizedName: normalizeCharacterIdentity("Runmgmtpal"),
      normalizedRealm: normalizeCharacterIdentity("Runmgmtrealm"),
      region: "EU",
      wowClass: "PALADIN",
      specialization: "Protection",
      primaryRole: "TANK",
      itemLevel: 700,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await orm.BoosterAccess.create({
      id: ids.access,
      userId: ids.user,
      characterId: ids.character,
      wowClass: "PALADIN",
      role: "TANK",
      difficulty: "HEROIC",
      status: "APPROVED",
      approvedAt: now,
      approvedById: ids.admin,
      reviewedAt: now,
      reviewedById: ids.admin,
      createdAt: now,
      updatedAt: now,
    });

    const draftId = await createDraft(lead, { title: "Signup closed draft" });
    await expectDomainCode(
      signupService.createBoosterSignup(user, {
        runId: draftId,
        characterId: ids.character,
        role: "TANK",
        isBackup: false,
      }),
      "SIGNUP_CLOSED",
    );

    const openId = await createDraft(lead, { title: "Signup open run" });
    await runService.openRun(lead, openId);
    const signup = await signupService.createBoosterSignup(user, {
      runId: openId,
      characterId: ids.character,
      role: "TANK",
      isBackup: false,
    });
    createdSignupIds.push(signup.id);
    expect(signup.revived).toBe(false);
  });
});

describe("raid reference bootstrap", () => {
  it("is idempotent and independent of demo runs", async () => {
    await raidRepository.ensureReferenceRaids();
    await raidRepository.ensureReferenceRaids();
    const raids = await raidRepository.listActive();
    expect(raids.some((raid) => raid.id === raidId)).toBe(true);
    expect(raids.some((raid) => raid.name === "Manaforge Omega")).toBe(true);
  });
});
