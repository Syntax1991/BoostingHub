import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { MAX_SLOTS_PER_PLAN } from "@/lib/community-schedule";
import { orm } from "@/lib/prisma";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import type { AccountRole } from "@/models/enums";
import { communityScheduleRepository } from "@/repositories/community-schedule.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { runTemplateRepository } from "@/repositories/run-template.repository";
import { communityScheduleService } from "@/services/community-schedule.service";

const ids = {
  user: "aaaaaaaa-aaaa-4aaa-8aaa-cs0000000001",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-cs0000000002",
  leadB: "aaaaaaaa-aaaa-4aaa-8aaa-cs0000000003",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-cs0000000004",
  owner: "aaaaaaaa-aaaa-4aaa-8aaa-cs0000000005",
  inactiveLead: "aaaaaaaa-aaaa-4aaa-8aaa-cs0000000006",
};

function asUser(id: string, name: string, accountRole: AccountRole): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@cs.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createUser(
  id: string,
  name: string,
  accountRole: AccountRole,
  accountStatus: "ACTIVE" | "DISABLED" = "ACTIVE",
) {
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name,
    email: `${id}@cs.boostting.local`,
    emailVerified: true,
    accountRole: accountRole === "OWNER" ? "ADMIN" : accountRole,
    accountStatus,
    createdAt: now,
    updatedAt: now,
  });
}

const slotExtras = { runTemplateId: null as string | null, autoCreateRun: false };

const testUserIds = new Set(Object.values(ids));

async function cleanupSlots() {
  const rows = await orm.CommunityScheduleSlot.all();
  const ownSlots = rows.filter((row) => {
    const slot = row as { id: string; raidLeadId: string; createdById: string };
    return testUserIds.has(slot.raidLeadId) || testUserIds.has(slot.createdById);
  });
  const ownSlotIds = new Set(ownSlots.map((row) => String((row as { id: string }).id)));

  const links = await orm.CommunityScheduleRun.all();
  for (const row of links) {
    const link = row as { id: string; runId: string; scheduleSlotId: string };
    if (!ownSlotIds.has(link.scheduleSlotId)) continue;
    await orm.CommunityScheduleRun.where({ id: link.id }).delete().catch(() => {});
    await orm.RunRoster.where({ runId: link.runId }).delete().catch(() => {});
    await orm.RunRaidContent.where({ runId: link.runId }).delete().catch(() => {});
    await orm.Run.where({ id: link.runId }).delete().catch(() => {});
  }
  for (const row of ownSlots) {
    await orm.CommunityScheduleSlot.where({ id: String((row as { id: string }).id) })
      .delete()
      .catch(() => {});
  }

  for (const leadId of Object.values(ids)) {
    const templates = await orm.RunTemplate.where({ raidLeadId: leadId }).all();
    for (const row of templates) {
      await orm.RunTemplate.where({ id: String((row as { id: string }).id) }).delete().catch(() => {});
    }
  }
}

