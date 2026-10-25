/**
 * Create Run → Recurring checkbox path: Schedule service is authoritative;
 * autoCreateRun false does not materialize concrete Runs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { VENOMOUS_ABYSS_PRODUCT_ID } from "@/lib/product-catalog";
import { seededProductSelection } from "@/lib/test-run-input";
import { buildCreateSchedulePlanFromCreateRun } from "@/lib/create-run-recurring";
import { DEFAULT_SCHEDULE_START } from "@/components/manage/community-schedule-start-fields";
import { communityScheduleService } from "@/services/community-schedule.service";
import { runService } from "@/services/run.service";
import { freezeSystemTime, restoreSystemTime, SCHEDULE_TEST_CLOCK } from "@/test/time";
import type { AccountRole } from "@/models/enums";

const ids = {
  admin: "bbbbbbbb-bbbb-4bbb-8bbb-cr0000000001",
  lead: "bbbbbbbb-bbbb-4bbb-8bbb-cr0000000002",
};

function asUser(id: string, name: string, accountRole: AccountRole): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@cr.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createUser(id: string, name: string, accountRole: AccountRole) {
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name,
    email: `${id}@cr.boostting.local`,
    emailVerified: true,
    accountRole: accountRole === "OWNER" ? "ADMIN" : accountRole,
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
}

const admin = asUser(ids.admin, "CR Admin", "ADMIN");
const lead = asUser(ids.lead, "CR Lead", "RAID_LEAD");

beforeAll(async () => {
  freezeSystemTime(SCHEDULE_TEST_CLOCK);
  await createUser(ids.admin, "CR Admin", "ADMIN");
  await createUser(ids.lead, "CR Lead", "RAID_LEAD");
});

beforeEach(async () => {
  const slots = await orm.CommunityScheduleSlot.where({ createdById: ids.admin }).all();
  for (const row of slots as Array<{ id: string }>) {
    await orm.CommunityScheduleRun.where({ scheduleSlotId: row.id }).delete().catch(() => {});
    await orm.CommunityScheduleSlot.where({ id: row.id }).delete().catch(() => {});
  }
});

afterAll(async () => {
  const slots = await orm.CommunityScheduleSlot.where({ createdById: ids.admin }).all();
  for (const row of slots as Array<{ id: string }>) {
    await orm.CommunityScheduleRun.where({ scheduleSlotId: row.id }).delete().catch(() => {});
    await orm.CommunityScheduleSlot.where({ id: row.id }).delete().catch(() => {});
  }
  await orm.RunTemplate.where({ createdById: ids.admin }).delete().catch(() => {});
  await orm.User.where({ id: ids.admin }).delete().catch(() => {});
  await orm.User.where({ id: ids.lead }).delete().catch(() => {});
  restoreSystemTime();
});

describe("Create Run recurring → Schedule service", () => {
  it("exposes canCreateSchedule only for ADMIN on Create Run form", async () => {
    const adminForm = await runService.getCreateManyForm(admin);
    const leadForm = await runService.getCreateManyForm(lead);
    expect(adminForm.canCreateSchedule).toBe(true);
    expect(leadForm.canCreateSchedule).toBe(false);
  });

  it("Create Run form defaults Discord role ping OFF (explicit opt-in)", async () => {
    const form = await runService.getCreateManyForm(admin);
    expect(form.defaults.discordRolePing).toBe(false);
  });

  it("creates a Schedule via createSchedulePlan without materializing Runs when autoCreateRun is false", async () => {
    const product = seededProductSelection("VENOMOUS_ABYSS");
    const built = buildCreateSchedulePlanFromCreateRun({
      templateId: "",
      setupName: "CR Recurring Setup",
      product: { productId: product.productId || VENOMOUS_ABYSS_PRODUCT_ID, contentBossCounts: product.contentBossCounts },
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      raidLeadId: ids.lead,
      notes: "create-run recurring",
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      desiredLootbuddyCount: 0,
      discordRolePing: false,
      weekday: "THURSDAY",
      localStartTime: "21:00",
      start: DEFAULT_SCHEDULE_START,
      autoCreateRun: false,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const runsBefore = ((await orm.Run.where({ raidLeadId: ids.lead }).all()) as Array<{ id: string }>).length;
    const result = await communityScheduleService.createSchedulePlan(admin, built.payload);
    expect(result.slotIds).toHaveLength(1);
    expect(result.templateId).toBeTruthy();

    const links = await orm.CommunityScheduleRun.where({ scheduleSlotId: result.slotIds[0]! }).all();
    expect(links).toHaveLength(0);

    const runsAfter = ((await orm.Run.where({ raidLeadId: ids.lead }).all()) as Array<{ id: string }>).length;
    expect(runsAfter).toBe(runsBefore);

    const slot = await orm.CommunityScheduleSlot.where({ id: result.slotIds[0]! }).first();
    expect(slot).toMatchObject({
      weekday: "THURSDAY",
      localStartTime: "21:00",
      raidLeadId: ids.lead,
      autoCreateRun: false,
    });
  });

  it("rejects RAID_LEAD creating a Schedule (same gate as Manage Schedule)", async () => {
    const product = seededProductSelection("VENOMOUS_ABYSS");
    const built = buildCreateSchedulePlanFromCreateRun({
      templateId: "",
      setupName: "CR Lead Denied",
      product: { productId: product.productId || VENOMOUS_ABYSS_PRODUCT_ID, contentBossCounts: product.contentBossCounts },
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      raidLeadId: ids.lead,
      notes: "",
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      desiredLootbuddyCount: 0,
      discordRolePing: false,
      weekday: "FRIDAY",
      localStartTime: "19:45",
      start: DEFAULT_SCHEDULE_START,
      autoCreateRun: false,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    try {
      await communityScheduleService.createSchedulePlan(lead, built.payload);
      throw new Error("expected NOT_AUTHORIZED");
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("NOT_AUTHORIZED");
    }
  });
});
