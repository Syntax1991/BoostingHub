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

async function deleteIfPresent(table: "User" | "Character" | "RunSignup" | "BoosterAccess" | "BoosterQualification" | "Run", id: string) {
  try {
    if (table === "User") await orm.User.where({ id }).delete();
    else if (table === "Character") await orm.Character.where({ id }).delete();
    else if (table === "RunSignup") await orm.RunSignup.where({ id }).delete();
    else if (table === "BoosterAccess") await orm.BoosterAccess.where({ id }).delete();
    else if (table === "BoosterQualification") await orm.BoosterQualification.where({ id }).delete();
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

const user = asUser(ids.user, "Runmgmt User");
const lead = asUser(ids.lead, "Runmgmt Lead", "RAID_LEAD");
const otherLead = asUser(ids.otherLead, "Runmgmt Other Lead", "RAID_LEAD");
const admin = asUser(ids.admin, "Runmgmt Admin", "ADMIN");

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const id of [ids.user, ids.lead, ids.otherLead, ids.admin, ids.character, ids.access]) {
    await deleteIfPresent("RunSignup", id);
    await deleteIfPresent("BoosterAccess", id);
    await deleteIfPresent("BoosterQualification", id);
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
  await deleteIfPresent("BoosterQualification", ids.access);
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
        lootType: "UNSAVED",
        plannedBossCount: 8,
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
    expect(run?.title).not.toBe("Self-led draft");
    const roster = await orm.RunRoster.where({ runId: id }).first();
    expect(roster).toBeTruthy();
    expect((roster as { state: string }).state).toBe("DRAFT");
  });

  it("rejects a RAID_LEAD forging another raidLeadId", async () => {
    await expectDomainCode(
      runService.createRun(lead, {
        raidId,
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        plannedBossCount: 8,
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
        lootType: "UNSAVED",
        plannedBossCount: 8,
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
        lootType: "UNSAVED",
        plannedBossCount: 8,
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
        lootType: "UNSAVED",
        plannedBossCount: 8,
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
        lootType: "UNSAVED",
        plannedBossCount: 8,
        scheduledStartAt: futureIso(),
        desiredTankCount: -1,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
      "VALIDATION_FAILED",
    );
  });

  it("derives the title server-side from schedule/difficulty/lootType/bosses/raidLead — never trusts a client title", async () => {
    const id = await createDraft(lead, { title: "This should be ignored" });
    const run = await runRepository.findById(id);
    expect(run?.title).not.toBe("This should be ignored");
    expect(run?.title).toContain("HC");
    expect(run?.title).toContain("Unsaved");
    expect(run?.title).toContain("8/8");
    expect(run?.title).toContain("Runmgmt Lead");
    expect(run?.raidId).toBe(raidId);
    expect(run?.difficulty).toBe("HEROIC");
  });

  it("rejects MYTHIC + SAVED and accepts MYTHIC + UNSAVED / MYTHIC + VIP", async () => {
    await expectDomainCode(
      createDraft(lead, { difficulty: "MYTHIC", lootType: "SAVED" }),
      "RUN_LOOT_TYPE_INVALID",
    );
    const unsavedId = await createDraft(lead, { difficulty: "MYTHIC", lootType: "UNSAVED" });
    expect((await runRepository.findById(unsavedId))?.lootType).toBe("UNSAVED");
    const vipId = await createDraft(lead, { difficulty: "MYTHIC", lootType: "VIP" });
    expect((await runRepository.findById(vipId))?.lootType).toBe("VIP");
  });

  it("enforces plannedBossCount boundaries against the raid's total boss count", async () => {
    await expectDomainCode(createDraft(lead, { plannedBossCount: 0 }), "RUN_BOSS_COUNT_INVALID");
    await expectDomainCode(createDraft(lead, { plannedBossCount: 9 }), "RUN_BOSS_COUNT_INVALID");
    const id = await createDraft(lead, { plannedBossCount: 1 });
    expect((await runRepository.findById(id))?.plannedBossCount).toBe(1);
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
      raidId,
      difficulty: "MYTHIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: futureIso(8),
      desiredTankCount: 3,
      desiredHealerCount: 5,
      desiredDpsCount: 12,
    });
    let run = await runRepository.findById(id);
    expect(run?.difficulty).toBe("MYTHIC");
    expect(run?.desiredTankCount).toBe(3);

    await runService.openRun(lead, id);
    await runService.updateRun(lead, {
      runId: id,
      raidId,
      difficulty: "NORMAL",
      lootType: "UNSAVED",
      plannedBossCount: 8,
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
        raidId,
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        plannedBossCount: 8,
        scheduledStartAt: futureIso(10),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
      "RUN_IDENTITY_LOCKED",
    );

    await runService.updateRun(lead, {
      runId: id,
      raidId,
      difficulty: "NORMAL",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: futureIso(11),
      desiredTankCount: 1,
      desiredHealerCount: 2,
      desiredDpsCount: 8,
    });
    run = await runRepository.findById(id);
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
        raidId,
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        plannedBossCount: 8,
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
        raidId,
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        plannedBossCount: 8,
        scheduledStartAt: futureIso(),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
      "RUN_NOT_MANAGEABLE",
    );

    await runService.updateRun(admin, {
      runId: otherId,
      raidId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: futureIso(),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    expect((await runRepository.findById(otherId))?.raidLeadId).toBe(ids.otherLead);
  });
});

