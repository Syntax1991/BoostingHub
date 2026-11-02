import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freezeSystemTime, restoreSystemTime, SCHEDULE_TEST_CLOCK } from "@tests/fixtures/time";
import { VENOMOUS_ABYSS_PRODUCT_CONTENT_ID, VENOMOUS_ABYSS_PRODUCT_ID } from "@/lib/product-catalog";
import { seededProductSelection } from "@tests/fixtures/test-run-input";
import type { AuthenticatedUser } from "@/auth/authorization";
import { MAX_SLOTS_PER_PLAN } from "@/lib/community-schedule";
import { orm } from "@/lib/prisma";
import { TIDEBOUND_GROTTO_RAID_ID, VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { communityScheduleRepository } from "@/repositories/community-schedule.repository";
import { communityScheduleRunRepository } from "@/repositories/community-schedule-run.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { runTemplateRepository } from "@/repositories/run-template.repository";
import { communityScheduleMaterializationService } from "@/services/community-schedule-materialization.service";
import { communityScheduleService } from "@/services/community-schedule.service";
import { testActor } from "@tests/fixtures/actors";
import {
  assertIsolatedTestDatabase,
  createTestUser,
  deleteCreatedRows,
} from "@tests/fixtures/db-fixtures";
import { expectDomainError } from "@tests/helpers/domain-error";

const owned = {
  runIds: [] as string[],
  userIds: [] as string[],
  slotIds: [] as string[],
  templateIds: [] as string[],
};

let user: AuthenticatedUser;
let lead: AuthenticatedUser;
let leadB: AuthenticatedUser;
let admin: AuthenticatedUser;
let owner: AuthenticatedUser;
let inactiveLead: AuthenticatedUser;

const slotExtras = { runTemplateId: null as string | null, autoCreateRun: false, runMode: "INHOUSE" as const };

async function createUser(
  name: string,
  accountRole: AuthenticatedUser["accountRole"],
  accountStatus: AuthenticatedUser["accountStatus"] = "ACTIVE",
) {
  // OWNER is a single-row role; the stored row stays ADMIN and the actor carries OWNER.
  const storedRole = accountRole === "OWNER" ? "ADMIN" : accountRole;
  const id = await createTestUser({ name, accountRole: storedRole, accountStatus });
  owned.userIds.push(id);
  return testActor(id, accountRole, { name, accountStatus });
}

async function deleteOwnedScheduleRows() {
  assertIsolatedTestDatabase();
  for (const userId of owned.userIds) {
    const byCreator = (await orm.CommunityScheduleSlot.where({ createdById: userId }).select("id").all()) as Array<{
      id: string;
    }>;
    const byLead = (await orm.CommunityScheduleSlot.where({ raidLeadId: userId }).select("id").all()) as Array<{
      id: string;
    }>;
    for (const slot of [...byCreator, ...byLead]) {
      await orm.CommunityScheduleRun.where({ scheduleSlotId: slot.id }).deleteAndCount();
      await orm.CommunityScheduleSlot.where({ id: slot.id }).deleteAndCount();
    }
  }
  for (const id of owned.slotIds.splice(0)) {
    await orm.CommunityScheduleRun.where({ scheduleSlotId: id }).deleteAndCount();
    await orm.CommunityScheduleSlot.where({ id }).deleteAndCount();
  }
  for (const id of owned.templateIds.splice(0)) {
    await orm.CommunityScheduleSlot.where({ runTemplateId: id }).deleteAndCount();
    await orm.RunTemplate.where({ id }).deleteAndCount();
  }
  for (const userId of owned.userIds) {
    const templates = (await orm.RunTemplate.where({ createdById: userId }).select("id").all()) as Array<{ id: string }>;
    for (const template of templates) {
      await orm.CommunityScheduleSlot.where({ runTemplateId: template.id }).deleteAndCount();
      await orm.RunTemplate.where({ id: template.id }).deleteAndCount();
    }
  }
  const runIds = owned.runIds.splice(0);
  for (const runId of runIds) await orm.CommunityScheduleRun.where({ runId }).deleteAndCount();
  await deleteCreatedRows({ runIds });
  for (const userId of owned.userIds) {
    await orm.ActivityEvent.where({ userId }).deleteAndCount();
    const runs = (await orm.Run.where({ raidLeadId: userId }).select("id").all()) as Array<{ id: string }>;
    for (const run of runs) {
      await orm.CommunityScheduleRun.where({ runId: run.id }).deleteAndCount();
      await deleteCreatedRows({ runIds: [run.id] });
    }
  }
}

// Deterministic wall clock (see SCHEDULE_TEST_CLOCK); Run creation reads the real clock.
beforeEach(() => freezeSystemTime(SCHEDULE_TEST_CLOCK, { advance: true }));
afterEach(() => restoreSystemTime());

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  user = await createUser("CS User", "USER");
  lead = await createUser("CS Lead", "RAID_LEAD");
  leadB = await createUser("CS Lead B", "RAID_LEAD");
  admin = await createUser("CS Admin", "ADMIN");
  owner = await createUser("CS Owner", "OWNER");
  inactiveLead = await createUser("CS Inactive Lead", "RAID_LEAD", "DISABLED");
});

