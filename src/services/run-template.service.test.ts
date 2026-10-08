import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PRODUCT_CATALOG_FIXTURE } from "@/lib/product-catalog";
import type { PlanningProduct } from "@/lib/product-selection";
import { fixtureRaidCatalog } from "@/lib/raid-catalog";
import { seededProductSelection } from "@/lib/test-run-input";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { MANAFORGE_OMEGA_RAID_ID, TIDEBOUND_GROTTO_RAID_ID, VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { runTemplateRepository } from "@/repositories/run-template.repository";
import { computeUsability, runTemplateService } from "@/services/run-template.service";
import type { RunTemplateRecord } from "@/repositories/run-template.repository";
import type { CreateRunTemplateInput } from "@/validators/run-template";
import { createRunTemplateSchema } from "@/validators/run-template";
import { runService } from "@/services/run.service";
import { expandProductSelection } from "@/lib/product-selection";
import { productPlanningService } from "@/services/product-planning.service";
import { VENOMOUS_ABYSS_PRODUCT_CONTENT_ID, VENOMOUS_ABYSS_PRODUCT_ID } from "@/lib/product-catalog";

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
    ...seededProductSelection("VENOMOUS_ABYSS", 8),
    difficulty: "HEROIC",
    lootType: "UNSAVED",
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
  for (const creatorId of [ids.lead, ids.admin, ids.otherLead]) {
    const stray = await orm.RunTemplate.where({ createdById: creatorId }).select("id").all();
    for (const row of stray) {
      const id = String((row as { id: string }).id);
      if (!createdTemplateIds.includes(id)) {
        await deleteIfPresent("RunTemplate", id);
      }
    }
  }
});