async function cleanupUsers() {
  for (const id of Object.values(ids)) {
    await orm.User.where({ id }).delete().catch(() => {});
  }
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

const user = asUser(ids.user, "CS User", "USER");
const lead = asUser(ids.lead, "CS Lead", "RAID_LEAD");
const admin = asUser(ids.admin, "CS Admin", "ADMIN");
const owner = asUser(ids.owner, "CS Owner", "OWNER");

beforeAll(async () => {
  await cleanupSlots();
  await cleanupUsers();
  await createUser(ids.user, "CS User", "USER");
  await createUser(ids.lead, "CS Lead", "RAID_LEAD");
  await createUser(ids.leadB, "CS Lead B", "RAID_LEAD");
  await createUser(ids.admin, "CS Admin", "ADMIN");
  await createUser(ids.owner, "CS Owner", "OWNER");
  await createUser(ids.inactiveLead, "CS Inactive Lead", "RAID_LEAD", "DISABLED");
  await raidRepository.ensureReferenceRaids();
});

beforeEach(async () => {
  await cleanupSlots();
});

afterAll(async () => {
  await cleanupSlots();
  await cleanupUsers();
});

describe("communityScheduleService authorization", () => {
  it("USER cannot read or mutate", async () => {
    await expectCode(communityScheduleService.getPage(user), "NOT_AUTHORIZED");
    await expectCode(
      communityScheduleService.createSlot(user, {
        weekday: "FRIDAY",
        localStartTime: "19:45",
        label: "HC VIP",
        raidLeadId: ids.lead,
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
    await expectCode(
      communityScheduleService.createSlot(lead, {
        weekday: "FRIDAY",
        localStartTime: "19:45",
        label: "HC VIP",
        raidLeadId: ids.lead,
        notes: null,
        ...slotExtras,
      }),
      "NOT_AUTHORIZED",
    );
    await expectCode(communityScheduleService.deactivateSlot(lead, "aaaaaaaa-aaaa-4aaa-8aaa-csffffffff01"), "NOT_AUTHORIZED");
  });

  it("ADMIN and OWNER can create/edit/deactivate/reactivate", async () => {
    const created = await communityScheduleService.createSlot(admin, {
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "HC VIP",
      raidLeadId: ids.lead,
      notes: "Primary",
      ...slotExtras,
    });
    expect(created.isActive).toBe(true);

    const updated = await communityScheduleService.updateSlot(owner, {
      slotId: created.id,
      weekday: "FRIDAY",
      localStartTime: "20:00",
      label: "HC VIP Late",
      raidLeadId: ids.lead,
      notes: null,
      ...slotExtras,
    });
    expect(updated.localStartTime).toBe("20:00");
    expect(updated.label).toBe("HC VIP Late");

    const inactive = await communityScheduleService.deactivateSlot(admin, created.id);
    expect(inactive.isActive).toBe(false);
    const active = await communityScheduleService.reactivateSlot(owner, created.id);
    expect(active.isActive).toBe(true);
  });
});

describe("communityScheduleService domain", () => {
  it("rejects inactive or USER raid leads", async () => {
    await expectCode(
      communityScheduleService.createSlot(admin, {
        weekday: "SATURDAY",
        localStartTime: "18:00",
        label: "Gear",
        raidLeadId: ids.user,
        notes: null,
        ...slotExtras,
      }),
      "COMMUNITY_SCHEDULE_RAID_LEAD_INVALID",
    );
    await expectCode(
      communityScheduleService.createSlot(admin, {
        weekday: "SATURDAY",
        localStartTime: "18:00",
        label: "Gear",
        raidLeadId: ids.inactiveLead,
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
      raidLeadId: ids.lead,
      notes: null,
      ...slotExtras,
    });
    await expectCode(
      communityScheduleService.createSlot(admin, {
        weekday: "FRIDAY",
        localStartTime: "19:45",
        label: "HC VIP B",
        raidLeadId: ids.lead,
        notes: null,
        ...slotExtras,
      }),
      "COMMUNITY_SCHEDULE_DUPLICATE",
    );
    const parallel = await communityScheduleService.createSlot(admin, {
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "HC VIP Parallel",
      raidLeadId: ids.leadB,
      notes: null,
      ...slotExtras,
    });
    expect(parallel.raidLeadId).toBe(ids.leadB);
  });

  it("projects CURRENT and NEXT; inactive slots excluded from windows", async () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    const slot = await communityScheduleService.createSlot(admin, {
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "HC VIP",
      raidLeadId: ids.lead,
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
      raidLeadId: ids.lead,
      notes: "test",
      ...slotExtras,
    });
    const after = await orm.Run.select("id").all();
    expect(after.length).toBe(beforeCount);
  });
});

const createSetupFields = {
  name: "Plan HC Setup",
  raidId: VENOMOUS_ABYSS_RAID_ID,
  difficulty: "HEROIC" as const,
  lootType: "UNSAVED" as const,
  plannedBossCount: 8,
  desiredTankCount: 2,
  desiredHealerCount: 4,
  desiredDpsCount: 14,
  desiredLootbuddyCount: 0,
  notes: null as string | null,
};

describe("communityScheduleService createSchedulePlan / addTimesToSetup", () => {
  it("creates a new Run Setup and 4 weekly slots atomically", async () => {
    const result = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: ids.lead,
      runSetup: { mode: "create", ...createSetupFields },
      slots: [
        { weekday: "THURSDAY", localStartTime: "19:00" },
        { weekday: "FRIDAY", localStartTime: "19:45" },
        { weekday: "SATURDAY", localStartTime: "20:00" },
        { weekday: "SUNDAY", localStartTime: "18:30" },
      ],
      autoCreateRun: false,
      notes: "plan notes",
    });
    expect(result.slotIds).toHaveLength(4);
    const template = await runTemplateRepository.findById(result.templateId);
    expect(template?.name).toBe("Plan HC Setup");
    expect(template?.raidLeadId).toBe(ids.lead);

    const slots = await Promise.all(result.slotIds.map((id) => communityScheduleRepository.findById(id)));
    expect(slots.every((slot) => slot?.label === "Plan HC Setup")).toBe(true);
    expect(slots.every((slot) => slot?.runTemplateId === result.templateId)).toBe(true);
    expect(slots.every((slot) => slot?.notes === "plan notes")).toBe(true);
  });

  it("adds slots to an existing Run Setup", async () => {
    const templateId = await runTemplateRepository.create({
      ...createSetupFields,
      name: "Existing Setup",
      raidLeadId: ids.lead,
      createdById: ids.admin,
      updatedById: ids.admin,
    });
    const result = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: ids.lead,
      runSetup: { mode: "existing", templateId },
      slots: [
        { weekday: "FRIDAY", localStartTime: "19:45" },
        { weekday: "SATURDAY", localStartTime: "20:00" },
      ],
      autoCreateRun: true,
      notes: null,
    });
    expect(result.templateId).toBe(templateId);
    expect(result.slotIds).toHaveLength(2);

    const added = await communityScheduleService.addTimesToSetup(admin, {
      runTemplateId: templateId,
      raidLeadId: ids.lead,
      slots: [{ weekday: "SUNDAY", localStartTime: "17:00" }],
      autoCreateRun: false,
      notes: null,
    });
    expect(added.slotIds).toHaveLength(1);

    const page = await communityScheduleService.getPage(admin);
    const group = page.runSetups.find((row) => row.runTemplateId === templateId);
    expect(group?.slots).toHaveLength(3);
    expect(group?.autoCreateSummary).toBe("MIXED");
    expect(group?.runSetupName).toBe("Existing Setup");
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
          raidLeadId: ids.lead,
          runSetup: { mode: "create", ...createSetupFields, name: "Rollback Setup" },
          slots: [
            { weekday: "FRIDAY", localStartTime: "19:45" },
            { weekday: "SATURDAY", localStartTime: "20:00" },
          ],
          autoCreateRun: false,
          notes: null,
        }),
      ).rejects.toThrow("forced slot failure");
    } finally {
      spy.mockRestore();
    }

    const templates = await orm.RunTemplate.where({ raidLeadId: ids.lead }).all();
    expect(templates.some((row) => (row as { name: string }).name === "Rollback Setup")).toBe(false);
    const slots = await orm.CommunityScheduleSlot.where({ raidLeadId: ids.lead }).all();
    expect(slots).toHaveLength(0);
  });

  it("rejects batch internal duplicates, max, and empty", async () => {
    await expectCode(
      communityScheduleService.createSchedulePlan(admin, {
        raidLeadId: ids.lead,
        runSetup: { mode: "create", ...createSetupFields },
        slots: [
          { weekday: "FRIDAY", localStartTime: "19:45" },
          { weekday: "FRIDAY", localStartTime: "19:45" },
        ],
        autoCreateRun: false,
        notes: null,
      }),
      "COMMUNITY_SCHEDULE_BATCH_DUPLICATE",
    );

    await expectCode(
      communityScheduleService.createSchedulePlan(admin, {
        raidLeadId: ids.lead,
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
    }));
    await expectCode(
      communityScheduleService.createSchedulePlan(admin, {
        raidLeadId: ids.lead,
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
      raidLeadId: ids.lead,
      runSetup: { mode: "create", ...createSetupFields, name: "Lead A Setup" },
      slots: [{ weekday: "FRIDAY", localStartTime: "19:45" }],
      autoCreateRun: false,
      notes: null,
    });

    await expectCode(
      communityScheduleService.createSchedulePlan(admin, {
        raidLeadId: ids.lead,
        runSetup: { mode: "create", ...createSetupFields, name: "Lead A Dup" },
        slots: [{ weekday: "FRIDAY", localStartTime: "19:45" }],
        autoCreateRun: false,
        notes: null,
      }),
      "COMMUNITY_SCHEDULE_DUPLICATE",
    );

    const other = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: ids.leadB,
      runSetup: { mode: "create", ...createSetupFields, name: "Lead B Setup" },
      slots: [{ weekday: "FRIDAY", localStartTime: "19:45" }],
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
      raidLeadId: ids.lead,
      notes: null,
      runTemplateId: null,
      autoCreateRun: false,
    });

    const templateId = await runTemplateRepository.create({
      ...createSetupFields,
      name: "Mixed Setup",
      raidLeadId: ids.lead,
      createdById: ids.admin,
      updatedById: ids.admin,
    });
    await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: ids.lead,
      runSetup: { mode: "existing", templateId },
      slots: [{ weekday: "TUESDAY", localStartTime: "19:00" }],
      autoCreateRun: true,
      notes: null,
    });
    await communityScheduleService.addTimesToSetup(admin, {
      runTemplateId: templateId,
      raidLeadId: ids.lead,
      slots: [{ weekday: "WEDNESDAY", localStartTime: "19:00" }],
      autoCreateRun: false,
      notes: null,
    });

    const page = await communityScheduleService.getPage(admin);
    const unconfigured = page.runSetups.find((row) => row.runTemplateId == null);
    expect(unconfigured?.runSetupName).toBe("Unconfigured Schedule");
    const mixed = page.runSetups.find((row) => row.runTemplateId === templateId);
    expect(mixed?.autoCreateSummary).toBe("MIXED");
    expect(page.raids.length).toBeGreaterThan(0);
  });

  it("RAID_LEAD cannot create schedule plans", async () => {
    await expectCode(
      communityScheduleService.createSchedulePlan(lead, {
        raidLeadId: ids.lead,
        runSetup: { mode: "create", ...createSetupFields },
        slots: [{ weekday: "FRIDAY", localStartTime: "19:45" }],
        autoCreateRun: false,
        notes: null,
      }),
      "NOT_AUTHORIZED",
    );
  });

  it("updateRunSetup edits the shared template for ADMIN and rejects RAID_LEAD", async () => {
    const plan = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: ids.lead,
      runSetup: { mode: "create", ...createSetupFields, name: "Edit Setup Target" },
      slots: [
        { weekday: "FRIDAY", localStartTime: "19:51" },
        { weekday: "SATURDAY", localStartTime: "18:51" },
      ],
      autoCreateRun: false,
      notes: null,
    });

    await expectCode(
      communityScheduleService.updateRunSetup(lead, {
        templateId: plan.templateId,
        name: "Hacked",
        raidId: VENOMOUS_ABYSS_RAID_ID,
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        plannedBossCount: 8,
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        desiredLootbuddyCount: 0,
        notes: null,
        raidLeadId: ids.lead,
      }),
      "NOT_AUTHORIZED",
    );

    await communityScheduleService.updateRunSetup(admin, {
      templateId: plan.templateId,
      name: "Edited Setup Name",
      raidId: VENOMOUS_ABYSS_RAID_ID,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 7,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      desiredLootbuddyCount: 0,
      notes: "updated notes",
      raidLeadId: ids.lead,
    });

    const page = await communityScheduleService.getPage(admin);
    const group = page.runSetups.find((row) => row.runTemplateId === plan.templateId);
    expect(group?.runSetupName).toBe("Edited Setup Name");
    expect(group?.slots).toHaveLength(2);
    const option = page.templates.find((row) => row.id === plan.templateId);
    expect(option?.plannedBossCount).toBe(7);
    expect(option?.notes).toBe("updated notes");
    expect(page.raids.some((raid) => raid.name.includes("Venomous"))).toBe(true);
  });
});
