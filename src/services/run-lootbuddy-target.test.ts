import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { anyContentRunInput, futureTestIso, venomousUpdateInput, seededProductSelection } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { runTemplateRepository } from "@/repositories/run-template.repository";
import { rosterService } from "@/services/roster.service";
import { runDetailService } from "@/services/run-detail.service";
import { runService } from "@/services/run.service";
import { runTemplateService } from "@/services/run-template.service";
import { createRunSchema, updateRunSchema } from "@/validators/run";
import { createManyRunsSchema, type CreateManyRunsInput } from "@/validators/mass-create-runs";
import { createRunTemplateSchema } from "@/validators/run-template";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows } from "@/test/db-fixtures";
import { expectDomainError } from "@/test/domain-error";

/**
 * Run.desiredLootbuddyCount — a planning target only. It is never a role, never
 * a signup, and never counted into Tank/Healer/DPS.
 */

const created = { runIds: [] as string[], userIds: [] as string[] };
/** Templates restrict deleting their creator, so they go before the users. */
const createdTemplateIds: string[] = [];
const ids = { lead: "", admin: "", buddyA: "", buddyB: "", buddyC: "" };
let lead: AuthenticatedUser;
let admin: AuthenticatedUser;

async function createUser(name: string, accountRole: AuthenticatedUser["accountRole"] = "USER") {
  const id = await createTestUser({ name, accountRole });
  created.userIds.push(id);
  return id;
}

async function createRun(extra: Record<string, unknown> = {}) {
  const run = await runService.createRun(lead, anyContentRunInput({ scheduledStartAt: futureTestIso(), ...extra }));
  created.runIds.push(run.id);
  return run.id;
}

async function countSignups(runId: string) {
  return (await orm.RunSignup.where({ runId }).select("id").all()).length;
}

async function countLeadRuns() {
  return (await orm.Run.where({ raidLeadId: ids.lead }).select("id").all()).length;
}

