import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import type { PlanningProduct } from "@/lib/product-selection";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import type { AccountRole } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { runTemplateRepository } from "@/repositories/run-template.repository";
import { communityScheduleService } from "@/services/community-schedule.service";
import { contentCatalogService } from "@/services/content-catalog.service";
import { productPlanningService } from "@/services/product-planning.service";
import { runDetailService } from "@/services/run-detail.service";
import { runService } from "@/services/run.service";
import { runTemplateService } from "@/services/run-template.service";

/**
 * Product-driven planning regression: a Product created through the admin
 * catalog with an arbitrary key and THREE contents (VARIABLE first, then two
 * FIXED raids that are not offered for new Runs on their own) must appear in
 * every planning selector and be accepted by every submission path — with no
 * code change, no key allowlist and no bundle special case.
 */

const ids = {
  admin: "d1a0e000-0000-4000-8000-000000000001",
  lead: "d1a0e000-0000-4000-8000-000000000002",
};

function actor(id: string, accountRole: AccountRole): AuthenticatedUser {
  return {
    id,
    name: `Dynamic ${accountRole}`,
    email: `${id}@dynamic.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

const admin = actor(ids.admin, "ADMIN");
const lead = actor(ids.lead, "RAID_LEAD");

const created = { raids: [] as string[], productId: "", runs: [] as string[], templates: [] as string[] };
let raidA = "";
let raidB = "";
let product: PlanningProduct;
let venomousContentId = "";
let fixedAContentId = "";

function futureIso(days: number) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

async function expectCode(promise: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(isDomainError(caught) ? caught.code : caught).toBe(code);
}

async function runContents(runId: string) {
  const rows = (await orm.RunRaidContent.where({ runId }).all()) as Array<Record<string, unknown>>;
  return rows
    .map((row) => ({ raidId: String(row.raidId), sortOrder: Number(row.sortOrder), plannedBossCount: Number(row.plannedBossCount) }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

async function templateContents(templateId: string) {
  const template = await runTemplateRepository.findById(templateId);
  return (template?.contents ?? []).map((row) => ({
    raidId: row.raidId,
    sortOrder: row.sortOrder,
    plannedBossCount: row.plannedBossCount,
  }));
}

const runFields = {
  difficulty: "HEROIC" as const,
  lootType: "UNSAVED" as const,
  desiredTankCount: 2,
  desiredHealerCount: 4,
  desiredDpsCount: 14,
};

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  const now = new Date().toISOString();
  for (const [id, role] of [
    [ids.admin, "ADMIN"],
    [ids.lead, "RAID_LEAD"],
  ] as const) {
    await orm.User.where({ id }).delete().catch(() => {});
    await orm.User.create({
      id,
      name: `Dynamic ${role}`,
      email: `${id}@dynamic.boostting.local`,
      emailVerified: true,
      accountRole: role,
      accountStatus: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });
  }

  // Two new raids (not offered for new Runs on their own, like Tide / Kith'ix).
  const metadata = { season: "QA", sortOrder: 80, trackLockouts: false, blizzardInstanceId: null };
  raidA = (await contentCatalogService.createRaid(admin, { name: "QA Dynamic Raid A", ...metadata })).raidId;
  raidB = (await contentCatalogService.createRaid(admin, { name: "QA Dynamic Raid B", ...metadata })).raidId;
  created.raids.push(raidA, raidB);
  for (const [raidId, count] of [
    [raidA, 1],
    [raidB, 2],
  ] as const) {
    for (let index = 1; index <= count; index += 1) {
      await contentCatalogService.createEncounter(admin, { raidId, name: `Boss ${index}`, blizzardEncounterIds: [], wclEncounterIds: [] });
    }
  }

  // Persisted order: Venomous (VARIABLE) → Raid A (FIXED 1) → Raid B (FIXED 2).
  created.productId = (
    await contentCatalogService.createProduct(admin, {
      name: "QA Dynamic Three Content",
      active: true,
      selectable: true,
      sortOrder: 90,
      contents: [
        { raidId: VENOMOUS_ABYSS_RAID_ID, bossCountMode: "VARIABLE", fixedBossCount: null, minBossCount: 2, defaultBossCount: 6 },
        { raidId: raidA, bossCountMode: "FIXED", fixedBossCount: 1, minBossCount: null, defaultBossCount: null },
        { raidId: raidB, bossCountMode: "FIXED", fixedBossCount: 2, minBossCount: null, defaultBossCount: null },
      ],
    })
  ).productId;
  product = (await productPlanningService.listAll()).find((row) => row.id === created.productId)!;
  venomousContentId = product.contents[0]!.productRaidContentId;
  fixedAContentId = product.contents[1]!.productRaidContentId;
});

afterAll(async () => {
  for (const id of created.runs) await runRepository.deleteRun(id).catch(() => {});
  for (const id of created.templates) {
    await orm.CommunityScheduleSlot.where({ runTemplateId: id }).delete().catch(() => {});
    await orm.RunTemplate.where({ id }).delete().catch(() => {});
  }
  if (created.productId) await orm.Product.where({ id: created.productId }).delete().catch(() => {});
  for (const id of created.raids) await orm.Raid.where({ id }).delete().catch(() => {});
  for (const id of Object.values(ids)) await orm.User.where({ id }).delete().catch(() => {});
});

describe("dynamic three-content product", () => {
  it("is read from the DB with ordered contents, raid names and encounter counts", () => {
    expect(product.contents.map((row) => [row.raidId, row.bossCountMode, row.totalBossCount, row.sortOrder])).toEqual([
      [VENOMOUS_ABYSS_RAID_ID, "VARIABLE", 8, 1],
      [raidA, "FIXED", 1, 2],
      [raidB, "FIXED", 2, 3],
    ]);
    expect(product.contents.map((row) => row.raidName)).toEqual(["The Venomous Abyss", "QA Dynamic Raid A", "QA Dynamic Raid B"]);
  });

  it("appears in every planning selector", async () => {
    const has = (products: readonly { key: string }[]) => products.some((row) => row.key === "QA_DYNAMIC_THREE_CONTENT");
    expect(has(await productPlanningService.listSelectable())).toBe(true);
    expect(has((await runService.getCreateForm(lead)).products)).toBe(true);
    expect(has((await runService.getCreateManyForm(lead)).products)).toBe(true);
    expect(has((await runTemplateService.getCreateFormData(admin)).products)).toBe(true);
    expect(has((await communityScheduleService.getPage(admin)).products)).toBe(true);
  });

  it("Create Run snapshots exactly three ordered contents; FIXED is server-forced", async () => {
    const { id } = await runService.createRun(lead, {
      ...runFields,
      scheduledStartAt: futureIso(30),
      productId: product.id,
      // A forged FIXED count is ignored — the server forces the product's value.
      contentBossCounts: { [venomousContentId]: 5, [fixedAContentId]: 1 },
    });
    created.runs.push(id);
    expect(await runContents(id)).toEqual([
      { raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 5 },
      { raidId: raidA, sortOrder: 2, plannedBossCount: 1 },
      { raidId: raidB, sortOrder: 3, plannedBossCount: 2 },
    ]);
    const run = await runRepository.findById(id);
    expect(run?.title).toContain("8/11");
  });

  it("validates VARIABLE counts against the product minimum and the raid total", async () => {
    const base = { ...runFields, scheduledStartAt: futureIso(31), productId: product.id };
    await expectCode(runService.createRun(lead, { ...base, contentBossCounts: { [venomousContentId]: 1 } }), "RUN_BOSS_COUNT_INVALID");
    await expectCode(runService.createRun(lead, { ...base, contentBossCounts: { [venomousContentId]: 9 } }), "RUN_BOSS_COUNT_INVALID");
    await expectCode(runService.createRun(lead, { ...base, contentBossCounts: { "not-a-content": 3 } }), "RUN_PRODUCT_SELECTION_INVALID");
  });

  it("Mass Create accepts it for every row with per-row counts", async () => {
    const { ids: runIds } = await runService.createManyRuns(lead, {
      defaults: { ...runFields, productId: product.id, contentBossCounts: { [venomousContentId]: 8 } },
      runs: [
        { scheduledStartAt: futureIso(32) },
        { scheduledStartAt: futureIso(33), overrides: { contentBossCounts: { [venomousContentId]: 3 } } },
      ],
    });
    created.runs.push(...runIds);
    expect((await runContents(runIds[0]!)).map((row) => row.plannedBossCount)).toEqual([8, 1, 2]);
    expect((await runContents(runIds[1]!)).map((row) => row.plannedBossCount)).toEqual([3, 1, 2]);
  });

  it("Run Setup and Schedule Run Setup snapshot three ordered template contents", async () => {
    const setup = await runTemplateService.createTemplate(admin, {
      name: "QA Dynamic Setup",
      ...runFields,
      productId: product.id,
      contentBossCounts: { [venomousContentId]: 4 },
      notes: null,
    });
    created.templates.push(setup.id);
    expect(await templateContents(setup.id)).toEqual([
      { raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 4 },
      { raidId: raidA, sortOrder: 2, plannedBossCount: 1 },
      { raidId: raidB, sortOrder: 3, plannedBossCount: 2 },
    ]);
    expect((await runTemplateService.listUsableForCreation(lead)).some((row) => row.id === setup.id)).toBe(true);

    const plan = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: ids.lead,
      runSetup: { mode: "create", name: "QA Dynamic Schedule Setup", ...runFields, desiredLootbuddyCount: 0, productId: product.id, notes: null },
      slots: [{ weekday: "SUNDAY", localStartTime: "06:15", runMode: "INHOUSE" }],
      autoCreateRun: false,
      notes: null,
      compositionOverrideEnabled: false,
    } as Parameters<typeof communityScheduleService.createSchedulePlan>[1]);
    const scheduleTemplateId = (plan as { data?: { templateId: string }; templateId?: string }).data?.templateId
      ?? (plan as { templateId?: string }).templateId!;
    created.templates.push(scheduleTemplateId);
    expect((await templateContents(scheduleTemplateId)).map((row) => row.plannedBossCount)).toEqual([6, 1, 2]);

    // Materializing the setup keeps all three contents (no raid-availability block).
    const draft = await runService.prepareDraftFromTemplate({
      template: (await runTemplateRepository.findById(setup.id))!,
      scheduledStartAt: futureIso(34),
      raidLeadId: ids.lead,
    });
    expect(draft.contents.map((row) => [row.raidId, row.plannedBossCount])).toEqual([
      [VENOMOUS_ABYSS_RAID_ID, 4],
      [raidA, 1],
      [raidB, 2],
    ]);
  });

  it("Edit Run preselects the product, keeps contents without product fields and re-expands on change", async () => {
    const { id } = await runService.createRun(lead, {
      ...runFields,
      scheduledStartAt: futureIso(35),
      productId: product.id,
      contentBossCounts: { [venomousContentId]: 7 },
    });
    created.runs.push(id);
    const detail = await runDetailService.getRunDetail(lead, id);
    expect(detail.editor?.currentSelection).toEqual({ productId: product.id, contentBossCounts: { [venomousContentId]: 7 } });

    const run = (await runRepository.findById(id))!;
    const base = {
      runId: id,
      difficulty: run.difficulty,
      lootType: run.lootType,
      scheduledStartAt: run.scheduledStartAt,
      notes: "kept",
      desiredTankCount: run.desiredTankCount,
      desiredHealerCount: run.desiredHealerCount,
      desiredDpsCount: run.desiredDpsCount,
    };
    await runService.updateRun(lead, base);
    expect((await runContents(id)).map((row) => row.plannedBossCount)).toEqual([7, 1, 2]);
    await runService.updateRun(lead, { ...base, productId: product.id, contentBossCounts: { [venomousContentId]: 2 } });
    expect((await runContents(id)).map((row) => row.plannedBossCount)).toEqual([2, 1, 2]);
  });

  it("selectable=false hides it from new selection; existing Runs and Setups stay unchanged and usable", async () => {
    const before = await Promise.all(created.runs.map(runContents));
    const setupId = created.templates[0]!;
    const setupBefore = await templateContents(setupId);
    await contentCatalogService.setProductSelectable(admin, product.id, false);
    try {
      const has = (products: readonly { key: string }[]) => products.some((row) => row.key === "QA_DYNAMIC_THREE_CONTENT");
      expect(has(await productPlanningService.listSelectable())).toBe(false);
      expect(has((await runService.getCreateForm(lead)).products)).toBe(false);
      expect(has((await runService.getCreateManyForm(lead)).products)).toBe(false);
      expect(has((await runTemplateService.getCreateFormData(admin)).products)).toBe(false);
      expect(has((await communityScheduleService.getPage(admin)).products)).toBe(false);
      await expectCode(
        runService.createRun(lead, { ...runFields, scheduledStartAt: futureIso(36), productId: product.id }),
        "RUN_PRODUCT_UNAVAILABLE",
      );
      expect(await Promise.all(created.runs.map(runContents))).toEqual(before);
      expect(await templateContents(setupId)).toEqual(setupBefore);
      // Hidden but active: the existing setup stays usable.
      expect((await runTemplateService.listUsableForCreation(lead)).some((row) => row.id === setupId)).toBe(true);

      // Inactive: the setup's raids are not standalone-available → no longer usable.
      await contentCatalogService.setProductActive(admin, product.id, false);
      expect((await runTemplateService.listUsableForCreation(lead)).some((row) => row.id === setupId)).toBe(false);
    } finally {
      await contentCatalogService.setProductActive(admin, product.id, true);
      await contentCatalogService.setProductSelectable(admin, product.id, true);
    }
  });

  it("loads the planning catalog in a bounded number of queries, independent of product count", async () => {
    const { Client } = await import("pg");
    const { vi } = await import("vitest");
    const spy = vi.spyOn(Client.prototype, "query");
    try {
      await productPlanningService.listAll();
      const baseline = spy.mock.calls.length;
      expect(baseline).toBeLessThanOrEqual(4);
      const extra = await contentCatalogService.createProduct(admin, {
        name: "QA Dynamic Extra",
        active: true,
        selectable: true,
        sortOrder: 91,
        contents: [{ raidId: raidB, bossCountMode: "FIXED", fixedBossCount: 1, minBossCount: null, defaultBossCount: null }],
      });
      spy.mockClear();
      await productPlanningService.listAll();
      expect(spy.mock.calls.length).toBe(baseline);
      await orm.Product.where({ id: extra.productId }).delete();
    } finally {
      spy.mockRestore();
    }
  });
});