beforeEach(async () => {
  await deleteOwnedScheduleRows();
});

afterAll(async () => {
  await deleteOwnedScheduleRows();
  await deleteCreatedRows({ userIds: owned.userIds.splice(0) });
});

/** A signup row (withdrawn counts too): the Run is no longer Schedule-owned. */
async function addSignup(runId: string, userId: string, status: "PENDING" | "WITHDRAWN" = "PENDING") {
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id: crypto.randomUUID(),
    runId,
    userId,
    characterId: null,
    participationType: "LOOTBUDDY",
    isBackup: false,
    status,
    lootbuddyClass: "MAGE",
    createdAt: now,
    updatedAt: now,
  });
}

describe("communityScheduleService authorization", () => {
  it("USER cannot read or mutate", async () => {
    await expectDomainError(communityScheduleService.getPage(user), "NOT_AUTHORIZED");
    await expectDomainError(
      communityScheduleService.createSlot(user, {
        weekday: "FRIDAY",
        localStartTime: "19:45",
        label: "HC VIP",
        raidLeadId: lead.id,
        notes: null,
        ...slotExtras,
      }),
      "NOT_AUTHORIZED",
    );
  });

  it("RAID_LEAD can read but cannot mutate", async () => {
    const page = await communityScheduleService.getPage(lead);
    expect(page.canEdit).toBe(false);
    expect(page.current).toBeTruthy();
    expect(page.next).toBeTruthy();
    await expectDomainError(
      communityScheduleService.createSlot(lead, {
        weekday: "FRIDAY",
        localStartTime: "19:45",
        label: "HC VIP",
        raidLeadId: lead.id,
        notes: null,
        ...slotExtras,
      }),
      "NOT_AUTHORIZED",
    );
    await expectDomainError(communityScheduleService.deactivateSlot(lead, "aaaaaaaa-aaaa-4aaa-8aaa-csffffffff01"), "NOT_AUTHORIZED");
  });

  it("ADMIN and OWNER can create/edit/deactivate/reactivate", async () => {
    const { slot: created } = await communityScheduleService.createSlot(admin, {
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "HC VIP",
      raidLeadId: lead.id,
      notes: "Primary",
      ...slotExtras,
    });
    expect(created.isActive).toBe(true);

    const { slot: updated } = await communityScheduleService.updateSlot(owner, {
      slotId: created.id,
      weekday: "FRIDAY",
      localStartTime: "20:00",
      label: "HC VIP Late",
      raidLeadId: lead.id,
      notes: null,
      ...slotExtras,
    });
    expect(updated.localStartTime).toBe("20:00");
    expect(updated.label).toBe("HC VIP Late");

    const { slot: inactive } = await communityScheduleService.deactivateSlot(admin, created.id);
    expect(inactive.isActive).toBe(false);
    const { slot: active } = await communityScheduleService.reactivateSlot(owner, created.id);
    expect(active.isActive).toBe(true);
  });
});

describe("communityScheduleService domain", () => {
  it("rejects inactive or USER raid leads", async () => {
    await expectDomainError(
      communityScheduleService.createSlot(admin, {
        weekday: "SATURDAY",
        localStartTime: "18:00",
        label: "Gear",
        raidLeadId: user.id,
        notes: null,
        ...slotExtras,
      }),
      "COMMUNITY_SCHEDULE_RAID_LEAD_INVALID",
    );
    await expectDomainError(
      communityScheduleService.createSlot(admin, {
        weekday: "SATURDAY",
        localStartTime: "18:00",
        label: "Gear",
        raidLeadId: inactiveLead.id,
        notes: null,
        ...slotExtras,
      }),
      "COMMUNITY_SCHEDULE_RAID_LEAD_INVALID",
    );
  });

  it("rejects exact duplicate for same lead/day/time; allows different leads", async () => {
    await communityScheduleService.createSlot(admin, {
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "HC VIP A",
      raidLeadId: lead.id,
      notes: null,
      ...slotExtras,
    });
    await expectDomainError(
      communityScheduleService.createSlot(admin, {
        weekday: "FRIDAY",
        localStartTime: "19:45",
        label: "HC VIP B",
        raidLeadId: lead.id,
        notes: null,
        ...slotExtras,
      }),
      "COMMUNITY_SCHEDULE_DUPLICATE",
    );
    const { slot: parallel } = await communityScheduleService.createSlot(admin, {
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "HC VIP Parallel",
      raidLeadId: leadB.id,
      notes: null,
      ...slotExtras,
    });
    expect(parallel.raidLeadId).toBe(leadB.id);
  });

  it("projects CURRENT and NEXT; inactive slots excluded from windows", async () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    const { slot } = await communityScheduleService.createSlot(admin, {
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "HC VIP",
      raidLeadId: lead.id,
      notes: null,
      ...slotExtras,
    });
    const page = await communityScheduleService.getPage(admin, now);
    expect(page.current.days.some((d) => d.slots.some((s) => s.slot.id === slot.id))).toBe(true);
    expect(page.next.days.some((d) => d.slots.some((s) => s.slot.id === slot.id))).toBe(true);
    expect(page.current.days[0]?.slots[0]?.occurrence.localStartTime).toBe("19:45");

    await communityScheduleService.deactivateSlot(admin, slot.id);
    const after = await communityScheduleService.getPage(admin, now);
    expect(after.current.days.every((d) => d.slots.every((s) => s.slot.id !== slot.id))).toBe(true);
    expect(after.slots.some((s) => s.id === slot.id && !s.isActive)).toBe(true);
  });

  it("schedule mutations never create Run rows", async () => {
    const before = await orm.Run.select("id").all();
    const beforeCount = before.length;
    await communityScheduleService.createSlot(admin, {
      weekday: "SATURDAY",
      localStartTime: "22:30",
      label: "NM VIP",
      raidLeadId: lead.id,
      notes: "test",
      ...slotExtras,
    });
    const after = await orm.Run.select("id").all();
    expect(after.length).toBe(beforeCount);
  });
});