function fakeTemplate(overrides: Partial<RunTemplateRecord> = {}): RunTemplateRecord {
  return {
    id: "fake",
    name: "Fake",
    raidId,
    raidName: "Venomous Abyss",
    raidSeason: "Season",
    raidAvailableForRuns: true,
    totalBossCount: 8,
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    plannedBossCount: 8,
    contents: [
      {
        id: "fake-content",
        raidId,
        raidName: "Venomous Abyss",
        raidSeason: "Season",
        raidAvailableForRuns: true,
        sortOrder: 1,
        plannedBossCount: 8,
        totalBossCount: 8,
      },
    ],
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    desiredLootbuddyCount: 0,
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

/**
 * Pure usability checks against the SEEDED catalog shape (Venomous; Tide 1 +
 * Venomous). Built from the bootstrap fixtures — the runtime reads the DB.
 */
const SEEDED_ACTIVE_PRODUCTS: PlanningProduct[] = PRODUCT_CATALOG_FIXTURE.map((product) => ({
  id: product.id,
  key: product.key,
  name: product.name,
  active: product.active,
  selectable: product.selectable,
  sortOrder: product.sortOrder,
  contents: product.contents.map((content) => ({
    productRaidContentId: content.id,
    raidId: content.raidId,
    raidName: fixtureRaidCatalog().findById(content.raidId)!.name,
    sortOrder: content.sortOrder,
    bossCountMode: content.bossCountMode,
    fixedBossCount: content.fixedBossCount,
    minBossCount: content.minBossCount,
    defaultBossCount: content.defaultBossCount,
    totalBossCount: fixtureRaidCatalog().bossTotal(content.raidId),
  })),
}));

function usabilityWithSeededProducts(template: Parameters<typeof computeUsability>[0]) {
  return computeUsability(template, SEEDED_ACTIVE_PRODUCTS);
}

describe("computeUsability — pure boolean logic", () => {
  it("a fully valid template is usable", () => {
    expect(usabilityWithSeededProducts(fakeTemplate())).toEqual({ usable: true, unusableReason: null });
  });

  it("an inactive template is unusable", () => {
    expect(usabilityWithSeededProducts(fakeTemplate({ isActive: false })).usable).toBe(false);
  });

  it("a template whose raid is no longer available for Run Setup is unusable", () => {
    expect(
      usabilityWithSeededProducts(
        fakeTemplate({
          raidId: MANAFORGE_OMEGA_RAID_ID,
          raidAvailableForRuns: false,
          contents: [
            {
              id: "mf",
              raidId: MANAFORGE_OMEGA_RAID_ID,
              raidName: "Manaforge Omega",
              raidSeason: "TWW S3",
              raidAvailableForRuns: false,
              sortOrder: 1,
              plannedBossCount: 8,
              totalBossCount: 8,
            },
          ],
        }),
      ).usable,
    ).toBe(false);
  });

  it("Bundle Tide remains usable even when Tide availableForRuns is false", () => {
    expect(
      usabilityWithSeededProducts(
        fakeTemplate({
          contents: [
            {
              id: "tide",
              raidId: TIDEBOUND_GROTTO_RAID_ID,
              raidName: "The Tidebound Grotto",
              raidSeason: "Midnight Season 2",
              raidAvailableForRuns: false,
              sortOrder: 1,
              plannedBossCount: 1,
              totalBossCount: 1,
            },
            {
              id: "venom",
              raidId: VENOMOUS_ABYSS_RAID_ID,
              raidName: "The Venomous Abyss",
              raidSeason: "Midnight Season 2",
              raidAvailableForRuns: true,
              sortOrder: 2,
              plannedBossCount: 8,
              totalBossCount: 8,
            },
          ],
        }),
      ).usable,
    ).toBe(true);
  });

  it("standalone Tide content is not a supported product", () => {
    expect(
      usabilityWithSeededProducts(
        fakeTemplate({
          raidId: TIDEBOUND_GROTTO_RAID_ID,
          raidAvailableForRuns: false,
          totalBossCount: 1,
          plannedBossCount: 1,
          contents: [
            {
              id: "tide",
              raidId: TIDEBOUND_GROTTO_RAID_ID,
              raidName: "The Tidebound Grotto",
              raidSeason: "Midnight Season 2",
              raidAvailableForRuns: false,
              sortOrder: 1,
              plannedBossCount: 1,
              totalBossCount: 1,
            },
          ],
        }),
      ).usable,
    ).toBe(false);
  });

  it("an invalid difficulty/lootType combination is unusable", () => {
    expect(usabilityWithSeededProducts(fakeTemplate({ difficulty: "MYTHIC", lootType: "SAVED" })).usable).toBe(false);
  });

  it("a planned boss count outside the raid's current total is unusable", () => {
    expect(
      usabilityWithSeededProducts(
        fakeTemplate({
          plannedBossCount: 99,
          contents: [
            {
              id: "fake-content",
              raidId,
              raidName: "Venomous Abyss",
              raidSeason: "Season",
              raidAvailableForRuns: true,
              sortOrder: 1,
              plannedBossCount: 99,
              totalBossCount: 8,
            },
          ],
        }),
      ).usable,
    ).toBe(false);
    expect(
      usabilityWithSeededProducts(
        fakeTemplate({
          plannedBossCount: 0,
          contents: [
            {
              id: "fake-content",
              raidId,
              raidName: "Venomous Abyss",
              raidSeason: "Season",
              raidAvailableForRuns: true,
              sortOrder: 1,
              plannedBossCount: 0,
              totalBossCount: 8,
            },
          ],
        }),
      ).usable,
    ).toBe(false);
  });

  it("an out-of-range composition value is unusable", () => {
    expect(usabilityWithSeededProducts(fakeTemplate({ desiredTankCount: -1 })).usable).toBe(false);
    expect(usabilityWithSeededProducts(fakeTemplate({ desiredDpsCount: 999 })).usable).toBe(false);
  });
});

describe("template → DB product expansion", () => {
  it("expands the persisted Venomous product into content rows without a Run.raidId column", async () => {
    const product = (await productPlanningService.listAll()).find((row) => row.id === VENOMOUS_ABYSS_PRODUCT_ID)!;
    expect(expandProductSelection(product, { [VENOMOUS_ABYSS_PRODUCT_CONTENT_ID]: 6 })).toEqual([
      { raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 6 },
    ]);
  });

  it("getCreateManyForm maps templates back to their matching product selection", async () => {
    const created = await runTemplateService.createTemplate(
      admin,
      inputFor({ name: "Preset Map", contentBossCounts: { [VENOMOUS_ABYSS_PRODUCT_CONTENT_ID]: 5 } }),
    );
    createdTemplateIds.push(created.id);
    const form = await runService.getCreateManyForm(lead);
    const row = form.templates.find((template) => template.id === created.id);
    expect(row?.productId).toBe(VENOMOUS_ABYSS_PRODUCT_ID);
    expect(row?.contentBossCounts).toEqual({ [VENOMOUS_ABYSS_PRODUCT_CONTENT_ID]: 5 });
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

  it("RAID_LEAD cannot manage global templates", async () => {
    await expectDomainCode(runTemplateService.createTemplate(lead, inputFor()), "NOT_AUTHORIZED");
  });

  it("ADMIN creates a global template without raidLeadId", async () => {
    const result = await runTemplateService.createTemplate(admin, inputFor());
    createdTemplateIds.push(result.id);
    const template = await runTemplateRepository.findById(result.id);
    expect(template?.createdById).toBe(ids.admin);
    expect(template?.updatedById).toBe(ids.admin);
  });
});

describe("runTemplateService.createTemplate — domain validation reuses Run planning rules", () => {
  it("creates Bundle contents with fixed Tide 1/1", async () => {
    const created = await runTemplateService.createTemplate(
      admin,
      inputFor({ name: "Bundle create", ...seededProductSelection("MIDNIGHT_S2_BUNDLE", 6), }),
    );
    createdTemplateIds.push(created.id);
    const template = await runTemplateRepository.findById(created.id);
    expect(template?.contents).toHaveLength(2);
    expect(template?.contents.find((row) => row.raidId === TIDEBOUND_GROTTO_RAID_ID)?.plannedBossCount).toBe(1);
    expect(template?.contents.find((row) => row.raidId === VENOMOUS_ABYSS_RAID_ID)?.plannedBossCount).toBe(6);
  });

  it("an invalid difficulty/lootType combination is rejected", async () => {
    await expectDomainCode(
      runTemplateService.createTemplate(admin, inputFor({ difficulty: "MYTHIC", lootType: "SAVED" })),
      "RUN_LOOT_TYPE_INVALID",
    );
  });

  it("a planned boss count exceeding the raid's total is rejected", async () => {
    await expectDomainCode(
      runTemplateService.createTemplate(admin, inputFor({ contentBossCounts: { [VENOMOUS_ABYSS_PRODUCT_CONTENT_ID]: 999 } })),
      "RUN_BOSS_COUNT_INVALID",
    );
  });

  it("an out-of-range composition value is rejected", async () => {
    await expectDomainCode(
      runTemplateService.createTemplate(admin, inputFor({ desiredHealerCount: -1 })),
      "VALIDATION_FAILED",
    );
  });
});

describe("runTemplateService.duplicateTemplate", () => {
  it("copies Venomous content, composition, notes, and raid lead into a new id", async () => {
    const created = await runTemplateService.createTemplate(
      admin,
      inputFor({
        name: "HC VIP Venomous 8/8",
        ...seededProductSelection("VENOMOUS_ABYSS", 8),
        lootType: "VIP",
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        desiredLootbuddyCount: 0,
        notes: "orig notes",
      }),
    );
    createdTemplateIds.push(created.id);

    const dup = await runTemplateService.duplicateTemplate(admin, created.id);
    createdTemplateIds.push(dup.id);
    expect(dup.id).not.toBe(created.id);

    const original = await runTemplateRepository.findById(created.id);
    const copy = await runTemplateRepository.findById(dup.id);
    expect(copy?.difficulty).toBe("HEROIC");
    expect(copy?.lootType).toBe("VIP");
    expect(copy?.desiredTankCount).toBe(2);
    expect(copy?.desiredHealerCount).toBe(4);
    expect(copy?.desiredDpsCount).toBe(14);
    expect(copy?.desiredLootbuddyCount).toBe(0);
    expect(copy?.notes).toBe("orig notes");
    expect(copy?.contents).toHaveLength(1);
    expect(copy?.contents[0]?.raidId).toBe(VENOMOUS_ABYSS_RAID_ID);
    expect(copy?.contents[0]?.plannedBossCount).toBe(8);
    expect(copy?.name).toContain("copy");

    await runTemplateService.updateTemplate(admin, {
      ...inputFor({
        name: "HC VIP Venomous 7/8",
        contentBossCounts: { [VENOMOUS_ABYSS_PRODUCT_CONTENT_ID]: 7 },
        lootType: "VIP",
        notes: "edited copy",
      }),
      templateId: dup.id,
    });
    const originalAfter = await runTemplateRepository.findById(created.id);
    expect(originalAfter?.contents[0]?.plannedBossCount).toBe(original?.contents[0]?.plannedBossCount);
    expect(originalAfter?.notes).toBe("orig notes");
  });

  it("copies ordered Bundle contents without sharing identity", async () => {
    const created = await runTemplateService.createTemplate(
      admin,
      inputFor({
        name: "HC VIP Bundle 9/9",
        ...seededProductSelection("MIDNIGHT_S2_BUNDLE", 8),
        lootType: "VIP",
      }),
    );
    createdTemplateIds.push(created.id);

    const dup = await runTemplateService.duplicateTemplate(admin, created.id);
    createdTemplateIds.push(dup.id);

    const copy = await runTemplateRepository.findById(dup.id);
    expect(copy?.contents).toHaveLength(2);
    expect(copy?.contents.map((row) => row.raidId)).toEqual([
      TIDEBOUND_GROTTO_RAID_ID,
      VENOMOUS_ABYSS_RAID_ID,
    ]);
    expect(copy?.contents.find((row) => row.raidId === TIDEBOUND_GROTTO_RAID_ID)?.plannedBossCount).toBe(1);
    expect(copy?.contents.find((row) => row.raidId === VENOMOUS_ABYSS_RAID_ID)?.plannedBossCount).toBe(8);

    await runTemplateService.updateTemplate(admin, {
      ...inputFor({
        name: "HC VIP Bundle 7/9",
        ...seededProductSelection("MIDNIGHT_S2_BUNDLE", 6),
        lootType: "VIP",
      }),
      templateId: dup.id,
    });
    const originalAfter = await runTemplateRepository.findById(created.id);
    expect(
      originalAfter?.contents.find((row) => row.raidId === VENOMOUS_ABYSS_RAID_ID)?.plannedBossCount,
    ).toBe(8);
  });

  it("USER cannot duplicate", async () => {
    const created = await runTemplateService.createTemplate(admin, inputFor({ name: "No dup for user" }));
    createdTemplateIds.push(created.id);
    await expectDomainCode(runTemplateService.duplicateTemplate(user, created.id), "NOT_AUTHORIZED");
  });
});

describe("runTemplateService.updateTemplate — manage authorization", () => {
  it("RAID_LEAD cannot edit global templates", async () => {
    const created = await runTemplateService.createTemplate(admin, inputFor({ name: "Owned" }));
    createdTemplateIds.push(created.id);
    await expectDomainCode(
      runTemplateService.updateTemplate(lead, {
        ...inputFor({ name: "Owned, edited" }),
        templateId: created.id,
      }),
      "NOT_AUTHORIZED",
    );
    const template = await runTemplateRepository.findById(created.id);
    expect(template?.name).toBe("Owned");
  });

  it("ADMIN may edit any global template", async () => {
    const created = await runTemplateService.createTemplate(admin, inputFor({ name: "Editable" }));
    createdTemplateIds.push(created.id);
    const result = await runTemplateService.updateTemplate(admin, {
      ...inputFor({ name: "Editable, updated" }),
      templateId: created.id,
    });
    expect(result.id).toBe(created.id);
    const template = await runTemplateRepository.findById(created.id);
    expect(template?.name).toBe("Editable, updated");
    expect(template?.updatedById).toBe(ids.admin);
    expect(template?.createdById).toBe(ids.admin);
  });
});

describe("runTemplateService — active/inactive lifecycle", () => {
  it("deactivate then reactivate round-trips isActive", async () => {
    const created = await runTemplateService.createTemplate(admin, inputFor({ name: "Lifecycle" }));
    createdTemplateIds.push(created.id);

    await runTemplateService.deactivate(admin, created.id);
    expect((await runTemplateRepository.findById(created.id))?.isActive).toBe(false);

    await runTemplateService.reactivate(admin, created.id);
    expect((await runTemplateRepository.findById(created.id))?.isActive).toBe(true);
  });

  it("deactivating an already-inactive template is rejected", async () => {
    const created = await runTemplateService.createTemplate(admin, inputFor({ name: "Already inactive" }));
    createdTemplateIds.push(created.id);
    await runTemplateService.deactivate(admin, created.id);
    await expectDomainCode(runTemplateService.deactivate(admin, created.id), "RUN_TEMPLATE_ALREADY_INACTIVE");
  });

  it("reactivating an already-active template is rejected", async () => {
    const created = await runTemplateService.createTemplate(admin, inputFor({ name: "Already active" }));
    createdTemplateIds.push(created.id);
    await expectDomainCode(runTemplateService.reactivate(admin, created.id), "RUN_TEMPLATE_ALREADY_ACTIVE");
  });

  it("reactivation re-validates the raid and fails if it is not Run Setup selectable, without flipping isActive", async () => {
    const created = await runTemplateService.createTemplate(admin, inputFor({ name: "Raid goes historical" }));
    createdTemplateIds.push(created.id);
    await runTemplateService.deactivate(admin, created.id);

    await runTemplateRepository.update(created.id, {
      name: "Raid goes historical",
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      contents: [{ raidId: MANAFORGE_OMEGA_RAID_ID, sortOrder: 1, plannedBossCount: 1 }],
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      desiredLootbuddyCount: 0,
      notes: null,
      updatedById: ids.admin,
    });
    try {
      await expectDomainCode(runTemplateService.reactivate(admin, created.id), "RUN_TEMPLATE_UNUSABLE");
      expect((await runTemplateRepository.findById(created.id))?.isActive).toBe(false);
    } finally {
      await setRaidAvailable(raidId, true);
    }
  });
});

describe("runTemplateService.listUsableForCreation — global catalog", () => {
  it("RAID_LEAD sees every active usable global template", async () => {
    const first = await runTemplateService.createTemplate(admin, inputFor({ name: "Selector A" }));
    const second = await runTemplateService.createTemplate(admin, inputFor({ name: "Selector B" }));
    createdTemplateIds.push(first.id, second.id);

    const usable = await runTemplateService.listUsableForCreation(lead);
    expect(usable.some((t) => t.id === first.id)).toBe(true);
    expect(usable.some((t) => t.id === second.id)).toBe(true);
  });

  it("ADMIN sees the same usable global catalog", async () => {
    const first = await runTemplateService.createTemplate(admin, inputFor({ name: "Selector Admin A" }));
    const second = await runTemplateService.createTemplate(admin, inputFor({ name: "Selector Admin B" }));
    createdTemplateIds.push(first.id, second.id);

    const usable = await runTemplateService.listUsableForCreation(admin);
    expect(usable.some((t) => t.id === first.id)).toBe(true);
    expect(usable.some((t) => t.id === second.id)).toBe(true);
  });

  it("an inactive template never appears in the selector", async () => {
    const created = await runTemplateService.createTemplate(admin, inputFor({ name: "Selector Inactive" }));
    createdTemplateIds.push(created.id);
    await runTemplateService.deactivate(admin, created.id);

    const usable = await runTemplateService.listUsableForCreation(lead);
    expect(usable.some((t) => t.id === created.id)).toBe(false);
  });
});

describe("runTemplateService.resolveTemplateForUse — global template access", () => {
  it("RAID_LEAD may resolve any usable global template", async () => {
    const created = await runTemplateService.createTemplate(admin, inputFor({ name: "Resolve Global" }));
    createdTemplateIds.push(created.id);
    const resolved = await runTemplateService.resolveTemplateForUse(lead, created.id);
    expect(resolved.id).toBe(created.id);
  });

  it("ADMIN may resolve any usable template", async () => {
    const created = await runTemplateService.createTemplate(admin, inputFor({ name: "Resolve Admin" }));
    createdTemplateIds.push(created.id);
    const resolved = await runTemplateService.resolveTemplateForUse(admin, created.id);
    expect(resolved.id).toBe(created.id);
  });

  it("resolving a nonexistent template is rejected", async () => {
    await expectDomainCode(runTemplateService.resolveTemplateForUse(admin, crypto.randomUUID()), "RUN_TEMPLATE_NOT_FOUND");
  });

  it("resolving an inactive template is rejected", async () => {
    const created = await runTemplateService.createTemplate(admin, inputFor({ name: "Resolve Inactive" }));
    createdTemplateIds.push(created.id);
    await runTemplateService.deactivate(admin, created.id);
    await expectDomainCode(runTemplateService.resolveTemplateForUse(lead, created.id), "RUN_TEMPLATE_UNUSABLE");
  });
});
