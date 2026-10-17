import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freezeSystemTime, restoreSystemTime, SCHEDULE_TEST_CLOCK } from "@/test/time";
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
import { communityScheduleOccurrenceService } from "@/services/community-schedule-occurrence.service";
import { runService } from "@/services/run.service";
import { venomousCreateInput } from "@/lib/test-run-input";

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
    const link = row as { id: string; runId: string; scheduleSlotId: string | null };
    if (link.scheduleSlotId == null) {
      // Retired Schedule Drafts keep their (released) provenance row.
      const run = (await orm.Run.where({ id: link.runId }).first()) as { raidLeadId: string } | null;
      if (!run || !testUserIds.has(run.raidLeadId)) continue;
    } else if (!ownSlotIds.has(link.scheduleSlotId)) {
      continue;
    }
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

// Friday 15 Jan 2027 12:00Z: CURRENT raid ID Wed 13 Jan 06:00 CET (05:00Z) →
// Fri 15 Jan 19:45 CET (18:45Z) still upcoming; NEXT is Fri 22 Jan.
const OCC_NOW = new Date("2027-01-15T12:00:00.000Z");
const CURRENT_WINDOW = "2027-01-13T05:00:00.000Z";
const NEXT_WINDOW = "2027-01-20T05:00:00.000Z";
/** Monday 18 Jan 2027 12:00 CET — the weekly Draft release for the NEXT_WINDOW raid ID. */
const RELEASE_NOW = new Date("2027-01-18T11:00:00.000Z");