const createSetupFields = {
  name: "Plan HC Setup",
  ...seededProductSelection("VENOMOUS_ABYSS", 8),
  difficulty: "HEROIC" as const,
  lootType: "UNSAVED" as const,
  desiredTankCount: 2,
  desiredHealerCount: 4,
  desiredDpsCount: 14,
  desiredLootbuddyCount: 0,
  notes: null as string | null,
};

const repoTemplateFields = {
  name: "Plan HC Setup",
  difficulty: "HEROIC" as const,
  lootType: "UNSAVED" as const,
  contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 }],
  desiredTankCount: 2,
  desiredHealerCount: 4,
  desiredDpsCount: 14,
  desiredLootbuddyCount: 0,
  notes: null as string | null,
};

describe("communityScheduleService createSchedulePlan / addTimesToSetup", () => {
  it("creates a new Run Setup and 4 weekly slots atomically", async () => {
    const result = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: lead.id,
      runSetup: { mode: "create", ...createSetupFields },
      slots: [
        { weekday: "THURSDAY", localStartTime: "19:00", runMode: "INHOUSE" },
        { weekday: "FRIDAY", localStartTime: "19:45", runMode: "INHOUSE" },
        { weekday: "SATURDAY", localStartTime: "20:00", runMode: "INHOUSE" },
        { weekday: "SUNDAY", localStartTime: "18:30", runMode: "INHOUSE" },
      ],
      autoCreateRun: false,
      notes: "plan notes",
    });
    expect(result.slotIds).toHaveLength(4);
    const template = await runTemplateRepository.findById(result.templateId);
    expect(template?.name).toBe("Plan HC Setup");

    const slots = await Promise.all(result.slotIds.map((id) => communityScheduleRepository.findById(id)));
    expect(slots.every((slot) => slot?.label === "Plan HC Setup")).toBe(true);
    expect(slots.every((slot) => slot?.runTemplateId === result.templateId)).toBe(true);
    expect(slots.every((slot) => slot?.notes === "plan notes")).toBe(true);
  });

  it("adds slots to an existing Run Setup", async () => {
    const templateId = await runTemplateRepository.create({
      ...repoTemplateFields,
      name: "Existing Setup",
      createdById: admin.id,
      updatedById: admin.id,
    });
    const result = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: lead.id,
      runSetup: { mode: "existing", templateId },
      slots: [
        { weekday: "FRIDAY", localStartTime: "19:45", runMode: "INHOUSE" },
        { weekday: "SATURDAY", localStartTime: "20:00", runMode: "INHOUSE" },
      ],
      autoCreateRun: true,
      notes: null,
    });
    expect(result.templateId).toBe(templateId);
    expect(result.slotIds).toHaveLength(2);

    const added = await communityScheduleService.addTimesToSetup(admin, {
      runTemplateId: templateId,
      raidLeadId: lead.id,
      slots: [{ weekday: "SUNDAY", localStartTime: "17:00", runMode: "INHOUSE" }],
      autoCreateRun: false,
      notes: null,
    });
    expect(added.slotIds).toHaveLength(1);

    const page = await communityScheduleService.getPage(admin);
    const group = page.runSetups.find((row) => row.runTemplateId === templateId);
    expect(group?.slots).toHaveLength(3);
    expect(group?.autoCreateSummary).toBe("MIXED");
    // Shared Run Setup label: live name + short content title + run type.
    expect(group?.runSetupName).toBe("Existing Setup · Venom · HC Unsaved 8/8");
  });

  it("rolls back template + slots when a later slot create fails", async () => {
    const originalCreate = communityScheduleRepository.create.bind(communityScheduleRepository);
    let calls = 0;
    const spy = vi.spyOn(communityScheduleRepository, "create").mockImplementation(async (write, txOrm) => {
      calls += 1;
      if (calls === 2) {
        throw new Error("forced slot failure");
      }
      return originalCreate(write, txOrm);
    });

    try {
      await expect(
        communityScheduleService.createSchedulePlan(admin, {
          raidLeadId: lead.id,
          runSetup: { mode: "create", ...createSetupFields, name: "Rollback Setup" },
          slots: [
            { weekday: "FRIDAY", localStartTime: "19:45", runMode: "INHOUSE" },
            { weekday: "SATURDAY", localStartTime: "20:00", runMode: "INHOUSE" },
          ],
          autoCreateRun: false,
          notes: null,
        }),
      ).rejects.toThrow("forced slot failure");
    } finally {
      spy.mockRestore();
    }

    const templates = await orm.RunTemplate.all();
    expect(templates.some((row) => (row as { name: string }).name === "Rollback Setup")).toBe(false);
    const slots = await orm.CommunityScheduleSlot.where({ raidLeadId: lead.id }).all();
    expect(slots).toHaveLength(0);
  });

  it("rejects batch internal duplicates, max, and empty", async () => {
    await expectDomainError(
      communityScheduleService.createSchedulePlan(admin, {
        raidLeadId: lead.id,
        runSetup: { mode: "create", ...createSetupFields },
        slots: [
          { weekday: "FRIDAY", localStartTime: "19:45", runMode: "INHOUSE" },
          { weekday: "FRIDAY", localStartTime: "19:45", runMode: "INHOUSE" },
        ],
        autoCreateRun: false,
        notes: null,
      }),
      "COMMUNITY_SCHEDULE_BATCH_DUPLICATE",
    );

    await expectDomainError(
      communityScheduleService.createSchedulePlan(admin, {
        raidLeadId: lead.id,
        runSetup: { mode: "create", ...createSetupFields },
        slots: [],
        autoCreateRun: false,
        notes: null,
      }),
      "COMMUNITY_SCHEDULE_SLOTS_EMPTY",
    );

    const tooMany = Array.from({ length: MAX_SLOTS_PER_PLAN + 1 }, (_, index) => ({
      weekday: "FRIDAY" as const,
      localStartTime: `${String(10 + Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}`,
      runMode: "INHOUSE" as const,
    }));
    await expectDomainError(
      communityScheduleService.createSchedulePlan(admin, {
        raidLeadId: lead.id,
        runSetup: { mode: "create", ...createSetupFields },
        slots: tooMany,
        autoCreateRun: false,
        notes: null,
      }),
      "COMMUNITY_SCHEDULE_SLOTS_TOO_MANY",
    );
  });

  it("rejects conflict with existing slot; allows same time for different lead", async () => {
    await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: lead.id,
      runSetup: { mode: "create", ...createSetupFields, name: "Lead A Setup" },
      slots: [{ weekday: "FRIDAY", localStartTime: "19:45", runMode: "INHOUSE" }],
      autoCreateRun: false,
      notes: null,
    });

    await expectDomainError(
      communityScheduleService.createSchedulePlan(admin, {
        raidLeadId: lead.id,
        runSetup: { mode: "create", ...createSetupFields, name: "Lead A Dup" },
        slots: [{ weekday: "FRIDAY", localStartTime: "19:45", runMode: "INHOUSE" }],
        autoCreateRun: false,
        notes: null,
      }),
      "COMMUNITY_SCHEDULE_DUPLICATE",
    );

    const other = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: leadB.id,
      runSetup: { mode: "create", ...createSetupFields, name: "Lead B Setup" },
      slots: [{ weekday: "FRIDAY", localStartTime: "19:45", runMode: "INHOUSE" }],
      autoCreateRun: false,
      notes: null,
    });
    expect(other.slotIds).toHaveLength(1);
  });

  it("groups run setups including Unconfigured Schedule and MIXED auto-create", async () => {
    await communityScheduleService.createSlot(admin, {
      weekday: "MONDAY",
      localStartTime: "19:00",
      label: "Loose",
      raidLeadId: lead.id,
      notes: null,
      runTemplateId: null,
      autoCreateRun: false,
      runMode: "INHOUSE",
    });

    const templateId = await runTemplateRepository.create({
      ...repoTemplateFields,
      name: "Mixed Setup",
      createdById: admin.id,
      updatedById: admin.id,
    });
    await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: lead.id,
      runSetup: { mode: "existing", templateId },
      slots: [{ weekday: "TUESDAY", localStartTime: "19:00", runMode: "INHOUSE" }],
      autoCreateRun: true,
      notes: null,
    });
    await communityScheduleService.addTimesToSetup(admin, {
      runTemplateId: templateId,
      raidLeadId: lead.id,
      slots: [{ weekday: "WEDNESDAY", localStartTime: "19:00", runMode: "INHOUSE" }],
      autoCreateRun: false,
      notes: null,
    });

    const page = await communityScheduleService.getPage(admin);
    const unconfigured = page.runSetups.find((row) => row.runTemplateId == null);
    expect(unconfigured?.runSetupName).toBe("Unconfigured Schedule");
    const mixed = page.runSetups.find((row) => row.runTemplateId === templateId);
    expect(mixed?.autoCreateSummary).toBe("MIXED");
    expect(page.products.length).toBeGreaterThan(0);
  });

  it("RAID_LEAD cannot create schedule plans", async () => {
    await expectDomainError(
      communityScheduleService.createSchedulePlan(lead, {
        raidLeadId: lead.id,
        runSetup: { mode: "create", ...createSetupFields },
        slots: [{ weekday: "FRIDAY", localStartTime: "19:45", runMode: "INHOUSE" }],
        autoCreateRun: false,
        notes: null,
      }),
      "NOT_AUTHORIZED",
    );
  });

  it("updateRunSetup edits the shared template for ADMIN and rejects RAID_LEAD", async () => {
    const plan = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: lead.id,
      runSetup: { mode: "create", ...createSetupFields, name: "Edit Setup Target" },
      slots: [
        { weekday: "FRIDAY", localStartTime: "19:51", runMode: "INHOUSE" },
        { weekday: "SATURDAY", localStartTime: "18:51", runMode: "INHOUSE" },
      ],
      autoCreateRun: false,
      notes: null,
    });

    await expectDomainError(
      communityScheduleService.updateRunSetup(lead, {
        templateId: plan.templateId,
        name: "Hacked",
        ...seededProductSelection("VENOMOUS_ABYSS", 8),
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        desiredLootbuddyCount: 0,
        notes: null,
      }),
      "NOT_AUTHORIZED",
    );

    await communityScheduleService.updateRunSetup(admin, {
      templateId: plan.templateId,
      name: "Edited Setup Name",
      ...seededProductSelection("VENOMOUS_ABYSS", 7),
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      desiredLootbuddyCount: 0,
      notes: "updated notes",
    });

    const page = await communityScheduleService.getPage(admin);
    const group = page.runSetups.find((row) => row.runTemplateId === plan.templateId);
    expect(group?.runSetupName).toBe("Edited Setup Name · Venom · HC Unsaved 7/8");
    expect(group?.runSetupName).not.toContain("The Venomous Abyss");
    expect(group?.slots).toHaveLength(2);
    const option = page.templates.find((row) => row.id === plan.templateId);
    expect(option?.productId).toBe(VENOMOUS_ABYSS_PRODUCT_ID);
    expect(option?.contentBossCounts).toEqual({ [VENOMOUS_ABYSS_PRODUCT_CONTENT_ID]: 7 });
    expect(option?.notes).toBe("updated notes");
    expect(page.products.some((product) => product.key === "VENOMOUS_ABYSS")).toBe(true);
    expect(page.products.some((product) => product.key === "MIDNIGHT_S2_BUNDLE")).toBe(true);
  });

  it("exposes Season 2 Bundle product and materializes multi-content DRAFT Runs", async () => {
    await raidRepository.ensureReferenceRaids();
    const page = await communityScheduleService.getPage(admin);
    expect(page.products.map((product) => product.key).slice(0, 2)).toEqual([
      "VENOMOUS_ABYSS",
      "MIDNIGHT_S2_BUNDLE",
    ]);

    const now = new Date("2027-01-15T12:00:00.000Z");
    const result = await communityScheduleService.createSchedulePlan(
      admin,
      {
        raidLeadId: lead.id,
        runSetup: {
          mode: "create",
          name: "Bundle Setup",
          ...seededProductSelection("MIDNIGHT_S2_BUNDLE", 8),
          difficulty: "HEROIC",
          lootType: "VIP",
          desiredTankCount: 2,
          desiredHealerCount: 4,
          desiredDpsCount: 14,
          desiredLootbuddyCount: 0,
          notes: null,
        },
        slots: [{ weekday: "WEDNESDAY", localStartTime: "22:30", runMode: "INHOUSE" }],
        autoCreateRun: true,
        notes: null,
      },
      now,
    );
    // Saving only plans; the Monday 18 Jan 12:00 CET release creates the Wed 20 Jan raid ID's Draft.
    expect(await orm.CommunityScheduleRun.where({ scheduleSlotId: result.slotIds[0]! }).all()).toHaveLength(0);
    await communityScheduleMaterializationService.runPass(new Date("2027-01-18T11:00:00.000Z"));
    const template = await runTemplateRepository.findById(result.templateId);
    expect(template?.contents).toHaveLength(2);
    expect(template?.contents.map((row) => row.raidId).sort()).toEqual(
      [TIDEBOUND_GROTTO_RAID_ID, VENOMOUS_ABYSS_RAID_ID].sort(),
    );

    const slotId = result.slotIds[0]!;
    const links = await orm.CommunityScheduleRun.where({ scheduleSlotId: slotId }).all();
    expect(links.length).toBeGreaterThan(0);
    const runId = String((links[0] as { runId: string }).runId);
    const runContents = await orm.RunRaidContent.where({ runId }).all();
    expect(runContents).toHaveLength(2);
    expect(
      runContents.map((row) => String((row as { raidId: string }).raidId)).sort(),
    ).toEqual([TIDEBOUND_GROTTO_RAID_ID, VENOMOUS_ABYSS_RAID_ID].sort());

    // Regression: Prisma timestamptz readback must not hide linked DRAFTs as AUTO_WAITING.
    // Fri Jan 15 → Wed 22:30 CURRENT is past (no link); NEXT must resolve as RUN_CREATED.
    const afterPage = await communityScheduleService.getPage(admin, now);
    const nextProjected = afterPage.next.days
      .flatMap((day) => day.slots)
      .find((row) => row.slot.id === slotId);
    expect(nextProjected?.materialization.state).toBe("RUN_CREATED");
    expect(nextProjected?.materialization.runId).toBeTruthy();
  });

  it("Wed 00:30 slot: release pass at Wed 00:33 creates NEXT (released raid ID); page shows Open Run", async () => {
    await raidRepository.ensureReferenceRaids();
    // Wed 06 Jan 2027 00:33 Europe/Berlin (CET)
    const now = new Date("2027-01-05T23:33:00.000Z");
    // This test is about "now": the wall clock is exactly `now` (Run creation reads it).
    freezeSystemTime(now, { advance: true });
    const result = await communityScheduleService.createSchedulePlan(
      admin,
      {
        raidLeadId: lead.id,
        runSetup: {
          mode: "create",
          name: "Wed Boundary Bundle",
          ...seededProductSelection("MIDNIGHT_S2_BUNDLE", 8),
          difficulty: "HEROIC",
          lootType: "VIP",
          desiredTankCount: 2,
          desiredHealerCount: 4,
          desiredDpsCount: 14,
          desiredLootbuddyCount: 0,
          notes: null,
        },
        slots: [{ weekday: "WEDNESDAY", localStartTime: "00:30", runMode: "INHOUSE" }],
        autoCreateRun: true,
        notes: null,
      },
      now,
    );
    const pass = await communityScheduleMaterializationService.runPass(now);
    expect(pass.status === "COMPLETED" && pass.created).toBe(1);
    expect(pass.status === "COMPLETED" && pass.failed).toBe(0);

    const slotId = result.slotIds[0]!;
    const page = await communityScheduleService.getPage(admin, now);
    const current = page.current.days
      .flatMap((day) => day.slots)
      .find((row) => row.slot.id === slotId);
    const next = page.next.days
      .flatMap((day) => day.slots)
      .find((row) => row.slot.id === slotId);

    expect(current?.materialization.state).toBe("PAST");
    expect(current?.occurrence.scheduledStartAt).toBe("2027-01-05T23:30:00.000Z");
    expect(next?.materialization.state).toBe("RUN_CREATED");
    expect(next?.materialization.runId).toBeTruthy();
    expect(next?.occurrence.scheduledStartAt).toBe("2027-01-12T23:30:00.000Z");

    const runContents = await orm.RunRaidContent.where({ runId: next!.materialization.runId! }).all();
    expect(runContents).toHaveLength(2);
  });

  it("persists per-row Run Mode and Share uses authoritative template description", async () => {
    const plan = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: lead.id,
      runSetup: { mode: "create", ...createSetupFields, name: "Share Setup", contentBossCounts: { [VENOMOUS_ABYSS_PRODUCT_CONTENT_ID]: 7 }, lootType: "VIP" },
      slots: [
        { weekday: "FRIDAY", localStartTime: "23:00", runMode: "TEAM_RUN" },
        { weekday: "SATURDAY", localStartTime: "23:00", runMode: "INHOUSE" },
      ],
      autoCreateRun: false,
      notes: null,
    });
    const slots = await Promise.all(plan.slotIds.map((id) => communityScheduleRepository.findById(id)));
    expect(slots.map((slot) => slot?.runMode).sort()).toEqual(["INHOUSE", "TEAM_RUN"]);

    const page = await communityScheduleService.getPage(admin);
    expect(page.share.text).toContain("Teamrun");
    expect(page.share.text).toContain("inhouse");
    expect(page.share.text).toContain("7/8 HC VIP");
    expect(page.share.text).toContain("Please check which recurring Runs we have at the moment. 🙂");
  });
});