describe("title regeneration on update", () => {
  it("recomputes the title whenever a title-source field changes, and rejects MYTHIC + SAVED on update", async () => {
    const id = await createDraft(lead, { title: "Ignored on create too" });
    const before = (await runRepository.findById(id))?.title;

    await runService.updateRun(lead, {
      runId: id,
      raidId,
      difficulty: "HEROIC",
      lootType: "VIP",
      plannedBossCount: 8,
      scheduledStartAt: futureIso(3),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    const afterLootTypeChange = (await runRepository.findById(id))?.title;
    expect(afterLootTypeChange).not.toBe(before);
    expect(afterLootTypeChange).toContain("VIP");

    await runService.updateRun(lead, {
      runId: id,
      raidId,
      difficulty: "HEROIC",
      lootType: "VIP",
      plannedBossCount: 5,
      scheduledStartAt: futureIso(3),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    const afterBossCountChange = (await runRepository.findById(id))?.title;
    expect(afterBossCountChange).not.toBe(afterLootTypeChange);
    expect(afterBossCountChange).toContain("5/8");

    // A notes-only change still regenerates the title (deterministic
    // recomputation is cheap) but produces the same string, since none of
    // the title's own source fields changed.
    await runService.updateRun(lead, {
      runId: id,
      raidId,
      difficulty: "HEROIC",
      lootType: "VIP",
      plannedBossCount: 5,
      scheduledStartAt: futureIso(3),
      notes: "Just a note",
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    expect((await runRepository.findById(id))?.title).toBe(afterBossCountChange);

    await expectDomainCode(
      runService.updateRun(lead, {
        runId: id,
        raidId,
        difficulty: "MYTHIC",
        lootType: "SAVED",
        plannedBossCount: 5,
        scheduledStartAt: futureIso(3),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
      "RUN_LOOT_TYPE_INVALID",
    );
  });
});

describe("raid lead reassignment", () => {
  it("blocks RAID_LEAD reassignment and allows ADMIN before publish", async () => {
    const id = await createDraft(lead, { title: "Reassign me" });
    await runService.openRun(lead, id);
    await expectDomainCode(
      runService.updateRun(lead, {
        runId: id,
        raidId,
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        plannedBossCount: 8,
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
      raidId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
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
        raidId,
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        plannedBossCount: 8,
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
        raidId,
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        plannedBossCount: 8,
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
    await orm.BoosterQualification.create({
      id: ids.access,
      userId: ids.user,
      difficulty: "HEROIC",
      status: "APPROVED",
      notes: "Run management test grant",
      grantedAt: now,
      grantedById: ids.admin,
      revokedAt: null,
      revokedById: null,
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

describe("archive run", () => {
  it("rejects archiving a non-terminal Run at every non-terminal status", async () => {
    const openId = await createDraft(lead, { title: "Archive open rejected" });
    await runService.openRun(lead, openId);
    await expectDomainCode(runService.archiveRun(lead, openId), "RUN_CANNOT_ARCHIVE");

    await runRepository.updateFields(openId, { status: "ROSTERING" });
    await expectDomainCode(runService.archiveRun(lead, openId), "RUN_CANNOT_ARCHIVE");

    await runRepository.updateFields(openId, { status: "PUBLISHED" });
    await expectDomainCode(runService.archiveRun(lead, openId), "RUN_CANNOT_ARCHIVE");

    await runRepository.updateFields(openId, { status: "IN_PROGRESS" });
    await expectDomainCode(runService.archiveRun(lead, openId), "RUN_CANNOT_ARCHIVE");
  });

  it("lets ADMIN archive a COMPLETED run and preserves status/signup/roster history", async () => {
    const id = await createDraft(lead, { title: "Archive completed" });
    const signupId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: signupId,
      runId: id,
      userId: ids.user,
      participationType: "LOOTBUDDY",
      isBackup: false,
      status: "SELECTED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    createdSignupIds.push(signupId);
    await runRepository.updateFields(id, { status: "COMPLETED" });

    const result = await runService.archiveRun(admin, id);
    expect(result.id).toBe(id);

    const archived = await runRepository.findById(id);
    expect(archived?.status).toBe("COMPLETED");
    expect(archived?.archivedAt).toBeTruthy();
    expect(archived?.archivedById).toBe(ids.admin);
    expect(await runRepository.countSignups(id)).toBe(1);
    const roster = await orm.RunRoster.where({ runId: id }).first();
    expect(roster).toBeTruthy();

    await expectDomainCode(runService.archiveRun(admin, id), "RUN_ALREADY_ARCHIVED");
  });

  it("lets ADMIN archive a CANCELLED run", async () => {
    const id = await createDraft(lead, { title: "Archive cancelled" });
    await runService.cancelRun(lead, id);
    await runService.archiveRun(admin, id);
    expect((await runRepository.findById(id))?.archivedAt).toBeTruthy();
  });

  it("lets a RAID_LEAD archive their own terminal Run, but not an unrelated one, and denies USER", async () => {
    const ownId = await createDraft(lead, { title: "Own terminal run" });
    await runRepository.updateFields(ownId, { status: "COMPLETED" });
    await runService.archiveRun(lead, ownId);
    expect((await runRepository.findById(ownId))?.archivedAt).toBeTruthy();

    const unrelatedId = await createDraft(otherLead, { title: "Unrelated terminal run" });
    await runRepository.updateFields(unrelatedId, { status: "COMPLETED" });
    await expectDomainCode(runService.archiveRun(lead, unrelatedId), "RUN_NOT_MANAGEABLE");
    await expectDomainCode(runService.archiveRun(user, unrelatedId), "RUN_NOT_MANAGEABLE");
  });
});

describe("restore run", () => {
  it("clears archive metadata while preserving status and history, and rejects restoring a non-archived Run", async () => {
    const id = await createDraft(lead, { title: "Restore me" });
    await runRepository.updateFields(id, { status: "CANCELLED" });
    await expectDomainCode(runService.restoreRun(admin, id), "RUN_NOT_ARCHIVED");

    await runService.archiveRun(admin, id);
    const result = await runService.restoreRun(admin, id);
    expect(result.id).toBe(id);

    const restored = await runRepository.findById(id);
    expect(restored?.archivedAt).toBeNull();
    expect(restored?.archivedById).toBeNull();
    expect(restored?.status).toBe("CANCELLED");
  });
});

describe("delete run", () => {
  it("lets ADMIN delete an empty Draft, and rejects RAID_LEAD/USER", async () => {
    const id = await createDraft(lead, { title: "Delete me" });
    await expectDomainCode(runService.deleteRun(lead, id), "NOT_AUTHORIZED");
    await expectDomainCode(runService.deleteRun(user, id), "NOT_AUTHORIZED");

    await runService.deleteRun(admin, id);
    expect(await runRepository.findById(id)).toBeNull();
    createdRunIds.splice(createdRunIds.indexOf(id), 1);
  });

  it("rejects deleting a non-Draft Run", async () => {
    const openId = await createDraft(lead, { title: "Delete open rejected" });
    await runService.openRun(lead, openId);
    await expectDomainCode(runService.deleteRun(admin, openId), "RUN_CANNOT_DELETE");

    const completedId = await createDraft(lead, { title: "Delete completed rejected" });
    await runRepository.updateFields(completedId, { status: "COMPLETED" });
    await expectDomainCode(runService.deleteRun(admin, completedId), "RUN_CANNOT_DELETE");
  });

  it("rejects deleting a Draft with any real relation history", async () => {
    const withSignup = await createDraft(lead, { title: "Draft with signup" });
    const signupId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: signupId,
      runId: withSignup,
      userId: ids.user,
      participationType: "LOOTBUDDY",
      isBackup: false,
      status: "WITHDRAWN",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    createdSignupIds.push(signupId);
    await expectDomainCode(runService.deleteRun(admin, withSignup), "RUN_CANNOT_DELETE");

    const withRosterEntry = await createDraft(lead, { title: "Draft with roster entry" });
    const roster = await orm.RunRoster.where({ runId: withRosterEntry }).first();
    const rosterId = (roster as { id: string }).id;
    const entrySignupId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: entrySignupId,
      runId: withRosterEntry,
      userId: ids.user,
      participationType: "LOOTBUDDY",
      isBackup: false,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    createdSignupIds.push(entrySignupId);
    await orm.RunRosterEntry.create({
      id: crypto.randomUUID(),
      rosterId,
      signupId: entrySignupId,
      selected: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await expectDomainCode(runService.deleteRun(admin, withRosterEntry), "RUN_CANNOT_DELETE");

    const withStrike = await createDraft(lead, { title: "Draft with strike" });
    const strikeId = crypto.randomUUID();
    await orm.Strike.create({
      id: strikeId,
      userId: ids.user,
      runId: withStrike,
      reason: "Test strike",
      notes: null,
      status: "ACTIVE",
      createdById: ids.admin,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await expectDomainCode(runService.deleteRun(admin, withStrike), "RUN_CANNOT_DELETE");
    await orm.Strike.where({ id: strikeId }).delete();

    const withDiscordPost = await createDraft(lead, { title: "Draft with Discord state" });
    const discordPostId = crypto.randomUUID();
    await orm.RunDiscordPost.create({
      id: discordPostId,
      runId: withDiscordPost,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await expectDomainCode(runService.deleteRun(admin, withDiscordPost), "RUN_CANNOT_DELETE");
    await orm.RunDiscordPost.where({ id: discordPostId }).delete();
  });
});

describe("manage runs archive filter", () => {
  it("defaults to active-only, supports archived-only and all, composing with status/lead filters", async () => {
    const activeId = await createDraft(lead, { title: "Filter active" });
    const archivedId = await createDraft(lead, { title: "Filter archived" });
    await runRepository.updateFields(archivedId, { status: "CANCELLED" });
    await runService.archiveRun(admin, archivedId);

    const defaultPage = await runService.getManagedRunsPage(admin, {});
    expect(defaultPage.runs.some((run) => run.id === activeId)).toBe(true);
    expect(defaultPage.runs.some((run) => run.id === archivedId)).toBe(false);

    const archivedPage = await runService.getManagedRunsPage(admin, { archived: "archived" });
    expect(archivedPage.runs.some((run) => run.id === activeId)).toBe(false);
    expect(archivedPage.runs.some((run) => run.id === archivedId)).toBe(true);

    const allPage = await runService.getManagedRunsPage(admin, { archived: "all" });
    expect(allPage.runs.some((run) => run.id === activeId)).toBe(true);
    expect(allPage.runs.some((run) => run.id === archivedId)).toBe(true);

    const composed = await runService.getManagedRunsPage(admin, { archived: "archived", status: "CANCELLED" });
    expect(composed.runs.some((run) => run.id === archivedId)).toBe(true);
  });

  it("keeps an archived Run reachable through the canonical detail page", async () => {
    const id = await createDraft(lead, { title: "Archived but reachable" });
    await runRepository.updateFields(id, { status: "COMPLETED" });
    await runService.archiveRun(admin, id);

    const detail = await runDetailService.getRunDetail(admin, id);
    expect(detail.run.id).toBe(id);
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