// Deterministic wall clock (see SCHEDULE_TEST_CLOCK); Run creation reads the real clock.
beforeEach(() => freezeSystemTime(SCHEDULE_TEST_CLOCK, { advance: true }));
afterEach(() => restoreSystemTime());

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

  it("time edit archives the Schedule Draft, frees the occurrence; Create Run makes one new Draft", async () => {
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
    const originalRun = (await orm.Run.where({ id: first.runId }).first()) as { scheduledStartAt: string } | null;
    expect(Date.parse(originalRun?.scheduledStartAt ?? "")).toBe(Date.parse(beforeOccurrence.scheduledStartAt));

    const edited = await communityScheduleService.updateSlot(
      admin,
      {
        slotId: slot.id,
        weekday: "FRIDAY",
        localStartTime: "20:00",
        label: "HC VIP Late",
        raidLeadId: ids.lead,
        notes: null,
        runTemplateId: templateId,
        autoCreateRun: false,
        runMode: "INHOUSE",
      },
      now,
    );
    expect(edited.cleanup).toEqual({ retiredDrafts: 1, protectedRuns: 0, attachedRuns: 0 });

    // Retired through the Cancel + Archive end state, never deleted, never re-timed.
    const retired = (await orm.Run.where({ id: first.runId }).first()) as Record<string, unknown>;
    expect(retired.status).toBe("CANCELLED");
    expect(retired.cancelledFromStatus).toBe("DRAFT");
    expect(retired.archivedAt).not.toBeNull();
    expect(retired.archivedById).toBe(ids.admin);
    expect(Date.parse(String(retired.scheduledStartAt))).toBe(Date.parse(beforeOccurrence.scheduledStartAt));
    const events = (await orm.RunDomainEvent.where({ runId: first.runId }).all()) as Array<{ type: string }>;
    expect(events.some((event) => event.type === "RUN_SCHEDULE_DRAFT_RETIRED")).toBe(true);
    // Occurrence freed: provenance kept, no longer owned by the slot.
    expect((await communityScheduleRunRepository.findByRunId(first.runId))?.scheduleSlotId).toBeNull();
    expect(await communityScheduleRunRepository.listBySlotIds([slot.id])).toHaveLength(0);

    const afterOccurrence = resolveScheduleSlotOccurrence({
      weekday: "FRIDAY",
      localStartTime: "20:00",
      window: "NEXT",
      now,
      timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
    });
    expect(afterOccurrence.windowStartAt).toBe(beforeOccurrence.windowStartAt);

    const second = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: admin },
      { scheduleSlotId: slot.id, window: "NEXT", now },
    );
    expect(second.alreadyExisted).toBe(false);
    expect(second.runId).not.toBe(first.runId);
    const runAfter = (await orm.Run.where({ id: second.runId }).first()) as { scheduledStartAt: string } | null;
    expect(Date.parse(runAfter?.scheduledStartAt ?? "")).toBe(Date.parse(afterOccurrence.scheduledStartAt));
    expect(await communityScheduleRunRepository.listBySlotIds([slot.id])).toHaveLength(1);
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

  it("Monday 12:00 release creates only the following raid ID; 11:59 / catch-up passes never jump ahead", async () => {
    // Tuesday 20:00: CURRENT occurrence Tue 19 Jan 2027, NEXT Tue 26 Jan (raid IDs Wed 13 / Wed 20 Jan).
    const { slot } = await communityScheduleService.createSlot(admin, {
      weekday: "TUESDAY",
      localStartTime: "20:00",
      label: "Release",
      raidLeadId: ids.lead,
      notes: null,
      runTemplateId: templateId,
      autoCreateRun: true,
      runMode: "INHOUSE",
    });
    expect(await communityScheduleRunRepository.listBySlotIds([slot.id])).toHaveLength(0);
    const windows = async () =>
      (await communityScheduleRunRepository.listBySlotIds([slot.id])).map((link) => link.windowStartAt).sort();

    // Mon 18 Jan 11:59 CET: last Monday's release (Wed 13 Jan raid ID) still governs — a catch-up of it.
    const beforeRelease = await communityScheduleMaterializationService.runPass(new Date("2027-01-18T10:59:00.000Z"));
    expect(beforeRelease.status === "COMPLETED" && beforeRelease.created).toBe(1);
    expect(await windows()).toEqual([CURRENT_WINDOW]);

    // Mon 18 Jan 12:00 CET: releases the raid ID starting Wed 20 Jan — never the one after it.
    const release = await communityScheduleMaterializationService.runPass(RELEASE_NOW);
    expect(release.status === "COMPLETED" && release.created).toBe(1);
    expect(await windows()).toEqual([CURRENT_WINDOW, NEXT_WINDOW]);

    // Catch-up later in the week (after the Wednesday reset): same target, idempotent.
    const catchUp = await communityScheduleMaterializationService.runPass(new Date("2027-01-21T08:00:00.000Z"));
    expect(catchUp.status).toBe("COMPLETED");
    if (catchUp.status === "COMPLETED") {
      expect(catchUp.created).toBe(0);
      expect(catchUp.alreadyCreated).toBe(1);
    }
    const again = await communityScheduleMaterializationService.runPass(RELEASE_NOW);
    expect(again.status === "COMPLETED" && again.created).toBe(0);
    expect(await windows()).toEqual([CURRENT_WINDOW, NEXT_WINDOW]);
  });

  it("saving a Schedule never creates Runs (plan, add times, edit, enable, reactivate)", async () => {
    const now = OCC_NOW;
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
    const added = await communityScheduleService.addTimesToSetup(
      admin,
      {
        raidLeadId: ids.lead,
        runTemplateId: templateId,
        slots: [{ weekday: "SATURDAY", localStartTime: "20:00", runMode: "INHOUSE" }],
        autoCreateRun: false,
        notes: null,
      },
      now,
    );
    const saturdayId = added.slotIds[0]!;
    await communityScheduleService.updateSlot(
      admin,
      {
        slotId: saturdayId,
        weekday: "SATURDAY",
        localStartTime: "20:00",
        label: "Enabled",
        raidLeadId: ids.lead,
        notes: null,
        runTemplateId: templateId,
        autoCreateRun: true,
        runMode: "INHOUSE",
      },
      now,
    );
    await communityScheduleService.deactivateSlot(admin, saturdayId, now);
    await communityScheduleService.reactivateSlot(admin, saturdayId);
    expect(await communityScheduleRunRepository.listBySlotIds([...plan.slotIds, saturdayId])).toHaveLength(0);

    // Schedule view: the NEXT occurrence waits for Mon 18 Jan 12:00 CET; CURRENT's release already passed.
    const page = await communityScheduleService.getPage(admin, now);
    const nextRow = page.next.days.flatMap((day) => day.slots).find((row) => row.slot.id === plan.slotIds[0]);
    expect(nextRow?.materialization.state).toBe("AUTO_WAITING");
    expect(nextRow?.materialization.draftReleaseAt).toBe(RELEASE_NOW.toISOString());
    const currentRow = page.current.days.flatMap((day) => day.slots).find((row) => row.slot.id === plan.slotIds[0]);
    expect(currentRow?.materialization.state).toBe("NO_RUN_YET");
    expect(currentRow?.materialization.note).toBeTruthy();
    expect(currentRow?.materialization.canMaterialize).toBe(true);
  });

  it("bulk auto-create plan: the release pass creates the Drafts; a second pass is idempotent", async () => {
    const plan = await communityScheduleService.createSchedulePlan(admin, {
      raidLeadId: ids.lead,
      runSetup: { mode: "existing", templateId },
      slots: [
        { weekday: "FRIDAY", localStartTime: "19:45", runMode: "INHOUSE" },
        { weekday: "SATURDAY", localStartTime: "20:00", runMode: "TEAM_RUN" },
      ],
      autoCreateRun: true,
      notes: null,
    });
    expect(plan.slotIds).toHaveLength(2);
    expect(await communityScheduleRunRepository.listBySlotIds(plan.slotIds)).toHaveLength(0);

    const pass = await communityScheduleMaterializationService.runPass(RELEASE_NOW);
    expect(pass.status === "COMPLETED" && pass.created).toBe(2);
    for (const slotId of plan.slotIds) {
      const links = await communityScheduleRunRepository.listBySlotIds([slotId]);
      expect(links.map((link) => link.windowStartAt)).toEqual([NEXT_WINDOW]);
    }

    const second = await communityScheduleMaterializationService.runPass(RELEASE_NOW);
    expect(second.status === "COMPLETED" && second.created).toBe(0);
  });

  it("released raid ID only: past CURRENT is not even considered, NEXT is created (pass + page)", async () => {
    // Wed 06 Jan 2027 00:33 Europe/Berlin (CET) — CURRENT Wed 00:30 is past; NEXT is +1 week.
    const now = new Date("2027-01-05T23:33:00.000Z");
    // This test is about "now": the wall clock is exactly `now` (Run creation reads it).
    freezeSystemTime(now, { advance: true });
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
      // Mon 4 Jan 12:00 released the raid ID starting Wed 6 Jan 06:00 = NEXT here.
      expect(pass.skippedPast).toBe(0);
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
    expect(nextOccurrence.scheduledStartAt).toBe("2027-01-12T23:30:00.000Z");

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
      expect(second.skippedPast).toBe(0);
    }
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
    await communityScheduleMaterializationService.runPass(RELEASE_NOW);
    const bundleLinks = await communityScheduleRunRepository.listBySlotIds(bundlePlan.slotIds);
    expect(bundleLinks).toHaveLength(1);
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
    await communityScheduleMaterializationService.runPass(RELEASE_NOW);
    const venomousLinks = await communityScheduleRunRepository.listBySlotIds(venomousPlan.slotIds);
    expect(venomousLinks).toHaveLength(1);
    for (const link of venomousLinks) {
      const contents = await orm.RunRaidContent.where({ runId: link.runId }).all();
      expect(contents).toHaveLength(1);
      expect(String((contents[0] as { raidId: string }).raidId)).toBe(VENOMOUS_ABYSS_RAID_ID);
    }
  });

  it("manual Create Run and SYSTEM auto-create race to one link (no orphans)", async () => {
    const now = RELEASE_NOW;
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
    const auto = await communityScheduleMaterializationService.runPass(now);
    expect(auto.status).toBe("COMPLETED");
    if (auto.status === "COMPLETED") {
      expect(auto.created).toBe(0);
      expect(auto.alreadyCreated).toBe(1);
    }

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


// ---------------------------------------------------------------------------
// Activation boundary (firstWindowStartAt) + attaching existing Runs.
// Friday 15 Jan 2027 12:00Z: CURRENT raid ID Wed 13 Jan 06:00 CET (05:00Z) →
// Fri 15 Jan 19:45 CET (18:45Z) still upcoming; NEXT is Fri 22 Jan.
// ---------------------------------------------------------------------------
const manualRunIds: string[] = [];

async function cleanupManualRuns() {
  for (const runId of manualRunIds.splice(0)) {
    await orm.CommunityScheduleRun.where({ runId }).delete().catch(() => {});
    await orm.RunDomainEvent.where({ runId }).delete().catch(() => {});
    await orm.RunRoster.where({ runId }).delete().catch(() => {});
    await orm.RunRaidContent.where({ runId }).delete().catch(() => {});
    await orm.RunDiscordAnnouncement.where({ runId }).delete().catch(() => {});
    await orm.Run.where({ id: runId }).delete().catch(() => {});
  }
}

/** An independently created (manual) Run, e.g. Fri 15 Jan 20:00 CET HC 7/8. */
async function manualRun(scheduledStartAt: string, planned = 7): Promise<string> {
  const created = await runService.createRun(
    lead,
    venomousCreateInput({ scheduledStartAt, venomousPlannedBossCount: planned }),
  );
  manualRunIds.push(created.id);
  return created.id;
}

async function runSnapshot(runId: string) {
  const run = (await orm.Run.where({ id: runId }).first()) as Record<string, unknown>;
  const contents = (await orm.RunRaidContent.where({ runId }).all()) as Array<Record<string, unknown>>;
  return {
    title: run.title,
    status: run.status,
    scheduledStartAt: String(run.scheduledStartAt),
    difficulty: run.difficulty,
    desiredTankCount: run.desiredTankCount,
    updatedAt: String(run.updatedAt),
    contents: contents.map((row) => `${row.raidId}:${row.plannedBossCount}`).sort(),
  };
}

async function linkFor(slotId: string, windowStartAt: string) {
  return communityScheduleRunRepository.findBySlotAndWindow(slotId, windowStartAt);
}

function planInput(slot: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    raidLeadId: ids.lead,
    runSetup: { mode: "existing" as const, templateId },
    slots: [{ weekday: "FRIDAY" as const, localStartTime: "19:45", runMode: "INHOUSE" as const, ...slot }],
    autoCreateRun: true,
    notes: null,
    ...extra,
  };
}

describe("Schedule activation boundary", () => {
  afterAll(cleanupManualRuns);

  it("Skip first: the upcoming occurrence never exists (not created, not attachable); the next one is released", async () => {
    const plan = await communityScheduleService.createSchedulePlan(
      admin,
      planInput({}, { start: { mode: "SKIP_FIRST" } }),
      OCC_NOW,
    );
    const slotId = plan.slotIds[0]!;
    const slot = (await communityScheduleRepository.findById(slotId))!;
    expect(slot.firstWindowStartAt).toBe(NEXT_WINDOW);
    expect(await communityScheduleRunRepository.listBySlotIds([slotId])).toHaveLength(0);

    const page = await communityScheduleService.getPage(admin, OCC_NOW);
    const current = page.current.days.flatMap((day) => day.slots).find((row) => row.slot.id === slotId);
    expect(current?.materialization.state).toBe("NOT_STARTED");
    expect(current?.materialization.canAttach).toBe(false);
    expect(current?.materialization.canMaterialize).toBe(false);
    expect(current?.materialization.startsWindowStartAt).toBe(NEXT_WINDOW);

    // A pass targeting the pre-boundary raid ID skips it.
    const early = await communityScheduleMaterializationService.runPass(OCC_NOW);
    expect(early.status === "COMPLETED" && early.created).toBe(0);
    expect(early.status === "COMPLETED" && early.skippedBeforeStart).toBe(1);

    // Manual Create Run and Use existing Run respect the boundary too.
    await expectCode(
      communityScheduleMaterializationService.materializeOccurrence(
        { kind: "USER", user: admin },
        { scheduleSlotId: slotId, window: "CURRENT", now: OCC_NOW },
      ),
      "COMMUNITY_SCHEDULE_NOT_STARTED",
    );
    const preBoundaryRun = await manualRun("2027-01-15T19:00:00.000Z");
    const candidates = await communityScheduleOccurrenceService.listAttachCandidates(admin, { slot, now: OCC_NOW });
    expect(candidates.some((row) => row.runId === preBoundaryRun)).toBe(false);
    await expectCode(
      communityScheduleOccurrenceService.attachExistingRun(admin, {
        scheduleSlotId: slotId,
        runId: preBoundaryRun,
        now: OCC_NOW,
      }),
      "COMMUNITY_SCHEDULE_NOT_STARTED",
    );
    expect(await communityScheduleRunRepository.findByRunId(preBoundaryRun)).toBeNull();

    // Monday release of the boundary raid ID creates it.
    const release = await communityScheduleMaterializationService.runPass(RELEASE_NOW);
    expect(release.status === "COMPLETED" && release.created).toBe(1);
    expect(await linkFor(slotId, NEXT_WINDOW)).toBeTruthy();
    expect(await linkFor(slotId, CURRENT_WINDOW)).toBeNull();
  });

  it("draft-slot picker (create dialog) excludes occurrences before the chosen Starts", async () => {
    const existing = await manualRun("2027-01-15T19:00:00.000Z");
    const draftSlot = { weekday: "FRIDAY" as const, localStartTime: "19:45", raidLeadId: ids.lead, runTemplateId: templateId };
    const all = await communityScheduleOccurrenceService.listAttachCandidates(admin, { slot: draftSlot, now: OCC_NOW });
    expect(all.some((row) => row.runId === existing)).toBe(true);
    const skipped = await communityScheduleOccurrenceService.listAttachCandidates(admin, {
      slot: { ...draftSlot, firstWindowStartAt: NEXT_WINDOW },
      now: OCC_NOW,
    });
    expect(skipped.some((row) => row.runId === existing)).toBe(false);
    // Creating with Skip first + that Run as first occurrence is refused atomically (no slot left behind).
    await expectCode(
      communityScheduleService.createSchedulePlan(
        admin,
        planInput({ attachRunId: existing }, { start: { mode: "SKIP_FIRST" } }),
        OCC_NOW,
      ),
      "COMMUNITY_SCHEDULE_NOT_STARTED",
    );
    expect(await communityScheduleRunRepository.findByRunId(existing)).toBeNull();
  });

  it("From date after both upcoming occurrences: nothing at the next release, created once the boundary is released", async () => {
    const plan = await communityScheduleService.createSchedulePlan(
      admin,
      planInput({}, { start: { mode: "FROM_DATE", date: "2027-01-25" } }),
      OCC_NOW,
    );
    const slotId = plan.slotIds[0]!;
    expect((await communityScheduleRepository.findById(slotId))?.firstWindowStartAt).toBe("2027-01-27T05:00:00.000Z");

    const release = await communityScheduleMaterializationService.runPass(RELEASE_NOW);
    expect(release.status === "COMPLETED" && release.created).toBe(0);
    expect(release.status === "COMPLETED" && release.skippedBeforeStart).toBe(1);

    // Mon 25 Jan 2027 12:00 CET releases the boundary raid ID (Wed 27 Jan).
    const later = await communityScheduleMaterializationService.runPass(new Date("2027-01-25T11:00:00.000Z"));
    expect(later.status === "COMPLETED" && later.created).toBe(1);
    expect(later.status === "COMPLETED" && later.skippedBeforeStart).toBe(0);
  });

  it("legacy / Immediately: no boundary; the release creates its raid ID's occurrence only", async () => {
    const plan = await communityScheduleService.createSchedulePlan(admin, planInput({}), OCC_NOW);
    expect((await communityScheduleRepository.findById(plan.slotIds[0]!))?.firstWindowStartAt).toBeNull();
    const release = await communityScheduleMaterializationService.runPass(RELEASE_NOW);
    expect(release.status === "COMPLETED" && release.created).toBe(1);
  });
});

describe("Schedule-owned Draft lifecycle (cleanup on Schedule changes)", () => {
  afterEach(cleanupManualRuns);

  /** Slot with Schedule-created Drafts for CURRENT (Fri 15 Jan) and NEXT (Fri 22 Jan). */
  async function slotWithDrafts(extra: Record<string, unknown> = {}) {
    const plan = await communityScheduleService.createSchedulePlan(admin, planInput({}, extra), OCC_NOW);
    const slotId = plan.slotIds[0]!;
    const current = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: admin },
      { scheduleSlotId: slotId, window: "CURRENT", now: OCC_NOW },
    );
    const next = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: admin },
      { scheduleSlotId: slotId, window: "NEXT", now: OCC_NOW },
    );
    const slot = (await communityScheduleRepository.findById(slotId))!;
    const base = {
      slotId,
      weekday: slot.weekday,
      localStartTime: slot.localStartTime,
      label: slot.label,
      raidLeadId: slot.raidLeadId,
      notes: null,
      runTemplateId: templateId,
      autoCreateRun: true,
      runMode: "INHOUSE" as const,
    };
    return { slotId, currentRunId: current.runId, nextRunId: next.runId, base };
  }

  async function status(runId: string) {
    const run = (await orm.Run.where({ id: runId }).first()) as Record<string, unknown>;
    return { status: run.status, archived: run.archivedAt != null };
  }

  it("non-time edits (label, notes, Run Setup, composition, auto-create, earlier start) retire nothing", async () => {
    const { slotId, currentRunId, nextRunId, base } = await slotWithDrafts();
    const before = [await runSnapshot(currentRunId), await runSnapshot(nextRunId)];
    const result = await communityScheduleService.updateSlot(
      admin,
      { ...base, label: "Renamed", autoCreateRun: false, start: { mode: "IMMEDIATE" } },
      OCC_NOW,
    );
    expect(result.cleanup).toEqual({ retiredDrafts: 0, protectedRuns: 0, attachedRuns: 0 });
    expect([await runSnapshot(currentRunId), await runSnapshot(nextRunId)]).toEqual(before);
    expect(await communityScheduleRunRepository.listBySlotIds([slotId])).toHaveLength(2);
  });

  it("boundary moved later retires only the Drafts before it; moving it back does not recreate them", async () => {
    const { slotId, currentRunId, nextRunId, base } = await slotWithDrafts();
    const later = await communityScheduleService.updateSlot(admin, { ...base, start: { mode: "SKIP_FIRST" } }, OCC_NOW);
    expect((await communityScheduleRepository.findById(slotId))?.firstWindowStartAt).toBe(NEXT_WINDOW);
    expect(later.cleanup.retiredDrafts).toBe(1);
    expect(await status(currentRunId)).toEqual({ status: "CANCELLED", archived: true });
    expect(await status(nextRunId)).toEqual({ status: "DRAFT", archived: false });

    await communityScheduleService.updateSlot(admin, { ...base, start: { mode: "IMMEDIATE" } }, OCC_NOW);
    // No eager replacement: the freed CURRENT occurrence stays empty until Create Run.
    expect((await communityScheduleRunRepository.listBySlotIds([slotId])).map((link) => link.runId)).toEqual([nextRunId]);
  });

  it("Friday → Saturday: Drafts archived, no Saturday Draft until the release; released occurrence is not blocked", async () => {
    const { slotId, currentRunId, nextRunId, base } = await slotWithDrafts();
    const moved = await communityScheduleService.updateSlot(
      admin,
      { ...base, weekday: "SATURDAY", localStartTime: "20:00" },
      OCC_NOW,
    );
    expect(moved.cleanup).toEqual({ retiredDrafts: 2, protectedRuns: 0, attachedRuns: 0 });
    expect(await status(currentRunId)).toEqual({ status: "CANCELLED", archived: true });
    expect(await status(nextRunId)).toEqual({ status: "CANCELLED", archived: true });
    expect(await communityScheduleRunRepository.listBySlotIds([slotId])).toHaveLength(0);

    // The freed NEXT occurrence is released normally on Monday — on Saturday.
    const release = await communityScheduleMaterializationService.runPass(RELEASE_NOW);
    expect(release.status === "COMPLETED" && release.created).toBe(1);
    const link = (await linkFor(slotId, NEXT_WINDOW))!;
    expect(link.runId).not.toBe(nextRunId);
    expect(link.occurrenceStartAt).toBe("2027-01-23T19:00:00.000Z");
  });

  it("time change protects a Run that left DRAFT and a past Draft", async () => {
    const { currentRunId, nextRunId, base } = await slotWithDrafts();
    await runService.openRun(admin, nextRunId);
    const openedBefore = await runSnapshot(nextRunId);
    // After Fri 15 Jan 19:45 CET started: the CURRENT Draft is in the past.
    const afterStart = new Date("2027-01-15T20:00:00.000Z");
    const result = await communityScheduleService.updateSlot(
      admin,
      { ...base, localStartTime: "21:00" },
      afterStart,
    );
    expect(result.cleanup).toEqual({ retiredDrafts: 0, protectedRuns: 1, attachedRuns: 0 });
    expect(await runSnapshot(nextRunId)).toEqual(openedBefore);
    expect(await status(currentRunId)).toEqual({ status: "DRAFT", archived: false });
  });

  it("deactivate retires owned Drafts, never an ATTACHED Run; reactivate creates nothing", async () => {
    const plan = await communityScheduleService.createSchedulePlan(admin, planInput({}), OCC_NOW);
    const slotId = plan.slotIds[0]!;
    const attached = await manualRun("2027-01-15T19:00:00.000Z");
    await communityScheduleOccurrenceService.attachExistingRun(admin, { scheduleSlotId: slotId, runId: attached, now: OCC_NOW });
    const next = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: admin },
      { scheduleSlotId: slotId, window: "NEXT", now: OCC_NOW },
    );
    const attachedBefore = await runSnapshot(attached);

    const page = await communityScheduleService.getPage(admin, OCC_NOW);
    expect(page.runCountsBySlotId[slotId]).toEqual({ retiredDrafts: 1, protectedRuns: 0, attachedRuns: 1 });

    const result = await communityScheduleService.deactivateSlot(admin, slotId, OCC_NOW);
    expect(result.cleanup).toEqual({ retiredDrafts: 1, protectedRuns: 0, attachedRuns: 1 });
    expect(await status(next.runId)).toEqual({ status: "CANCELLED", archived: true });
    expect(await runSnapshot(attached)).toEqual(attachedBefore);
    expect((await communityScheduleRunRepository.findByRunId(attached))?.scheduleSlotId).toBe(slotId);

    await communityScheduleService.reactivateSlot(admin, slotId);
    expect((await communityScheduleRunRepository.listBySlotIds([slotId])).map((link) => link.runId)).toEqual([attached]);
  });

  it("delete time and delete Run Setup retire owned Drafts in the same transaction", async () => {
    const one = await slotWithDrafts();
    const deleted = await communityScheduleService.deleteSlot(admin, one.slotId, OCC_NOW);
    expect(deleted.cleanup.retiredDrafts).toBe(2);
    expect(await status(one.currentRunId)).toEqual({ status: "CANCELLED", archived: true });
    expect(await communityScheduleRepository.findById(one.slotId)).toBeNull();

    const setupTemplate = await runTemplateRepository.create({
      name: "CSM Delete Setup",
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 }],
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: null,
      createdById: ids.admin,
      updatedById: ids.admin,
    });
    const plan = await communityScheduleService.createSchedulePlan(
      admin,
      { ...planInput({}), runSetup: { mode: "existing", templateId: setupTemplate } },
      OCC_NOW,
    );
    const draft = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user: admin },
      { scheduleSlotId: plan.slotIds[0]!, window: "NEXT", now: OCC_NOW },
    );
    const removed = await communityScheduleService.deleteRunSetup(admin, setupTemplate, OCC_NOW);
    expect(removed.cleanup.retiredDrafts).toBe(1);
    expect(await status(draft.runId)).toEqual({ status: "CANCELLED", archived: true });
  });

  it("a cleanup failure rolls the Schedule change and the retirement back together (atomic)", async () => {
    const { slotId, currentRunId, nextRunId, base } = await slotWithDrafts();
    const spy = vi
      .spyOn(communityScheduleRunRepository, "releaseFromSlotInTx")
      .mockRejectedValueOnce(new Error("injected failure"));
    try {
      await expect(
        communityScheduleService.updateSlot(admin, { ...base, localStartTime: "21:00" }, OCC_NOW),
      ).rejects.toThrow("injected failure");
    } finally {
      spy.mockRestore();
    }
    expect((await communityScheduleRepository.findById(slotId))?.localStartTime).toBe("19:45");
    expect(await status(currentRunId)).toEqual({ status: "DRAFT", archived: false });
    expect(await status(nextRunId)).toEqual({ status: "DRAFT", archived: false });
    expect(await communityScheduleRunRepository.listBySlotIds([slotId])).toHaveLength(2);
  });

  it("time edit racing the release pass never leaves an orphan or duplicate Draft", async () => {
    const plan = await communityScheduleService.createSchedulePlan(admin, planInput({}), OCC_NOW);
    const slotId = plan.slotIds[0]!;
    const slot = (await communityScheduleRepository.findById(slotId))!;
    const [edit, pass] = await Promise.allSettled([
      communityScheduleService.updateSlot(
        admin,
        {
          slotId,
          weekday: "SATURDAY",
          localStartTime: "20:00",
          label: slot.label,
          raidLeadId: ids.lead,
          notes: null,
          runTemplateId: templateId,
          autoCreateRun: true,
          runMode: "INHOUSE",
        },
        RELEASE_NOW,
      ),
      communityScheduleMaterializationService.runPass(RELEASE_NOW),
    ]);
    expect(edit.status).toBe("fulfilled");
    expect(pass.status).toBe("fulfilled");
    // Either the pass ran first (its Friday Draft was retired by the edit) or it saw the
    // changed slot (skipped / created Saturday). No live Draft for the old Friday time.
    const links = await communityScheduleRunRepository.listBySlotIds([slotId]);
    expect(links.length).toBeLessThanOrEqual(1);
    for (const link of links) {
      expect(link.occurrenceStartAt).toBe("2027-01-23T19:00:00.000Z");
    }
    const liveFridayDrafts = (await orm.Run.where({ raidLeadId: ids.lead, status: "DRAFT" }).all()).filter(
      (row) => Date.parse(String((row as { scheduledStartAt: string }).scheduledStartAt)) === Date.parse("2027-01-22T18:45:00.000Z") &&
        (row as { archivedAt: string | null }).archivedAt == null,
    );
    expect(liveFridayDrafts).toHaveLength(0);
    // The released occurrence is never blocked: a further pass converges to exactly one Saturday Draft.
    await communityScheduleMaterializationService.runPass(RELEASE_NOW);
    expect(await communityScheduleRunRepository.listBySlotIds([slotId])).toHaveLength(1);
  });

  it("deactivation racing Create Run leaves no live Draft for an inactive slot", async () => {
    const plan = await communityScheduleService.createSchedulePlan(admin, planInput({}, { autoCreateRun: false }), OCC_NOW);
    const slotId = plan.slotIds[0]!;
    await Promise.allSettled([
      communityScheduleService.deactivateSlot(admin, slotId, OCC_NOW),
      communityScheduleMaterializationService.materializeOccurrence(
        { kind: "USER", user: admin },
        { scheduleSlotId: slotId, window: "NEXT", now: OCC_NOW },
      ),
    ]);
    expect((await communityScheduleRepository.findById(slotId))?.isActive).toBe(false);
    for (const link of await communityScheduleRunRepository.listBySlotIds([slotId])) {
      expect(await status(link.runId)).not.toEqual({ status: "DRAFT", archived: false });
    }
  });
});

