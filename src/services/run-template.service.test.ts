import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { MANAFORGE_OMEGA_RAID_ID, VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { runTemplateRepository } from "@/repositories/run-template.repository";
import { computeUsability, runTemplateService } from "@/services/run-template.service";
import type { RunTemplateRecord } from "@/repositories/run-template.repository";
import type { CreateRunTemplateInput } from "@/validators/run-template";
import { createRunTemplateSchema } from "@/validators/run-template";

const raidId = VENOMOUS_ABYSS_RAID_ID;
const ids = {
  user: "aaaaaaaa-aaaa-4aaa-8aaa-rs0000000001",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-rs0000000002",
  otherLead: "aaaaaaaa-aaaa-4aaa-8aaa-rs0000000003",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-rs0000000004",
};

const createdTemplateIds: string[] = [];

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
  accountStatus: AuthenticatedUser["accountStatus"] = "ACTIVE",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@rstest.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus,
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

async function createTestUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"],
  accountStatus: AuthenticatedUser["accountStatus"] = "ACTIVE",
) {
  await orm.User.create({
    id,
    name,
    email: `${id}@rstest.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function deleteIfPresent(table: "User" | "RunTemplate", id: string) {
  try {
    if (table === "User") await orm.User.where({ id }).delete();
    else await orm.RunTemplate.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

async function setRaidAvailable(id: string, available: boolean) {
  await orm.Raid.where({ id }).update({ isActive: available, updatedAt: new Date().toISOString() });
}

async function setAccountStatus(id: string, status: AuthenticatedUser["accountStatus"]) {
  await orm.User.where({ id }).update({ accountStatus: status, updatedAt: new Date().toISOString() });
}

const user = asUser(ids.user, "RTS User");
const lead = asUser(ids.lead, "RTS Lead", "RAID_LEAD");
const admin = asUser(ids.admin, "RTS Admin", "ADMIN");

function inputFor(overrides: Partial<CreateRunTemplateInput> = {}): CreateRunTemplateInput {
  return {
    name: "Service Test Template",
    raidId,
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    plannedBossCount: 8,
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    notes: null,
    ...overrides,
  };
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const id of [ids.user, ids.lead, ids.otherLead, ids.admin]) {
    await deleteIfPresent("User", id);
  }
  await createTestUser(ids.user, "RTS User", "USER");
  await createTestUser(ids.lead, "RTS Lead", "RAID_LEAD");
  await createTestUser(ids.otherLead, "RTS Other Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "RTS Admin", "ADMIN");
});

afterAll(async () => {
  for (const id of createdTemplateIds) {
    await deleteIfPresent("RunTemplate", id);
  }
  for (const id of [ids.user, ids.lead, ids.otherLead, ids.admin]) {
    await deleteIfPresent("User", id);
  }
  // Defensive — every test that mutates shared reference state restores it
  // itself, but this guards the rest of the suite even if one didn't.
  await setRaidAvailable(raidId, true);
  await setAccountStatus(ids.lead, "ACTIVE");
});

afterEach(async () => {
  const stray = await orm.RunTemplate.where({ raidLeadId: ids.lead }).select("id").all();
  for (const row of stray) {
    const id = String((row as { id: string }).id);
    if (!createdTemplateIds.includes(id)) {
      await deleteIfPresent("RunTemplate", id);
    }
  }
});

function fakeTemplate(overrides: Partial<RunTemplateRecord> = {}): RunTemplateRecord {
  return {
    id: "fake",
    name: "Fake",
    raidLeadId: ids.lead,
    raidLeadName: "RTS Lead",
    raidLeadEligible: true,
    raidId,
    raidName: "Venomous Abyss",
    raidSeason: "Season",
    raidAvailableForRuns: true,
    totalBossCount: 8,
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    plannedBossCount: 8,
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    notes: null,
    isActive: true,
    createdById: ids.lead,
    createdByName: "RTS Lead",
    updatedById: ids.lead,
    updatedByName: "RTS Lead",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("computeUsability — pure boolean logic", () => {
  it("a fully valid template is usable", () => {
    expect(computeUsability(fakeTemplate())).toEqual({ usable: true, unusableReason: null });
  });

  it("an inactive template is unusable", () => {
    expect(computeUsability(fakeTemplate({ isActive: false })).usable).toBe(false);
  });

  it("a template whose raid is no longer available for runs is unusable", () => {
    expect(computeUsability(fakeTemplate({ raidAvailableForRuns: false })).usable).toBe(false);
  });

  it("a template whose owner is no longer an eligible raid lead is unusable", () => {
    expect(computeUsability(fakeTemplate({ raidLeadEligible: false })).usable).toBe(false);
  });

  it("an invalid difficulty/lootType combination is unusable", () => {
    expect(computeUsability(fakeTemplate({ difficulty: "MYTHIC", lootType: "SAVED" })).usable).toBe(false);
  });

  it("a planned boss count outside the raid's current total is unusable", () => {
    expect(computeUsability(fakeTemplate({ plannedBossCount: 99 })).usable).toBe(false);
    expect(computeUsability(fakeTemplate({ plannedBossCount: 0 })).usable).toBe(false);
  });

  it("an out-of-range composition value is unusable", () => {
    expect(computeUsability(fakeTemplate({ desiredTankCount: -1 })).usable).toBe(false);
    expect(computeUsability(fakeTemplate({ desiredDpsCount: 999 })).usable).toBe(false);
  });
});

describe("createRunTemplateSchema — structural validation", () => {
  it("rejects an empty name", () => {
    expect(createRunTemplateSchema.safeParse(inputFor({ name: "  " })).success).toBe(false);
  });

  it("rejects an overlong name", () => {
    expect(createRunTemplateSchema.safeParse(inputFor({ name: "x".repeat(200) })).success).toBe(false);
  });
});

describe("runTemplateService.createTemplate — authorization", () => {
  it("USER is forbidden, no template created", async () => {
    await expectDomainCode(runTemplateService.createTemplate(user, inputFor()), "NOT_AUTHORIZED");
  });

  it("RAID_LEAD creates for themselves when raidLeadId is omitted", async () => {
    const result = await runTemplateService.createTemplate(lead, inputFor());
    createdTemplateIds.push(result.id);
    const template = await runTemplateRepository.findById(result.id);
    expect(template?.raidLeadId).toBe(ids.lead);
    expect(template?.createdById).toBe(ids.lead);
    expect(template?.updatedById).toBe(ids.lead);
  });

  it("RAID_LEAD forging a different owner is rejected", async () => {
    await expectDomainCode(
      runTemplateService.createTemplate(lead, inputFor({ raidLeadId: ids.otherLead })),
      "RUN_RAID_LEAD_INVALID",
    );
  });

  it("ADMIN must explicitly choose an owner", async () => {
    await expectDomainCode(runTemplateService.createTemplate(admin, inputFor()), "RUN_RAID_LEAD_INVALID");
  });

  it("ADMIN creating for an eligible raid lead succeeds; createdById is the ADMIN, raidLeadId is the target", async () => {
    const result = await runTemplateService.createTemplate(admin, inputFor({ raidLeadId: ids.otherLead }));
    createdTemplateIds.push(result.id);
    const template = await runTemplateRepository.findById(result.id);
    expect(template?.raidLeadId).toBe(ids.otherLead);
    expect(template?.createdById).toBe(ids.admin);
    expect(template?.updatedById).toBe(ids.admin);
  });

  it("ADMIN assigning an ineligible owner (plain USER) is rejected", async () => {
    await expectDomainCode(
      runTemplateService.createTemplate(admin, inputFor({ raidLeadId: ids.user })),
      "RUN_RAID_LEAD_INVALID",
    );
  });
});

describe("runTemplateService.createTemplate — domain validation reuses Run planning rules", () => {
  it("a historical raid is rejected, nothing created", async () => {
    await expectDomainCode(
      runTemplateService.createTemplate(lead, inputFor({ raidId: MANAFORGE_OMEGA_RAID_ID })),
      "RAID_NOT_AVAILABLE_FOR_RUNS",
    );
  });

  it("an invalid difficulty/lootType combination is rejected", async () => {
    await expectDomainCode(
      runTemplateService.createTemplate(lead, inputFor({ difficulty: "MYTHIC", lootType: "SAVED" })),
      "RUN_LOOT_TYPE_INVALID",
    );
  });

  it("a planned boss count exceeding the raid's total is rejected", async () => {
    await expectDomainCode(
      runTemplateService.createTemplate(lead, inputFor({ plannedBossCount: 999 })),
      "RUN_BOSS_COUNT_INVALID",
    );
  });

  it("an out-of-range composition value is rejected", async () => {
    await expectDomainCode(
      runTemplateService.createTemplate(lead, inputFor({ desiredHealerCount: -1 })),
      "VALIDATION_FAILED",
    );
  });
});

describe("runTemplateService.updateTemplate — ownership authorization", () => {
  it("RAID_LEAD may edit their own template", async () => {
    const created = await runTemplateService.createTemplate(lead, inputFor({ name: "Owned" }));
    createdTemplateIds.push(created.id);
    const result = await runTemplateService.updateTemplate(lead, {
      ...inputFor({ name: "Owned, edited" }),
      templateId: created.id,
    });
    expect(result.id).toBe(created.id);
    const template = await runTemplateRepository.findById(created.id);
    expect(template?.name).toBe("Owned, edited");
    expect(template?.updatedById).toBe(ids.lead);
  });

  it("RAID_LEAD editing another raid lead's template is forbidden", async () => {
    const created = await runTemplateService.createTemplate(admin, inputFor({ name: "Other's", raidLeadId: ids.otherLead }));
    createdTemplateIds.push(created.id);
    await expectDomainCode(
      runTemplateService.updateTemplate(lead, { ...inputFor({ name: "Hijacked" }), templateId: created.id }),
      "NOT_AUTHORIZED",
    );
    const template = await runTemplateRepository.findById(created.id);
    expect(template?.name).toBe("Other's");
  });

  it("ADMIN may edit any raid lead's template, including reassigning the owner (no Run relation to touch)", async () => {
    const created = await runTemplateService.createTemplate(lead, inputFor({ name: "Reassignable" }));
    createdTemplateIds.push(created.id);
    await runTemplateService.updateTemplate(admin, {
      ...inputFor({ name: "Reassignable" }),
      templateId: created.id,
      raidLeadId: ids.otherLead,
    });
    const template = await runTemplateRepository.findById(created.id);
    expect(template?.raidLeadId).toBe(ids.otherLead);
    expect(template?.updatedById).toBe(ids.admin);
    // createdById is a separate audit field — it never changes on update.
    expect(template?.createdById).toBe(ids.lead);
  });
});

describe("runTemplateService — active/inactive lifecycle", () => {
  it("deactivate then reactivate round-trips isActive", async () => {
    const created = await runTemplateService.createTemplate(lead, inputFor({ name: "Lifecycle" }));
    createdTemplateIds.push(created.id);

    await runTemplateService.deactivate(lead, created.id);
    expect((await runTemplateRepository.findById(created.id))?.isActive).toBe(false);

    await runTemplateService.reactivate(lead, created.id);
    expect((await runTemplateRepository.findById(created.id))?.isActive).toBe(true);
  });

  it("deactivating an already-inactive template is rejected", async () => {
    const created = await runTemplateService.createTemplate(lead, inputFor({ name: "Already inactive" }));
    createdTemplateIds.push(created.id);
    await runTemplateService.deactivate(lead, created.id);
    await expectDomainCode(runTemplateService.deactivate(lead, created.id), "RUN_TEMPLATE_ALREADY_INACTIVE");
  });

  it("reactivating an already-active template is rejected", async () => {
    const created = await runTemplateService.createTemplate(lead, inputFor({ name: "Already active" }));
    createdTemplateIds.push(created.id);
    await expectDomainCode(runTemplateService.reactivate(lead, created.id), "RUN_TEMPLATE_ALREADY_ACTIVE");
  });

  it("reactivation re-validates the raid and fails if it has since gone historical, without flipping isActive", async () => {
    const created = await runTemplateService.createTemplate(lead, inputFor({ name: "Raid goes historical" }));
    createdTemplateIds.push(created.id);
    await runTemplateService.deactivate(lead, created.id);

    await setRaidAvailable(raidId, false);
    try {
      await expectDomainCode(runTemplateService.reactivate(lead, created.id), "RUN_TEMPLATE_UNUSABLE");
      expect((await runTemplateRepository.findById(created.id))?.isActive).toBe(false);
    } finally {
      await setRaidAvailable(raidId, true);
    }
  });

  it("reactivation re-validates owner eligibility and fails if the owner is no longer eligible", async () => {
    const created = await runTemplateService.createTemplate(lead, inputFor({ name: "Owner disabled" }));
    createdTemplateIds.push(created.id);
    await runTemplateService.deactivate(lead, created.id);

    await setAccountStatus(ids.lead, "DISABLED");
    try {
      await expectDomainCode(runTemplateService.reactivate(admin, created.id), "RUN_TEMPLATE_UNUSABLE");
      expect((await runTemplateRepository.findById(created.id))?.isActive).toBe(false);
    } finally {
      await setAccountStatus(ids.lead, "ACTIVE");
    }
  });
});

describe("runTemplateService.listUsableForCreation — selector scoping", () => {
  it("RAID_LEAD sees only their own active, usable templates", async () => {
    const own = await runTemplateService.createTemplate(lead, inputFor({ name: "Selector Own" }));
    const other = await runTemplateService.createTemplate(admin, inputFor({ name: "Selector Other", raidLeadId: ids.otherLead }));
    createdTemplateIds.push(own.id, other.id);

    const usable = await runTemplateService.listUsableForCreation(lead);
    expect(usable.some((t) => t.id === own.id)).toBe(true);
    expect(usable.some((t) => t.id === other.id)).toBe(false);
  });

  it("ADMIN sees usable templates across every raid lead", async () => {
    const own = await runTemplateService.createTemplate(lead, inputFor({ name: "Selector Admin Own" }));
    const other = await runTemplateService.createTemplate(admin, inputFor({ name: "Selector Admin Other", raidLeadId: ids.otherLead }));
    createdTemplateIds.push(own.id, other.id);

    const usable = await runTemplateService.listUsableForCreation(admin);
    expect(usable.some((t) => t.id === own.id)).toBe(true);
    expect(usable.some((t) => t.id === other.id)).toBe(true);
  });

  it("an inactive template never appears in the selector", async () => {
    const created = await runTemplateService.createTemplate(lead, inputFor({ name: "Selector Inactive" }));
    createdTemplateIds.push(created.id);
    await runTemplateService.deactivate(lead, created.id);

    const usable = await runTemplateService.listUsableForCreation(lead);
    expect(usable.some((t) => t.id === created.id)).toBe(false);
  });

  it("a stale-but-still-active template (owner since disabled) disappears from the selector without being mutated", async () => {
    const created = await runTemplateService.createTemplate(lead, inputFor({ name: "Selector Stale" }));
    createdTemplateIds.push(created.id);

    await setAccountStatus(ids.lead, "DISABLED");
    try {
      const usable = await runTemplateService.listUsableForCreation(admin);
      expect(usable.some((t) => t.id === created.id)).toBe(false);
      // The row itself is untouched — still active, just filtered from the selector.
      expect((await runTemplateRepository.findById(created.id))?.isActive).toBe(true);
    } finally {
      await setAccountStatus(ids.lead, "ACTIVE");
    }
  });
});

describe("runTemplateService.resolveTemplateForUse — the authority Run creation depends on", () => {
  it("RAID_LEAD may resolve their own template", async () => {
    const created = await runTemplateService.createTemplate(lead, inputFor({ name: "Resolve Own" }));
    createdTemplateIds.push(created.id);
    const resolved = await runTemplateService.resolveTemplateForUse(lead, created.id);
    expect(resolved.raidLeadId).toBe(ids.lead);
  });

  it("RAID_LEAD attempting to resolve another raid lead's template is rejected", async () => {
    const created = await runTemplateService.createTemplate(admin, inputFor({ name: "Resolve Forbidden", raidLeadId: ids.otherLead }));
    createdTemplateIds.push(created.id);
    await expectDomainCode(runTemplateService.resolveTemplateForUse(lead, created.id), "NOT_AUTHORIZED");
  });

  it("ADMIN may resolve any usable template", async () => {
    const created = await runTemplateService.createTemplate(lead, inputFor({ name: "Resolve Admin" }));
    createdTemplateIds.push(created.id);
    const resolved = await runTemplateService.resolveTemplateForUse(admin, created.id);
    expect(resolved.raidLeadId).toBe(ids.lead);
  });

  it("resolving a nonexistent template is rejected", async () => {
    await expectDomainCode(runTemplateService.resolveTemplateForUse(admin, crypto.randomUUID()), "RUN_TEMPLATE_NOT_FOUND");
  });

  it("resolving an inactive template is rejected", async () => {
    const created = await runTemplateService.createTemplate(lead, inputFor({ name: "Resolve Inactive" }));
    createdTemplateIds.push(created.id);
    await runTemplateService.deactivate(lead, created.id);
    await expectDomainCode(runTemplateService.resolveTemplateForUse(lead, created.id), "RUN_TEMPLATE_UNUSABLE");
  });
});
