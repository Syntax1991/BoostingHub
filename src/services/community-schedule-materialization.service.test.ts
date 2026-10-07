import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import {
  COMMUNITY_SCHEDULE_TIME_ZONE,
  resolveScheduleSlotOccurrence,
} from "@/lib/community-schedule";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { TIDEBOUND_GROTTO_RAID_ID, VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { communityScheduleRepository } from "@/repositories/community-schedule.repository";
import { communityScheduleRunRepository } from "@/repositories/community-schedule-run.repository";
import { runTemplateRepository } from "@/repositories/run-template.repository";
import { communityScheduleMaterializationService } from "@/services/community-schedule-materialization.service";
import { communityScheduleService } from "@/services/community-schedule.service";

/** Distinct from character.service.test.ts (`cm…`) and community-schedule.service.test.ts (`cs…`). */
const ids = {
  user: "aaaaaaaa-aaaa-4aaa-8aaa-csm000000001",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-csm000000002",
  otherLead: "aaaaaaaa-aaaa-4aaa-8aaa-csm000000003",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-csm000000004",
};

const testUserIds = new Set(Object.values(ids));

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@csm.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  const existing = await orm.User.where({ id }).first();
  if (existing) {
    await orm.User.where({ id }).update({
      name,
      email: `${id}@csm.boostting.local`,
      accountRole,
      accountStatus: "ACTIVE",
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  await orm.User.create({
    id,
    name,
    email: `${id}@csm.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function cleanupMaterializationData() {
  const slots = await orm.CommunityScheduleSlot.all();
  const ownSlots = slots.filter((row) => {
    const slot = row as { id: string; raidLeadId: string; createdById: string };
    return testUserIds.has(slot.raidLeadId) || testUserIds.has(slot.createdById);
  });
  const ownSlotIds = new Set(ownSlots.map((row) => String((row as { id: string }).id)));

  const links = await orm.CommunityScheduleRun.all();
  for (const row of links) {
    const link = row as { id: string; runId: string; scheduleSlotId: string };
    if (!ownSlotIds.has(link.scheduleSlotId)) continue;
    await orm.RunDomainEvent.where({ runId: link.runId }).delete().catch(() => {});
    await orm.CommunityScheduleRun.where({ id: link.id }).delete().catch(() => {});
    await orm.RunRoster.where({ runId: link.runId }).delete().catch(() => {});
    await orm.RunRaidContent.where({ runId: link.runId }).delete().catch(() => {});
    await orm.Run.where({ id: link.runId }).delete().catch(() => {});
  }

  for (const row of ownSlots) {
    await orm.CommunityScheduleSlot.where({ id: String((row as { id: string }).id) }).delete().catch(() => {});
  }

  const testCreators = new Set(Object.values(ids));
  const templates = await orm.RunTemplate.all();
  for (const row of templates) {
    const createdById = String((row as { createdById: string }).createdById);
    if (testCreators.has(createdById)) {
      await orm.RunTemplate.where({ id: String((row as { id: string }).id) }).delete().catch(() => {});
    }
  }
}

async function cleanupUsers() {
  await cleanupMaterializationData();
  for (const id of Object.values(ids)) {
    await orm.ActivityEvent.where({ userId: id }).delete().catch(() => {});
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

const user = asUser(ids.user, "CSM User", "USER");
const lead = asUser(ids.lead, "CSM Lead", "RAID_LEAD");
const admin = asUser(ids.admin, "CSM Admin", "ADMIN");

let templateId = "";

beforeAll(async () => {
  await cleanupUsers();
  await createUser(ids.user, "CSM User", "USER");
  await createUser(ids.lead, "CSM Lead", "RAID_LEAD");
  await createUser(ids.otherLead, "CSM Other Lead", "RAID_LEAD");
  await createUser(ids.admin, "CSM Admin", "ADMIN");
  await raidRepository.ensureReferenceRaids();
  templateId = await runTemplateRepository.create({
    name: "CSM Materialize Template",
    difficulty: "HEROIC" as const,
    lootType: "UNSAVED" as const,
    contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 }],
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    notes: null,
    createdById: ids.lead,
    updatedById: ids.lead,
  });
});

beforeEach(async () => {
  await cleanupMaterializationData();
  if (!(await orm.RunTemplate.where({ id: templateId }).first())) {
    templateId = await runTemplateRepository.create({
    name: "CSM Materialize Template",
    difficulty: "HEROIC" as const,
    lootType: "UNSAVED" as const,
    contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 }],
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    notes: null,
    createdById: ids.lead,
    updatedById: ids.lead,
  });
  }
});

afterAll(async () => {
  await cleanupUsers();
});

describe("communityScheduleMaterializationService.materializeOccurrence", () => {
  it("USER cannot materialize", async () => {
    const { slot } = await communityScheduleService.createSlot(admin, {
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "HC VIP",
      raidLeadId: ids.lead,
      notes: null,
      runTemplateId: templateId,
      autoCreateRun: false,
      runMode: "INHOUSE",
    });
    await expectCode(
      communityScheduleMaterializationService.materializeOccurrence(
        { kind: "USER", user },
        { scheduleSlotId: slot.id, window: "NEXT" },
      ),
      "NOT_AUTHORIZED",
    );
  });

  it("RAID_LEAD can materialize own slot into a DRAFT run from template fields", async () => {
    const now = new Date("2027-01-15T12:00:00.000Z");
    const { slot } = await communityScheduleService.createSlot(admin, {
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "LABEL MUST NOT BECOME TITLE",
      raidLeadId: ids.lead,
      notes: null,
      runTemplateId: templateId,
      autoCreateRun: false,
      runMode: "INHOUSE",
    });
    const result = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: lead },
      { scheduleSlotId: slot.id, window: "NEXT", now },
    );
    expect(result.alreadyExisted).toBe(false);
    const run = (await orm.Run.where({ id: result.runId }).first()) as {
      status: string;
      difficulty: string;
      lootType: string;
      title: string;
      signupsOpen: boolean;
    } | null;
    expect(run?.status).toBe("DRAFT");
    expect(run?.signupsOpen).toBe(false);
    expect(run?.difficulty).toBe("HEROIC");
    expect(run?.lootType).toBe("UNSAVED");
    expect(run?.title).not.toContain("LABEL MUST NOT BECOME TITLE");
    const link = (await orm.CommunityScheduleRun.where({ runId: result.runId }).first()) as {
      createdByKind: string;
      createdById: string | null;
    } | null;
    expect(link?.createdByKind).toBe("USER");
    expect(link?.createdById).toBe(ids.lead);
    const events = await orm.RunDomainEvent.where({ runId: result.runId }).all();
    const created = events.find((row) => (row as { type: string }).type === "RUN_CREATED") as
      | { actorKind: string; actorUserId: string | null }
      | undefined;
    expect(created?.actorKind).toBe("USER");
    expect(created?.actorUserId).toBe(ids.lead);
  });

  it("rejects CURRENT occurrence in the past", async () => {
    const now = new Date("2027-01-17T20:00:00.000Z");
    const { slot } = await communityScheduleService.createSlot(admin, {
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "HC VIP",
      raidLeadId: ids.lead,
      notes: null,
      runTemplateId: templateId,
      autoCreateRun: false,
      runMode: "INHOUSE",
    });
    await expectCode(
      communityScheduleMaterializationService.materializeOccurrence(
        { kind: "USER", user: lead },
        { scheduleSlotId: slot.id, window: "CURRENT", now },
      ),
      "COMMUNITY_SCHEDULE_OCCURRENCE_PAST",
    );
  });

  it("returns alreadyExisted on second materialize", async () => {
    const now = new Date("2027-01-15T12:00:00.000Z");
    const { slot } = await communityScheduleService.createSlot(admin, {
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "HC VIP",
      raidLeadId: ids.lead,
      notes: null,
      runTemplateId: templateId,
      autoCreateRun: false,
      runMode: "INHOUSE",
    });
    const first = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: lead },
      { scheduleSlotId: slot.id, window: "NEXT", now },
    );
    const second = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: admin },
      { scheduleSlotId: slot.id, window: "NEXT", now },
    );
    expect(second.alreadyExisted).toBe(true);
    expect(second.runId).toBe(first.runId);
  });

  it("edit localStartTime after materialize does not create a second Run for the same window", async () => {
    const now = new Date("2027-01-15T12:00:00.000Z");
    const { slot } = await communityScheduleService.createSlot(admin, {
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "HC VIP",
      raidLeadId: ids.lead,
      notes: null,
      runTemplateId: templateId,
      autoCreateRun: false,
      runMode: "INHOUSE",
    });

    const beforeOccurrence = resolveScheduleSlotOccurrence({
      weekday: "FRIDAY",
      localStartTime: "19:45",
      window: "NEXT",
      now,
      timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
    });

    const first = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: lead },
      { scheduleSlotId: slot.id, window: "NEXT", now },
    );

    const originalRun = (await orm.Run.where({ id: first.runId }).first()) as {
      scheduledStartAt: string;
    } | null;
    expect(Date.parse(originalRun?.scheduledStartAt ?? "")).toBe(Date.parse(beforeOccurrence.scheduledStartAt));

    await communityScheduleService.updateSlot(admin, {
      slotId: slot.id,
      weekday: "FRIDAY",
      localStartTime: "20:00",
      label: "HC VIP Late",
      raidLeadId: ids.lead,
      notes: null,
      runTemplateId: templateId,
      autoCreateRun: false,
      runMode: "INHOUSE",
    });

    const afterOccurrence = resolveScheduleSlotOccurrence({
      weekday: "FRIDAY",
      localStartTime: "20:00",
      window: "NEXT",
      now,
      timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
    });
    // Window identity is raid-ID week start — not the occurrence clock time.
    expect(afterOccurrence.windowStartAt).toBe(beforeOccurrence.windowStartAt);
    expect(afterOccurrence.scheduledStartAt).not.toBe(beforeOccurrence.scheduledStartAt);

    const second = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: admin },
      { scheduleSlotId: slot.id, window: "NEXT", now },
    );
    expect(second.alreadyExisted).toBe(true);
    expect(second.runId).toBe(first.runId);

    const runAfter = (await orm.Run.where({ id: first.runId }).first()) as {
      scheduledStartAt: string;
      title: string;
    } | null;
    // Snapshot safety: existing Run keeps the original occurrence time.
    expect(Date.parse(runAfter?.scheduledStartAt ?? "")).toBe(Date.parse(beforeOccurrence.scheduledStartAt));
    expect(runAfter?.title).not.toContain("HC VIP Late");

    const links = await orm.CommunityScheduleRun.where({ scheduleSlotId: slot.id }).all();
    expect(links).toHaveLength(1);
  });

  it("RAID_LEAD cannot materialize another lead's slot", async () => {
    const otherTemplateId = await runTemplateRepository.create({
      name: "Other Lead Template",
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 }],
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: null,
      createdById: ids.otherLead,
      updatedById: ids.otherLead,
    });
    const { slot } = await communityScheduleService.createSlot(admin, {
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "HC VIP",
      raidLeadId: ids.otherLead,
      notes: null,
      runTemplateId: otherTemplateId,
      autoCreateRun: false,
      runMode: "INHOUSE",
    });
    await expectCode(
      communityScheduleMaterializationService.materializeOccurrence(
        { kind: "USER", user: lead },
        { scheduleSlotId: slot.id, window: "NEXT" },
      ),
      "NOT_AUTHORIZED",
    );
  });

  it("shared template: inherit vs override composition; template edits affect only inherit", async () => {
    const sharedTemplateId = await runTemplateRepository.create({
      name: "CSM Shared Composition Template",
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 }],
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      desiredLootbuddyCount: 0,
      notes: null,
      createdById: ids.admin,
      updatedById: ids.admin,
    });
    const now = new Date("2027-02-05T12:00:00.000Z");

    const { slot: inheritSlot } = await communityScheduleService.createSlot(admin, {
      weekday: "MONDAY",
      localStartTime: "19:00",
      label: "Inherit comp",
      raidLeadId: ids.lead,
      notes: null,
      runTemplateId: sharedTemplateId,
      autoCreateRun: false,
      runMode: "INHOUSE",
    });
    const { slot: overrideSlot } = await communityScheduleService.createSlot(admin, {
      weekday: "TUESDAY",
      localStartTime: "19:00",
      label: "Override comp",
      raidLeadId: ids.otherLead,
      notes: null,
      runTemplateId: sharedTemplateId,
      autoCreateRun: false,
      runMode: "INHOUSE",
      compositionOverrideEnabled: true,
      desiredTankCountOverride: 3,
      desiredHealerCountOverride: 5,
      desiredDpsCountOverride: 12,
      desiredLootbuddyCountOverride: 0,
    });

    const inheritFirst = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: admin },
      { scheduleSlotId: inheritSlot.id, window: "NEXT", now },
    );
    const overrideFirst = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: admin },
      { scheduleSlotId: overrideSlot.id, window: "NEXT", now },
    );

    const inheritRun = (await orm.Run.where({ id: inheritFirst.runId }).first()) as {
      desiredTankCount: number;
      desiredHealerCount: number;
      desiredDpsCount: number;
    } | null;
    const overrideRun = (await orm.Run.where({ id: overrideFirst.runId }).first()) as {
      desiredTankCount: number;
      desiredHealerCount: number;
      desiredDpsCount: number;
    } | null;
    expect(inheritRun?.desiredTankCount).toBe(2);
    expect(inheritRun?.desiredHealerCount).toBe(4);
    expect(inheritRun?.desiredDpsCount).toBe(14);
    expect(overrideRun?.desiredTankCount).toBe(3);
    expect(overrideRun?.desiredHealerCount).toBe(5);
    expect(overrideRun?.desiredDpsCount).toBe(12);

    const pageBeforeEdit = await communityScheduleService.getPage(admin, now);
    const inheritStaffing = pageBeforeEdit.next.days
      .flatMap((day) => day.slots)
      .find((row) => row.slot.id === inheritSlot.id)?.staffing;
    const overrideStaffing = pageBeforeEdit.next.days
      .flatMap((day) => day.slots)
      .find((row) => row.slot.id === overrideSlot.id)?.staffing;
    expect(inheritStaffing).toMatchObject({
      kind: "RUN",
      projection: { desired: { tanks: 2, healers: 4, dps: 14, lootbuddies: 0 } },
    });
    expect(overrideStaffing).toMatchObject({
      kind: "RUN",
      projection: { desired: { tanks: 3, healers: 5, dps: 12, lootbuddies: 0 } },
    });

    await runTemplateRepository.update(sharedTemplateId, {
      name: "CSM Shared Composition Template",
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 }],
      desiredTankCount: 4,
      desiredHealerCount: 6,
      desiredDpsCount: 10,
      desiredLootbuddyCount: 0,
      notes: null,
      updatedById: ids.admin,
    });

    const pageAfterTemplateEdit = await communityScheduleService.getPage(admin, now);
    const inheritStaffingAfter = pageAfterTemplateEdit.next.days
      .flatMap((day) => day.slots)
      .find((row) => row.slot.id === inheritSlot.id)?.staffing;
    expect(inheritStaffingAfter).toMatchObject({
      kind: "RUN",
      projection: { desired: { tanks: 2, healers: 4, dps: 14, lootbuddies: 0 } },
    });
    // Unmaterialized CURRENT occurrence preview follows live planning (new template defaults).
    const inheritCurrent = pageAfterTemplateEdit.current.days
      .flatMap((day) => day.slots)
      .find((row) => row.slot.id === inheritSlot.id);
    if (inheritCurrent && !inheritCurrent.materialization.runId) {
      expect(inheritCurrent.staffing).toMatchObject({
        kind: "PREVIEW",
        target: {
          desiredTankCount: 4,
          desiredHealerCount: 6,
          desiredDpsCount: 10,
          desiredLootbuddyCount: 0,
        },
      });
    }

    const later = new Date("2027-02-12T12:00:00.000Z");
    const inheritSecond = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: admin },
      { scheduleSlotId: inheritSlot.id, window: "NEXT", now: later },
    );
    const overrideSecond = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: admin },
      { scheduleSlotId: overrideSlot.id, window: "NEXT", now: later },
    );
    expect(inheritSecond.runId).not.toBe(inheritFirst.runId);
    expect(overrideSecond.runId).not.toBe(overrideFirst.runId);

    const inheritAfter = (await orm.Run.where({ id: inheritSecond.runId }).first()) as {
      desiredTankCount: number;
      desiredHealerCount: number;
      desiredDpsCount: number;
    } | null;
    const overrideAfter = (await orm.Run.where({ id: overrideSecond.runId }).first()) as {
      desiredTankCount: number;
      desiredHealerCount: number;
      desiredDpsCount: number;
    } | null;
    expect(inheritAfter?.desiredTankCount).toBe(4);
    expect(inheritAfter?.desiredHealerCount).toBe(6);
    expect(inheritAfter?.desiredDpsCount).toBe(10);
    expect(overrideAfter?.desiredTankCount).toBe(3);
    expect(overrideAfter?.desiredHealerCount).toBe(5);
    expect(overrideAfter?.desiredDpsCount).toBe(12);
  });
});

describe("communityScheduleMaterializationService.runPass", () => {
  it("creates DRAFT runs for auto-create slots with SYSTEM actor (no fabricated USER)", async () => {
    const now = new Date("2027-01-15T12:00:00.000Z");
    // Persist via repository so this test isolates the hourly pass (not post-save immediate create).
    await communityScheduleRepository.create({
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "Auto HC",
      raidLeadId: ids.lead,
      notes: null,
      runTemplateId: templateId,
      autoCreateRun: true,
      runMode: "INHOUSE",
      createdById: ids.admin,
      updatedById: ids.admin,
    });
    const before = await orm.Run.select("id").all();
    const result = await communityScheduleMaterializationService.runPass(now);
    expect(result.status).toBe("COMPLETED");
    if (result.status === "COMPLETED") {
      expect(result.created).toBeGreaterThan(0);
    }
    const after = await orm.Run.select("id").all();
    expect(after.length).toBeGreaterThan(before.length);

    const ownSlots = await orm.CommunityScheduleSlot.where({ raidLeadId: ids.lead }).all();
    const ownSlotIds = new Set(ownSlots.map((s) => String((s as { id: string }).id)));
    const links = await orm.CommunityScheduleRun.all();
    const ownSystemLink = links.find((row) => {
      const link = row as {
        scheduleSlotId: string;
        createdByKind: string;
        createdById: string | null;
        runId: string;
      };
      return ownSlotIds.has(link.scheduleSlotId) && link.createdByKind === "SYSTEM";
    }) as { runId: string; createdById: string | null; createdByKind: string } | undefined;

    expect(ownSystemLink?.createdByKind).toBe("SYSTEM");
    expect(ownSystemLink?.createdById).toBeNull();

    const event = (await orm.RunDomainEvent.where({
      runId: ownSystemLink!.runId,
      type: "RUN_CREATED",
    }).first()) as { actorKind: string; actorUserId: string | null } | null;
    expect(event?.actorKind).toBe("SYSTEM");
    expect(event?.actorUserId).toBeNull();

    const run = (await orm.Run.where({ id: ownSystemLink!.runId }).first()) as {
      status: string;
      signupsOpen: boolean;
    } | null;
    expect(run?.status).toBe("DRAFT");
    expect(run?.signupsOpen).toBe(false);
  });

  it("edit slot time after SYSTEM materialize still returns alreadyExisted for same window", async () => {
    const now = new Date("2027-01-15T12:00:00.000Z");
    const { slot } = await communityScheduleService.createSlot(admin, {
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "Auto HC",
      raidLeadId: ids.lead,
      notes: null,
      runTemplateId: templateId,
      autoCreateRun: true,
      runMode: "INHOUSE",
    });

    const nextOccurrence = resolveScheduleSlotOccurrence({
      weekday: "FRIDAY",
      localStartTime: "19:45",
      window: "NEXT",
      now,
      timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
    });

    const pass = await communityScheduleMaterializationService.runPass(now);
    expect(pass.status).toBe("COMPLETED");

    const linksBefore = await orm.CommunityScheduleRun.where({ scheduleSlotId: slot.id }).all();
    const linkBefore = linksBefore.find((row) => {
      const link = row as { windowStartAt: string };
      return Date.parse(link.windowStartAt) === Date.parse(nextOccurrence.windowStartAt);
    }) as { runId: string; windowStartAt: string; occurrenceStartAt: string } | undefined;
    expect(linkBefore).toBeTruthy();

    await communityScheduleService.updateSlot(admin, {
      slotId: slot.id,
      weekday: "FRIDAY",
      localStartTime: "20:00",
      label: "Auto HC Late",
      raidLeadId: ids.lead,
      notes: null,
      runTemplateId: templateId,
      autoCreateRun: true,
      runMode: "INHOUSE",
    });

    const rematerialize = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "SYSTEM" },
      { scheduleSlotId: slot.id, window: "NEXT", now },
    );
    expect(rematerialize.alreadyExisted).toBe(true);
    expect(rematerialize.runId).toBe(linkBefore!.runId);

    const links = await orm.CommunityScheduleRun.where({ scheduleSlotId: slot.id }).all();
    const nextLinks = links.filter((row) => {
      const link = row as { windowStartAt: string };
      return Date.parse(link.windowStartAt) === Date.parse(nextOccurrence.windowStartAt);
    });
    expect(nextLinks).toHaveLength(1);

    const run = (await orm.Run.where({ id: linkBefore!.runId }).first()) as {
      scheduledStartAt: string;
    } | null;
    expect(Date.parse(run?.scheduledStartAt ?? "")).toBe(Date.parse(linkBefore!.occurrenceStartAt));
  });

  it("bulk auto-create plan slots materialize immediately; hourly pass is idempotent", async () => {
    const now = new Date("2027-01-15T12:00:00.000Z");
    const plan = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: ids.lead,
      runSetup: { mode: "existing", templateId },
      slots: [
        { weekday: "FRIDAY", localStartTime: "19:45", runMode: "INHOUSE" },
        { weekday: "SATURDAY", localStartTime: "20:00", runMode: "TEAM_RUN" },
      ],
      autoCreateRun: false,
      notes: null,
    });
    expect(plan.slotIds).toHaveLength(2);

    // Enable auto + targeted materialize at a fixed now (same clock as runPass).
    for (const slotId of plan.slotIds) {
      const existing = await communityScheduleRepository.findById(slotId);
      await communityScheduleRepository.update(slotId, {
        weekday: existing!.weekday,
        localStartTime: existing!.localStartTime,
        label: existing!.label,
        notes: existing!.notes,
        raidLeadId: existing!.raidLeadId,
        runTemplateId: existing!.runTemplateId,
        autoCreateRun: true,
        runMode: existing!.runMode,
        updatedById: ids.admin,
      });
    }
    const immediate = await communityScheduleMaterializationService.materializeSlotWindows(plan.slotIds, {
      now,
    });
    expect(immediate.created).toBeGreaterThan(0);

    for (const slotId of plan.slotIds) {
      const links = await orm.CommunityScheduleRun.where({ scheduleSlotId: slotId }).all();
      expect(links.length).toBeGreaterThan(0);
    }

    const pass = await communityScheduleMaterializationService.runPass(now);
    expect(pass.status).toBe("COMPLETED");
    if (pass.status === "COMPLETED") {
      expect(pass.created).toBe(0);
    }
  });

  it("CURRENT past + NEXT future: skip CURRENT only, create NEXT (hourly + page)", async () => {
    // Wed 07 Oct 2026 00:33 Europe/Berlin — CURRENT Wed 00:30 is past; NEXT is +1 week.
    const now = new Date("2026-10-06T22:33:00.000Z");
    const plan = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: ids.lead,
      runSetup: { mode: "existing", templateId },
      slots: [{ weekday: "WEDNESDAY", localStartTime: "00:30", runMode: "INHOUSE" }],
      autoCreateRun: false,
      notes: null,
    });
    const slotId = plan.slotIds[0]!;
    await communityScheduleRepository.update(slotId, {
      weekday: "WEDNESDAY",
      localStartTime: "00:30",
      label: "Boundary",
      notes: null,
      raidLeadId: ids.lead,
      runTemplateId: templateId,
      autoCreateRun: true,
      runMode: "INHOUSE",
      updatedById: ids.admin,
    });

    const pass = await communityScheduleMaterializationService.runPass(now);
    expect(pass.status).toBe("COMPLETED");
    if (pass.status === "COMPLETED") {
      expect(pass.skippedPast).toBe(1);
      expect(pass.created).toBe(1);
      expect(pass.failed).toBe(0);
    }

    const nextOccurrence = resolveScheduleSlotOccurrence({
      weekday: "WEDNESDAY",
      localStartTime: "00:30",
      window: "NEXT",
      now,
      timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
    });
    expect(nextOccurrence.scheduledStartAt).toBe("2026-10-13T22:30:00.000Z");

    const nextLink = await communityScheduleRunRepository.findBySlotAndWindow(
      slotId,
      nextOccurrence.windowStartAt,
    );
    expect(nextLink).toBeTruthy();
    expect(nextLink!.windowStartAt).toBe(nextOccurrence.windowStartAt);
    expect(nextLink!.occurrenceStartAt).toBe(nextOccurrence.scheduledStartAt);

    const currentOccurrence = resolveScheduleSlotOccurrence({
      weekday: "WEDNESDAY",
      localStartTime: "00:30",
      window: "CURRENT",
      now,
      timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
    });
    const currentLink = await communityScheduleRunRepository.findBySlotAndWindow(
      slotId,
      currentOccurrence.windowStartAt,
    );
    expect(currentLink).toBeNull();

    const page = await communityScheduleService.getPage(admin, now);
    const nextView = page.next.days
      .flatMap((day) => day.slots)
      .find((row) => row.slot.id === slotId);
    expect(nextView?.materialization.state).toBe("RUN_CREATED");
    expect(nextView?.materialization.runId).toBe(nextLink!.runId);

    const second = await communityScheduleMaterializationService.runPass(now);
    expect(second.status).toBe("COMPLETED");
    if (second.status === "COMPLETED") {
      expect(second.created).toBe(0);
      expect(second.alreadyCreated).toBe(1);
      expect(second.skippedPast).toBe(1);
    }
  });

  it("CURRENT future + NEXT future: creates both windows", async () => {
    const now = new Date("2027-01-15T12:00:00.000Z");
    const plan = await communityScheduleService.createSchedulePlan(
      admin,
      {
        raidLeadId: ids.lead,
        runSetup: { mode: "existing", templateId },
        slots: [{ weekday: "FRIDAY", localStartTime: "19:45", runMode: "INHOUSE" }],
        autoCreateRun: true,
        notes: null,
      },
      now,
    );
    expect(plan.materialization.created).toBe(2);

    const second = await communityScheduleMaterializationService.materializeSlotWindows(plan.slotIds, {
      now,
    });
    expect(second.created).toBe(0);
    expect(second.alreadyCreated).toBe(2);
  });

  it("Bundle template materializes Tide + Venomous contents; Venomous-only still works", async () => {
    await raidRepository.ensureReferenceRaids();
    const now = new Date("2027-01-15T12:00:00.000Z");
    const bundleTemplateId = await runTemplateRepository.create({
      name: "CSM Bundle Template",
      difficulty: "HEROIC",
      lootType: "VIP",
      contents: [
        { raidId: TIDEBOUND_GROTTO_RAID_ID, sortOrder: 1, plannedBossCount: 1 },
        { raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 2, plannedBossCount: 6 },
      ],
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: null,
      createdById: ids.admin,
      updatedById: ids.admin,
    });

    const bundlePlan = await communityScheduleService.createSchedulePlan(
      admin,
      {
        raidLeadId: ids.lead,
        runSetup: { mode: "existing", templateId: bundleTemplateId },
        slots: [{ weekday: "FRIDAY", localStartTime: "21:00", runMode: "INHOUSE" }],
        autoCreateRun: true,
        notes: null,
      },
      now,
    );
    expect(bundlePlan.materialization.created).toBe(2);
    const bundleLinks = await communityScheduleRunRepository.listBySlotIds(bundlePlan.slotIds);
    expect(bundleLinks).toHaveLength(2);
    for (const link of bundleLinks) {
      const contents = await orm.RunRaidContent.where({ runId: link.runId }).all();
      expect(contents).toHaveLength(2);
    }

    const venomousPlan = await communityScheduleService.createSchedulePlan(
      admin,
      {
        raidLeadId: ids.lead,
        runSetup: { mode: "existing", templateId },
        slots: [{ weekday: "SATURDAY", localStartTime: "21:00", runMode: "INHOUSE" }],
        autoCreateRun: true,
        notes: null,
      },
      now,
    );
    expect(venomousPlan.materialization.created).toBe(2);
    const venomousLinks = await communityScheduleRunRepository.listBySlotIds(venomousPlan.slotIds);
    for (const link of venomousLinks) {
      const contents = await orm.RunRaidContent.where({ runId: link.runId }).all();
      expect(contents).toHaveLength(1);
      expect(String((contents[0] as { raidId: string }).raidId)).toBe(VENOMOUS_ABYSS_RAID_ID);
    }
  });

  it("addTimes and enable Auto-create immediately materialize NEXT", async () => {
    const now = new Date("2026-10-06T22:33:00.000Z");
    const existing = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: ids.lead,
      runSetup: { mode: "existing", templateId },
      slots: [{ weekday: "THURSDAY", localStartTime: "18:00", runMode: "INHOUSE" }],
      autoCreateRun: false,
      notes: null,
    });

    const added = await communityScheduleService.addTimesToSetup(
      admin,
      {
        raidLeadId: ids.lead,
        runTemplateId: templateId,
        slots: [{ weekday: "WEDNESDAY", localStartTime: "00:30", runMode: "INHOUSE" }],
        autoCreateRun: false,
        notes: null,
      },
      now,
    );
    expect(added.materialization.created).toBe(0);
    const wedSlotId = added.slotIds[0]!;

    const enabled = await communityScheduleService.updateSlot(
      admin,
      {
        slotId: wedSlotId,
        weekday: "WEDNESDAY",
        localStartTime: "00:30",
        label: "Enabled Auto",
        raidLeadId: ids.lead,
        notes: null,
        runTemplateId: templateId,
        autoCreateRun: true,
        runMode: "INHOUSE",
      },
      now,
    );
    expect(enabled.materialization.created).toBe(1);

    const page = await communityScheduleService.getPage(admin, now);
    const nextView = page.next.days
      .flatMap((day) => day.slots)
      .find((row) => row.slot.id === wedSlotId);
    expect(nextView?.materialization.state).toBe("RUN_CREATED");

    // Keep existing plan slot referenced so cleanup still finds lead-owned rows.
    expect(existing.slotIds.length).toBe(1);
  });

  it("manual Create Run and SYSTEM auto-create race to one link (no orphans)", async () => {
    const now = new Date("2027-01-15T12:00:00.000Z");
    const plan = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: ids.lead,
      runSetup: { mode: "existing", templateId },
      slots: [{ weekday: "FRIDAY", localStartTime: "19:45", runMode: "INHOUSE" }],
      autoCreateRun: false,
      notes: null,
    });
    const slotId = plan.slotIds[0]!;

    const manual = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: lead },
      { scheduleSlotId: slotId, window: "NEXT", now },
    );
    expect(manual.alreadyExisted).toBe(false);

    await communityScheduleRepository.update(slotId, {
      weekday: "FRIDAY",
      localStartTime: "19:45",
      label: "Race",
      notes: null,
      raidLeadId: ids.lead,
      runTemplateId: templateId,
      autoCreateRun: true,
      runMode: "INHOUSE",
      updatedById: ids.admin,
    });
    const auto = await communityScheduleMaterializationService.materializeSlotWindows([slotId], {
      now,
      windows: ["NEXT"],
    });
    expect(auto.created).toBe(0);
    expect(auto.alreadyCreated).toBe(1);

    const links = await communityScheduleRunRepository.listBySlotIds([slotId]);
    const nextLinks = links.filter((link) => {
      const occurrence = resolveScheduleSlotOccurrence({
        weekday: "FRIDAY",
        localStartTime: "19:45",
        window: "NEXT",
        now,
        timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
      });
      return link.windowStartAt === occurrence.windowStartAt;
    });
    expect(nextLinks).toHaveLength(1);
    expect(nextLinks[0]!.runId).toBe(manual.runId);

    const run = await orm.Run.where({ id: manual.runId }).first();
    expect(run).toBeTruthy();
    const orphanLinks = (await orm.CommunityScheduleRun.all()).filter((row) => {
      const link = row as { runId: string; scheduleSlotId: string };
      return link.scheduleSlotId === slotId && link.runId !== manual.runId;
    });
    expect(orphanLinks).toHaveLength(0);
  });

  it("editing Run Setup after materialize does not change the existing Run snapshot", async () => {
    const now = new Date("2027-01-15T12:00:00.000Z");
    const plan = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: ids.lead,
      runSetup: { mode: "existing", templateId },
      slots: [{ weekday: "FRIDAY", localStartTime: "19:45", runMode: "INHOUSE" }],
      autoCreateRun: false,
      notes: null,
    });
    const slotId = plan.slotIds[0]!;
    const result = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: lead },
      { scheduleSlotId: slotId, window: "NEXT", now },
    );

    const before = (await orm.Run.where({ id: result.runId }).first()) as {
      difficulty: string;
      lootType: string;
      title: string;
    } | null;
    const beforeContent = (await orm.RunRaidContent.where({ runId: result.runId }).first()) as {
      plannedBossCount: number;
    } | null;
    expect(before?.difficulty).toBe("HEROIC");
    expect(beforeContent?.plannedBossCount).toBe(8);

    await runTemplateRepository.update(templateId, {
      name: "CSM Materialize Template Edited",
      difficulty: "MYTHIC",
      lootType: "UNSAVED",
      contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 4 }],
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: null,
      updatedById: ids.admin,
    });

    const after = (await orm.Run.where({ id: result.runId }).first()) as {
      difficulty: string;
      lootType: string;
      title: string;
    } | null;
    const afterContent = (await orm.RunRaidContent.where({ runId: result.runId }).first()) as {
      plannedBossCount: number;
    } | null;
    expect(after?.difficulty).toBe(before?.difficulty);
    expect(after?.lootType).toBe(before?.lootType);
    expect(after?.title).toBe(before?.title);
    expect(afterContent?.plannedBossCount).toBe(beforeContent?.plannedBossCount);

    await runTemplateRepository.update(templateId, {
      name: "CSM Materialize Template",
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 }],
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: null,
      updatedById: ids.admin,
    });
  });
});