describe("Attach existing Run to a Schedule occurrence", () => {
  afterEach(cleanupManualRuns);

  it("create with 'Use existing Run': occurrence satisfied by the untouched Run, no duplicate, next raid ID normal", async () => {
    const existing = await manualRun("2027-01-15T19:00:00.000Z", 7);
    const before = await runSnapshot(existing);

    const plan = await communityScheduleService.createSchedulePlan(
      admin,
      planInput({ attachRunId: existing }),
      OCC_NOW,
    );
    const slotId = plan.slotIds[0]!;
    const current = await linkFor(slotId, CURRENT_WINDOW);
    expect(current?.runId).toBe(existing);
    expect(current?.origin).toBe("ATTACHED");
    expect(current?.createdByKind).toBe("USER");
    // Saving creates nothing else; the CURRENT raid ID's pass sees the attached Run as fulfillment.
    expect(await linkFor(slotId, NEXT_WINDOW)).toBeNull();
    const pass = await communityScheduleMaterializationService.runPass(OCC_NOW);
    expect(pass.status === "COMPLETED" && pass.created).toBe(0);
    expect(pass.status === "COMPLETED" && pass.alreadyCreated).toBe(1);
    // The next release creates NEXT normally from the Run Setup.
    await communityScheduleMaterializationService.runPass(RELEASE_NOW);
    expect((await linkFor(slotId, NEXT_WINDOW))?.origin).toBe("MATERIALIZED");

    // The attached Run is never rewritten (7/8, own time, untouched updatedAt).
    expect(await runSnapshot(existing)).toEqual(before);

    const events = (await orm.RunDomainEvent.where({ runId: existing }).all()) as Array<{ type: string }>;
    expect(events.some((event) => event.type === "RUN_SCHEDULE_ATTACHED")).toBe(true);

    const page = await communityScheduleService.getPage(admin, OCC_NOW);
    const row = page.current.days.flatMap((day) => day.slots).find((entry) => entry.slot.id === slotId);
    expect(row?.materialization.state).toBe("RUN_CREATED");
    expect(row?.materialization.origin).toBe("ATTACHED");
    expect(row?.materialization.runId).toBe(existing);
  });

  it("Schedule-side picker lists the Run with warnings; attach links it; later Run Setup / composition edits leave it alone", async () => {
    const plan = await communityScheduleService.createSchedulePlan(
      admin,
      planInput({}, { autoCreateRun: false }),
      OCC_NOW,
    );
    const slotId = plan.slotIds[0]!;
    const existing = await manualRun("2027-01-15T19:00:00.000Z", 7);

    const slot = (await communityScheduleRepository.findById(slotId))!;
    const candidates = await communityScheduleOccurrenceService.listAttachCandidates(admin, { slot, now: OCC_NOW });
    const candidate = candidates.find((row) => row.runId === existing);
    expect(candidate?.windowStartAt).toBe(CURRENT_WINDOW);
    expect(candidate?.warnings.map((warning) => warning.code).sort()).toEqual(["CONTENT", "TIME"]);

    const before = await runSnapshot(existing);
    await communityScheduleOccurrenceService.attachExistingRun(admin, { scheduleSlotId: slotId, runId: existing, now: OCC_NOW });
    expect((await linkFor(slotId, CURRENT_WINDOW))?.runId).toBe(existing);
    expect(
      (await communityScheduleOccurrenceService.listAttachCandidates(admin, { slot, now: OCC_NOW })).some(
        (row) => row.runId === existing,
      ),
    ).toBe(false);

    // Run Setup and Schedule composition edits never reach the attached Run.
    await runTemplateRepository.update(templateId, {
      name: "CSM Materialize Template",
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 6 }],
      desiredTankCount: 3,
      desiredHealerCount: 4,
      desiredDpsCount: 13,
      notes: null,
      updatedById: ids.admin,
    } as never);
    await communityScheduleService.updateSlot(
      admin,
      {
        slotId,
        weekday: slot.weekday,
        localStartTime: slot.localStartTime,
        label: slot.label,
        raidLeadId: slot.raidLeadId,
        notes: null,
        runTemplateId: templateId,
        autoCreateRun: true,
        runMode: "INHOUSE",
        compositionOverrideEnabled: true,
        desiredTankCountOverride: 1,
        desiredHealerCountOverride: 1,
        desiredDpsCountOverride: 1,
        desiredLootbuddyCountOverride: 0,
      },
      OCC_NOW,
    );
    expect(await runSnapshot(existing)).toEqual(before);
  });

  it("blocks: Run already attached elsewhere, occurrence already fulfilled, CANCELLED Run, past raid ID", async () => {
    const plan = await communityScheduleService.createSchedulePlan(admin, planInput({}, { autoCreateRun: false }), OCC_NOW);
    const otherPlan = await communityScheduleService.createSchedulePlan(
      admin,
      {
        ...planInput({ localStartTime: "21:00" }, { autoCreateRun: false }),
      },
      OCC_NOW,
    );
    const slotId = plan.slotIds[0]!;
    const otherSlotId = otherPlan.slotIds[0]!;
    const first = await manualRun("2027-01-15T19:00:00.000Z");
    const second = await manualRun("2027-01-15T20:30:00.000Z");

    await communityScheduleOccurrenceService.attachExistingRun(admin, { scheduleSlotId: slotId, runId: first, now: OCC_NOW });
    await expectCode(
      communityScheduleOccurrenceService.attachExistingRun(admin, { scheduleSlotId: otherSlotId, runId: first, now: OCC_NOW }),
      "COMMUNITY_SCHEDULE_RUN_ALREADY_ATTACHED",
    );
    await expectCode(
      communityScheduleOccurrenceService.attachExistingRun(admin, { scheduleSlotId: slotId, runId: second, now: OCC_NOW }),
      "COMMUNITY_SCHEDULE_OCCURRENCE_FULFILLED",
    );

    const cancelled = await manualRun("2027-01-22T19:00:00.000Z");
    await runService.cancelRun(lead, cancelled);
    await expectCode(
      communityScheduleOccurrenceService.attachExistingRun(admin, { scheduleSlotId: slotId, runId: cancelled, now: OCC_NOW }),
      "COMMUNITY_SCHEDULE_RUN_NOT_ATTACHABLE",
    );

    // A week later the 15 Jan Run belongs to a past raid ID.
    await expectCode(
      communityScheduleOccurrenceService.attachExistingRun(admin, {
        scheduleSlotId: otherSlotId,
        runId: second,
        now: new Date("2027-01-21T12:00:00.000Z"),
      }),
      "COMMUNITY_SCHEDULE_RUN_NOT_ATTACHABLE",
    );
    // Untouched: the 15 Jan occurrence of the first slot is still exactly one Run.
    expect((await communityScheduleRunRepository.listBySlotIds([slotId])).map((link) => link.runId)).toEqual([first]);
  });

  it("attach racing the materializer for the same occurrence ends with exactly one fulfillment", async () => {
    const plan = await communityScheduleService.createSchedulePlan(admin, planInput({}, { autoCreateRun: false }), OCC_NOW);
    const slotId = plan.slotIds[0]!;
    const existing = await manualRun("2027-01-15T19:00:00.000Z");
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

    const [attach, auto] = await Promise.allSettled([
      communityScheduleOccurrenceService.attachExistingRun(admin, { scheduleSlotId: slotId, runId: existing, now: OCC_NOW }),
      communityScheduleMaterializationService.runPass(OCC_NOW),
    ]);
    const links = (await communityScheduleRunRepository.listBySlotIds([slotId])).filter(
      (link) => link.windowStartAt === CURRENT_WINDOW,
    );
    expect(links).toHaveLength(1);
    if (attach.status === "fulfilled") {
      expect(links[0]!.runId).toBe(existing);
    } else {
      expect(links[0]!.origin).toBe("MATERIALIZED");
      expect(await communityScheduleRunRepository.findByRunId(existing)).toBeNull();
    }
    expect(auto.status).toBe("fulfilled");
    // No orphan materialized Run without a link.
    const slotRuns = (await orm.CommunityScheduleRun.all()).filter(
      (row) => (row as { scheduleSlotId: string }).scheduleSlotId === slotId,
    );
    expect(slotRuns).toHaveLength(1);
  });
});
