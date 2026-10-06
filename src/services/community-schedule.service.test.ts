import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import type { AccountRole } from "@/models/enums";
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