describe("communityScheduleService mutable planning delete", () => {
  it("ADMIN/OWNER delete slots; the future Schedule Draft is archived (not deleted), provenance survives", async () => {
    await expectDomainError(
      communityScheduleService.deleteSlot(admin, "00000000-0000-4000-8000-000000000099"),
      "COMMUNITY_SCHEDULE_NOT_FOUND",
    );

    const now = new Date("2027-01-15T12:00:00.000Z");
    const plan = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: lead.id,
      runSetup: { mode: "create", ...createSetupFields, name: "History Slot Setup" },
      slots: [
        { weekday: "FRIDAY", localStartTime: "19:45", runMode: "INHOUSE" },
        { weekday: "SATURDAY", localStartTime: "19:45", runMode: "INHOUSE" },
      ],
      autoCreateRun: false,
      notes: null,
    });
    const [materializedId, siblingId] = plan.slotIds;
    await expectDomainError(communityScheduleService.deleteSlot(user, materializedId!), "NOT_AUTHORIZED");
    await expectDomainError(communityScheduleService.deleteSlot(lead, materializedId!), "NOT_AUTHORIZED");

    const materialize = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: lead },
      { scheduleSlotId: materializedId!, window: "NEXT", now },
    );
    const runId = materialize.runId;
    const runBefore = (await orm.Run.where({ id: runId }).first()) as {
      scheduledStartAt: string;
      status: string;
      title: string;
    } | null;
    const contentBefore = await orm.RunRaidContent.where({ runId }).all();

    const deletedSlot = await communityScheduleService.deleteSlot(admin, materializedId!, now);
    expect(deletedSlot.cleanup.retiredDrafts).toBe(1);
    expect(await communityScheduleRepository.findById(materializedId!)).toBeNull();
    expect(await communityScheduleRepository.findById(siblingId!)).toBeTruthy();

    const runAfter = (await orm.Run.where({ id: runId }).first()) as {
      scheduledStartAt: string;
      status: string;
      title: string;
    } | null;
    // Retired (Cancel + Archive end state); the Run itself and its snapshot stay.
    expect(runBefore?.status).toBe("OPEN");
    expect(runAfter?.status).toBe("CANCELLED");
    expect(runAfter?.scheduledStartAt).toBe(runBefore?.scheduledStartAt);
    expect(runAfter?.title).toBe(runBefore?.title);
    expect(await orm.RunRaidContent.where({ runId }).all()).toHaveLength(contentBefore.length);

    const provenance = await communityScheduleRunRepository.findByRunId(runId);
    expect(provenance?.scheduleSlotId).toBeNull();
    expect(new Date(provenance!.occurrenceStartAt).getTime()).toBe(
      new Date(runBefore!.scheduledStartAt).getTime(),
    );

    await communityScheduleService.deleteSlot(owner, siblingId!);
    expect(await communityScheduleRepository.findById(siblingId!)).toBeNull();
    expect(await runTemplateRepository.findById(plan.templateId)).toBeTruthy();
  });

  it("deletes Run Setup after materialization; slots gone, a Run with signups unchanged", async () => {
    const emptyTemplateId = await runTemplateRepository.create({
      ...repoTemplateFields,
      name: "Orphan Setup",
      createdById: admin.id,
      updatedById: admin.id,
    });
    expect((await communityScheduleService.deleteRunSetup(admin, emptyTemplateId)).deletedSlotCount).toBe(
      0,
    );

    const now = new Date("2027-01-15T12:00:00.000Z");
    const plan = await communityScheduleService.createSchedulePlan(
      admin,
      {
        raidLeadId: lead.id,
        runSetup: {
          mode: "create",
          ...createSetupFields,
          name: "Historical Bundle Setup",
          ...seededProductSelection("MIDNIGHT_S2_BUNDLE"),
        },
        slots: [
          { weekday: "THURSDAY", localStartTime: "17:00", runMode: "INHOUSE" },
          { weekday: "FRIDAY", localStartTime: "17:00", runMode: "TEAM_RUN" },
        ],
        autoCreateRun: true,
        notes: null,
      },
      now,
    );
    // Weekly release (Mon 18 Jan 12:00 CET) creates the Runs (OPEN); someone signs up for the Thursday one.
    await communityScheduleMaterializationService.runPass(new Date("2027-01-18T11:00:00.000Z"));
    const links = await orm.CommunityScheduleRun.where({
      scheduleSlotId: plan.slotIds[0]!,
    }).all();
    expect(links.length).toBeGreaterThan(0);
    const runId = String((links[0] as { runId: string }).runId);
    await addSignup(runId, user.id);
    const runBefore = (await orm.Run.where({ id: runId }).first()) as {
      scheduledStartAt: string;
      status: string;
      title: string;
    } | null;

    const unrelated = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: leadB.id,
      runSetup: { mode: "create", ...createSetupFields, name: "Unrelated Keep" },
      slots: [{ weekday: "THURSDAY", localStartTime: "17:00", runMode: "INHOUSE" }],
      autoCreateRun: false,
      notes: null,
    });

    const page = await communityScheduleService.getPage(admin, now);
    expect(page.runSetupInventory.some((row) => row.id === plan.templateId && row.canDelete)).toBe(
      true,
    );

    const deleted = await communityScheduleService.deleteRunSetup(admin, plan.templateId, now);
    expect(deleted.deletedSlotCount).toBe(2);
    // The Thursday Run with a signup is protected; the Friday Run without signups is archived.
    expect(deleted.cleanup).toEqual({ retiredDrafts: 1, protectedRuns: 1, attachedRuns: 0 });
    expect(await runTemplateRepository.findById(plan.templateId)).toBeNull();
    expect(
      await orm.RunTemplateRaidContent.where({ runTemplateId: plan.templateId }).all(),
    ).toHaveLength(0);
    for (const slotId of plan.slotIds) {
      expect(await communityScheduleRepository.findById(slotId)).toBeNull();
    }

    const runAfter = (await orm.Run.where({ id: runId }).first()) as {
      scheduledStartAt: string;
      status: string;
      title: string;
    } | null;
    expect(runAfter?.scheduledStartAt).toBe(runBefore?.scheduledStartAt);
    expect(runAfter?.status).toBe(runBefore?.status);
    expect(runAfter?.title).toBe(runBefore?.title);
    expect((await communityScheduleRunRepository.findByRunId(runId))?.scheduleSlotId).toBeNull();

    expect(await runTemplateRepository.findById(unrelated.templateId)).toBeTruthy();
    expect(page.share.text.includes("Historical Bundle Setup")).toBe(false);
  });

  it("edit slot time after materialization leaves concrete Run snapshot unchanged", async () => {
    const now = new Date("2027-01-15T12:00:00.000Z");
    const plan = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: lead.id,
      runSetup: { mode: "create", ...createSetupFields, name: "Edit After Mat" },
      slots: [{ weekday: "FRIDAY", localStartTime: "23:00", runMode: "INHOUSE" }],
      autoCreateRun: false,
      notes: null,
    });
    const slotId = plan.slotIds[0]!;
    const created = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: lead },
      { scheduleSlotId: slotId, window: "NEXT", now },
    );
    const runBefore = (await orm.Run.where({ id: created.runId }).first()) as {
      scheduledStartAt: string;
    } | null;

    await communityScheduleService.updateSlot(
      admin,
      {
        slotId,
        weekday: "FRIDAY",
        localStartTime: "22:30",
        label: "Edit After Mat",
        notes: null,
        raidLeadId: lead.id,
        runTemplateId: plan.templateId,
        autoCreateRun: false,
        runMode: "INHOUSE",
      },
      now,
    );

    const runAfter = (await orm.Run.where({ id: created.runId }).first()) as {
      scheduledStartAt: string;
    } | null;
    expect(runAfter?.scheduledStartAt).toBe(runBefore?.scheduledStartAt);

    const page = await communityScheduleService.getPage(admin, now);
    const next = page.next.days.flatMap((d) => d.slots).find((row) => row.slot.id === slotId);
    expect(next?.occurrence.localStartTime).toBe("22:30");
  });

  it("multiple setups per lead, zero-slot inventory, duplicate Bundle, Use existing lists all", async () => {
    const a = await communityScheduleService.createRunSetup(admin, {
      ...createSetupFields,
      name: "HC VIP Bundle 9/9",
      ...seededProductSelection("MIDNIGHT_S2_BUNDLE", 8),
      lootType: "VIP",
    });
    const b = await communityScheduleService.createRunSetup(admin, {
      ...createSetupFields,
      name: "HC VIP Bundle 7/9",
      ...seededProductSelection("MIDNIGHT_S2_BUNDLE", 6),
      lootType: "VIP",
    });
    const c = await communityScheduleService.createRunSetup(admin, {
      ...createSetupFields,
      name: "HC VIP Venomous 8/8",
      ...seededProductSelection("VENOMOUS_ABYSS", 8),
      lootType: "VIP",
    });

    const page = await communityScheduleService.getPage(admin);
    expect(page.runSetupInventory.length).toBeGreaterThanOrEqual(3);
    expect(page.runSetupInventory.find((row) => row.id === a.id)?.slotCount).toBe(0);
    expect(page.runSetups.every((group) => group.runTemplateId !== a.id)).toBe(true);

    const usableIds = page.templates.filter((row) => row.usable).map((row) => row.id);
    expect(usableIds).toEqual(expect.arrayContaining([a.id, b.id, c.id]));

    const dup = await communityScheduleService.duplicateRunSetup(admin, a.id);
    expect(dup.id).not.toBe(a.id);
    const original = await runTemplateRepository.findById(a.id);
    const copy = await runTemplateRepository.findById(dup.id);
    expect(copy?.contents).toHaveLength(2);
    expect(copy?.contents.map((row) => row.raidId).sort()).toEqual(
      original?.contents.map((row) => row.raidId).sort(),
    );
    expect(copy?.name).toContain("(copy)");
    expect(await communityScheduleRepository.listByTemplateId(dup.id)).toHaveLength(0);

    await communityScheduleService.updateRunSetup(admin, {
      templateId: dup.id,
      name: "HC VIP Bundle 7/9 copy",
      ...seededProductSelection("MIDNIGHT_S2_BUNDLE", 6),
      difficulty: "HEROIC",
      lootType: "VIP",
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      desiredLootbuddyCount: 0,
      notes: null,
    });
    const originalAfter = await runTemplateRepository.findById(a.id);
    expect(
      originalAfter?.contents.find((row) => row.raidId === VENOMOUS_ABYSS_RAID_ID)?.plannedBossCount,
    ).toBe(8);

    await expectDomainError(communityScheduleService.createRunSetup(user, {
      ...createSetupFields,
      name: "Nope",
    }), "NOT_AUTHORIZED");
    await expectDomainError(communityScheduleService.duplicateRunSetup(lead, a.id), "NOT_AUTHORIZED");
  });

  it("RAID_LEAD and USER cannot delete Run Setup; missing setup rejected", async () => {
    const plan = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: lead.id,
      runSetup: { mode: "create", ...createSetupFields, name: "Auth Delete Setup" },
      slots: [{ weekday: "MONDAY", localStartTime: "12:00", runMode: "INHOUSE" }],
      autoCreateRun: false,
      notes: null,
    });
    await expectDomainError(communityScheduleService.deleteRunSetup(user, plan.templateId), "NOT_AUTHORIZED");
    await expectDomainError(communityScheduleService.deleteRunSetup(lead, plan.templateId), "NOT_AUTHORIZED");
    await expectDomainError(
      communityScheduleService.deleteRunSetup(admin, "00000000-0000-4000-8000-000000000098"),
      "RUN_TEMPLATE_NOT_FOUND",
    );
  });
});