async function addLootbuddySignup(runId: string, userId: string, status: "PENDING" | "WITHDRAWN" = "PENDING") {
  const id = crypto.randomUUID();
  await orm.RunSignup.create({
    id,
    runId,
    userId,
    characterId: null,
    participationType: "LOOTBUDDY",
    isBackup: false,
    status,
    publishedRole: null,
    lootbuddyClass: "MAGE",
    lootbuddyMode: "LOOT_ONLY",
    lootbuddyVerification: "NONE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

function massDefaults(overrides: Partial<CreateManyRunsInput["defaults"]> = {}): CreateManyRunsInput["defaults"] {
  return {
    ...seededProductSelection("VENOMOUS_ABYSS", 8),
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    ...overrides,
  };
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  ids.lead = await createUser("Lootbuddy Target Lead", "RAID_LEAD");
  ids.admin = await createUser("Lootbuddy Target Admin", "ADMIN");
  ids.buddyA = await createUser("Buddy A");
  ids.buddyB = await createUser("Buddy B");
  ids.buddyC = await createUser("Buddy C");
  lead = testActor(ids.lead, "RAID_LEAD");
  admin = testActor(ids.admin, "ADMIN");
});

afterAll(async () => {
  assertIsolatedTestDatabase();
  for (const id of createdTemplateIds) await orm.RunTemplate.where({ id }).deleteAndCount();
  await deleteCreatedRows(created);
});

describe("create — single Run", () => {
  it("persists the Lootbuddy target and creates no fake signups", async () => {
    const id = await createRun({ desiredLootbuddyCount: 2 });
    const run = await runRepository.findById(id);
    expect(run?.desiredLootbuddyCount).toBe(2);
    // Tank/Healer/DPS unchanged by the new target.
    expect([run?.desiredTankCount, run?.desiredHealerCount, run?.desiredDpsCount]).toEqual([2, 4, 14]);
    expect(await countSignups(id)).toBe(0);
  });

  it("an older caller that omits the field gets 0", async () => {
    const id = await createRun();
    expect((await runRepository.findById(id))?.desiredLootbuddyCount).toBe(0);
  });

  it("validates bounds 0–40 at the boundary and in the service", async () => {
    const base = anyContentRunInput({ scheduledStartAt: futureTestIso() });
    expect(createRunSchema.safeParse({ ...base, desiredLootbuddyCount: -1 }).success).toBe(false);
    expect(createRunSchema.safeParse({ ...base, desiredLootbuddyCount: 41 }).success).toBe(false);
    expect(createRunSchema.safeParse({ ...base, desiredLootbuddyCount: 1.5 }).success).toBe(false);
    expect(createRunSchema.safeParse({ ...base, desiredLootbuddyCount: 40 }).success).toBe(true);
    expect(createRunSchema.safeParse({ ...base, desiredLootbuddyCount: 0 }).success).toBe(true);

    const before = await countLeadRuns();
    await expectDomainError(
      runService.createRun(lead, anyContentRunInput({ scheduledStartAt: futureTestIso(), desiredLootbuddyCount: -1 })),
      "VALIDATION_FAILED",
    );
    expect(await countLeadRuns()).toBe(before);

    const upper = await createRun({ desiredLootbuddyCount: 40 });
    expect((await runRepository.findById(upper))?.desiredLootbuddyCount).toBe(40);
  });
});

describe("create — mass create", () => {
  it("applies the shared default, a per-row override, and different values per row", async () => {
    const result = await runService.createManyRuns(lead, {
      defaults: massDefaults({ desiredLootbuddyCount: 2 }),
      runs: [
        { scheduledStartAt: futureTestIso(40) },
        { scheduledStartAt: futureTestIso(41), overrides: { desiredLootbuddyCount: 5 } },
        { scheduledStartAt: futureTestIso(42), overrides: { desiredLootbuddyCount: 0 } },
      ],
    });
    created.runIds.push(...result.ids);
    const values = await Promise.all(result.ids.map(async (id) => (await runRepository.findById(id))?.desiredLootbuddyCount));
    expect(values).toEqual([2, 5, 0]);
  });

  it("omitted everywhere → 0", async () => {
    const result = await runService.createManyRuns(lead, {
      defaults: massDefaults(),
      runs: [{ scheduledStartAt: futureTestIso(43) }],
    });
    created.runIds.push(...result.ids);
    expect((await runRepository.findById(result.ids[0]!))?.desiredLootbuddyCount).toBe(0);
  });

  it("an invalid Lootbuddy override in one row rejects the whole batch atomically", async () => {
    expect(
      createManyRunsSchema.safeParse({
        defaults: massDefaults(),
        runs: [{ scheduledStartAt: futureTestIso(44), overrides: { desiredLootbuddyCount: 41 } }],
      }).success,
    ).toBe(false);

    const before = await countLeadRuns();
    await expectDomainError(
      runService.createManyRuns(lead, {
        defaults: massDefaults({ desiredLootbuddyCount: 1 }),
        runs: [
          { scheduledStartAt: futureTestIso(45) },
          { scheduledStartAt: futureTestIso(46), overrides: { desiredLootbuddyCount: -1 } },
        ],
      }),
      "VALIDATION_FAILED",
    );
    expect(await countLeadRuns()).toBe(before);
  });
});

describe("templates", () => {
  it("create stores the target, update changes it, omitted update keeps it, and the create form exposes it", async () => {
    const template = await runTemplateService.createTemplate(admin, {
      name: "Lootbuddy Target Template",
      ...seededProductSelection("VENOMOUS_ABYSS", 8),
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 12,
      desiredLootbuddyCount: 3,
      notes: null,
    });
    createdTemplateIds.push(template.id);
    expect((await runTemplateRepository.findById(template.id))?.desiredLootbuddyCount).toBe(3);

    const baseUpdate = {
      templateId: template.id,
      name: "Lootbuddy Target Template",
      ...seededProductSelection("VENOMOUS_ABYSS", 8),
      difficulty: "HEROIC" as const,
      lootType: "UNSAVED" as const,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 12,
      notes: null,
    };
    await runTemplateService.updateTemplate(admin, { ...baseUpdate, desiredLootbuddyCount: 4 });
    expect((await runTemplateRepository.findById(template.id))?.desiredLootbuddyCount).toBe(4);
    // An older client that does not know the field leaves the stored target alone.
    await runTemplateService.updateTemplate(admin, baseUpdate);
    const form = await runService.getCreateManyForm(lead);
    const applied = form.templates.find((item) => item.id === template.id);
    expect(applied?.desiredLootbuddyCount).toBe(4);
    expect(applied?.desiredDpsCount).toBe(12);
    expect(form.defaults.desiredLootbuddyCount).toBe(0);

    expect(createRunTemplateSchema.safeParse({ ...baseUpdate, desiredLootbuddyCount: 41 }).success).toBe(false);
  });

  it("a template created without the field defaults to 0", async () => {
    const template = await runTemplateService.createTemplate(admin, {
      name: "Legacy Template",
      ...seededProductSelection("VENOMOUS_ABYSS", 8),
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: null,
    });
    createdTemplateIds.push(template.id);
    expect((await runTemplateRepository.findById(template.id))?.desiredLootbuddyCount).toBe(0);
  });
});

describe("edit", () => {
  it("changes the target before Start, keeps it when an older caller omits it, and rejects out-of-range", async () => {
    const id = await createRun({ desiredLootbuddyCount: 1 });
    let run = (await runRepository.findById(id))!;
    await runService.updateRun(lead, venomousUpdateInput(id, run, { desiredLootbuddyCount: 3 }));
    run = (await runRepository.findById(id))!;
    expect(run.desiredLootbuddyCount).toBe(3);

    // venomousUpdateInput does not carry the field → an "older client" payload.
    await runService.updateRun(lead, venomousUpdateInput(id, run, { notes: "unrelated edit" }));
    run = (await runRepository.findById(id))!;
    expect(run.desiredLootbuddyCount).toBe(3);
    expect(run.notes).toBe("unrelated edit");

    expect(updateRunSchema.safeParse({ ...venomousUpdateInput(id, run), desiredLootbuddyCount: 41 }).success).toBe(false);

    // PUBLISHED is still editable (same lock as Tank/Healer/DPS).
    await runRepository.updateFields(id, { status: "PUBLISHED", signupsOpen: false });
    await runService.updateRun(lead, venomousUpdateInput(id, run, { desiredLootbuddyCount: 2 }));
    expect((await runRepository.findById(id))?.desiredLootbuddyCount).toBe(2);
  });

  it("is locked from Start on, exactly like the other composition targets", async () => {
    const id = await createRun({ desiredLootbuddyCount: 2 });
    for (const status of ["IN_PROGRESS", "COMPLETED", "CANCELLED"] as const) {
      await runRepository.updateFields(id, { status });
      const run = (await runRepository.findById(id))!;
      await expectDomainError(
        runService.updateRun(lead, venomousUpdateInput(id, run, { desiredLootbuddyCount: 5 })),
        "RUN_EDIT_LOCKED",
      );
      expect((await runRepository.findById(id))?.desiredLootbuddyCount).toBe(2);
    }
  });
});

describe("roster composition", () => {
  it("counts selected registered and external lootbuddies against their own target; withdrawn/unselected never count; boosters never count", async () => {
    // Booster targets 0 so every warning in this Run is about Lootbuddies.
    const id = await createRun({
      desiredTankCount: 0,
      desiredHealerCount: 0,
      desiredDpsCount: 0,
      desiredLootbuddyCount: 2,
    });
    await runService.openRun(lead, id);
    const selectedA = await addLootbuddySignup(id, ids.buddyA);
    await addLootbuddySignup(id, ids.buddyB); // registered, never selected
    await addLootbuddySignup(id, ids.buddyC, "WITHDRAWN");

    let view = await rosterService.getRosterManagementView(lead, id);
    expect(view.composition.lootbuddies).toEqual({ selected: 0, target: 2, delta: -2 });

    await rosterService.saveDraftSelection(lead, {
      runId: id,
      version: view.roster.version,
      selections: [{ signupId: selectedA, selectedRole: null }],
    });
    view = await rosterService.getRosterManagementView(lead, id);
    expect(view.composition.lootbuddies).toEqual({ selected: 1, target: 2, delta: -1 });
    expect([view.composition.tanks.selected, view.composition.healers.selected, view.composition.dps.selected]).toEqual([0, 0, 0]);
    expect(view.validation.canPublish).toBe(true);
    expect(view.validation.warnings).toEqual([
      expect.objectContaining({ code: "COMPOSITION_UNDER_TARGET", message: "Lootbuddy composition is 1 / 2." }),
    ]);

    // Under target: publishing needs the acknowledgement, exactly like a booster-role shortage.
    await expectDomainError(
      rosterService.publishRoster(lead, { runId: id, version: view.roster.version, acknowledgeWarnings: false }),
      "ROSTER_VALIDATION_FAILED",
    );

    // An external LOOTBUDDY counts as a lootbuddy; an external BOOSTER never does.
    await rosterService.saveExternalBoosters(lead, {
      runId: id,
      version: view.roster.version,
      externalBoosters: [
        { name: "Helper Loot", wowClass: "PRIEST", participationType: "LOOTBUDDY", role: null },
        { name: "Helper Dps", wowClass: "MAGE", participationType: "BOOSTER", role: "RANGED_DPS" },
      ],
    });
    view = await rosterService.getRosterManagementView(lead, id);
    expect(view.composition.lootbuddies).toEqual({ selected: 2, target: 2, delta: 0 });
    expect(view.composition.dps).toEqual({ selected: 1, target: 0, delta: 1 });
    expect(view.validation.warnings.map((w) => w.message)).toEqual(["DPS composition is 1 / 0."]);

    await rosterService.publishRoster(lead, { runId: id, version: view.roster.version, acknowledgeWarnings: true });

    // Final Setup: grouping unchanged, the target is shown next to the count.
    const detail = await runDetailService.getRunDetail(lead, id);
    const preview = detail.finalSetupPreview;
    expect(preview?.targets.lootbuddies).toBe(2);
    expect(preview?.groups.lootbuddies).toHaveLength(2);
    expect(preview?.groups.dps).toHaveLength(1);
    expect(preview?.groups.tanks).toHaveLength(0);

    // No planning target ever creates signups.
    expect(await countSignups(id)).toBe(3);
  });

  it("a legacy Run (target 0) with a selected lootbuddy gets an acknowledgeable over-target warning, never a blocker", async () => {
    const id = await createRun({ desiredTankCount: 0, desiredHealerCount: 0, desiredDpsCount: 0 });
    await runService.openRun(lead, id);
    const signupId = await addLootbuddySignup(id, ids.buddyA);
    let view = await rosterService.getRosterManagementView(lead, id);
    await rosterService.saveDraftSelection(lead, {
      runId: id,
      version: view.roster.version,
      selections: [{ signupId, selectedRole: null }],
    });
    view = await rosterService.getRosterManagementView(lead, id);
    expect(view.validation.canPublish).toBe(true);
    expect(view.validation.blockers).toEqual([]);
    expect(view.validation.warnings).toEqual([
      expect.objectContaining({ code: "COMPOSITION_OVER_TARGET", message: "Lootbuddy composition is 1 / 0." }),
    ]);
  });
});
