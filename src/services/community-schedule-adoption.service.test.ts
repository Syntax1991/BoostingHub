import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { venomousCreateInput, venomousUpdateInput } from "@/lib/test-run-input";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { communityScheduleRepository } from "@/repositories/community-schedule.repository";
import { communityScheduleRunRepository } from "@/repositories/community-schedule-run.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { runTemplateRepository } from "@/repositories/run-template.repository";
import { communityScheduleMaterializationService } from "@/services/community-schedule-materialization.service";
import { communityScheduleOccurrenceService } from "@/services/community-schedule-occurrence.service";
import { communityScheduleService } from "@/services/community-schedule.service";
import { runService } from "@/services/run.service";

/** Distinct prefix from the other schedule suites (`cs…`, `csm…`). */
const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-csa000000001",
  otherLead: "aaaaaaaa-aaaa-4aaa-8aaa-csa000000002",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-csa000000003",
};
const testUserIds = new Set(Object.values(ids));

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@csa.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

const lead = asUser(ids.lead, "CSA Lead", "RAID_LEAD");
const otherLead = asUser(ids.otherLead, "CSA Other Lead", "RAID_LEAD");
const admin = asUser(ids.admin, "CSA Admin", "ADMIN");

// Fri 15 Jan 2027 12:00Z — CURRENT raid ID Wed 13 Jan 06:00 CET, NEXT Wed 20 Jan.
const OCC_NOW = new Date("2027-01-15T12:00:00.000Z");
const CURRENT_WINDOW = "2027-01-13T05:00:00.000Z";
const NEXT_WINDOW = "2027-01-20T05:00:00.000Z";
/** Fri 22 Jan 2027 20:00 CET. */
const NEXT_FRIDAY_2000 = "2027-01-22T19:00:00.000Z";
/** Mon 25 Jan 2027 12:00 CET — releases the raid ID starting Wed 27 Jan. */
const RELEASE_27_JAN = new Date("2027-01-25T11:00:00.000Z");

async function upsertUser(user: AuthenticatedUser) {
  const now = new Date().toISOString();
  const existing = await orm.User.where({ id: user.id }).first();
  if (existing) {
    await orm.User.where({ id: user.id }).update({ name: user.name, accountRole: user.accountRole, accountStatus: "ACTIVE", updatedAt: now });
    return;
  }
  await orm.User.create({
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: true,
    accountRole: user.accountRole,
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
}

async function deleteRun(runId: string) {
  await orm.CommunityScheduleRun.where({ runId }).delete().catch(() => {});
  await orm.RunDomainEvent.where({ runId }).delete().catch(() => {});
  await orm.RunRoster.where({ runId }).delete().catch(() => {});
  await orm.RunRaidContent.where({ runId }).delete().catch(() => {});
  await orm.RunDiscordAnnouncement.where({ runId }).delete().catch(() => {});
  await orm.UserNotification.where({ runId }).delete().catch(() => {});
  await orm.Run.where({ id: runId }).delete().catch(() => {});
}

async function cleanup() {
  for (const row of (await orm.Run.all()) as Array<{ id: string; raidLeadId: string }>) {
    if (testUserIds.has(row.raidLeadId)) await deleteRun(row.id);
  }
  for (const row of (await orm.CommunityScheduleSlot.all()) as Array<{ id: string; raidLeadId: string; createdById: string }>) {
    if (testUserIds.has(row.raidLeadId) || testUserIds.has(row.createdById)) {
      await orm.CommunityScheduleSlot.where({ id: row.id }).delete().catch(() => {});
    }
  }
  for (const row of (await orm.RunTemplate.all()) as Array<{ id: string; createdById: string }>) {
    if (testUserIds.has(row.createdById)) await orm.RunTemplate.where({ id: row.id }).delete().catch(() => {});
  }
  await orm.ActivityEvent.where({ userId: ids.lead }).delete().catch(() => {});
  await orm.ActivityEvent.where({ userId: ids.admin }).delete().catch(() => {});
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

/** A manually created Run (no Run Setup), Venomous Abyss with the given planning fields. */
async function manualRun(input: {
  scheduledStartAt: string;
  bosses: number;
  composition: [number, number, number, number];
  lootType?: "UNSAVED" | "VIP";
  raidLead?: AuthenticatedUser;
}): Promise<string> {
  const [tanks, healers, dps, lootbuddies] = input.composition;
  const created = await runService.createRun(
    input.raidLead ?? lead,
    venomousCreateInput({
      scheduledStartAt: input.scheduledStartAt,
      venomousPlannedBossCount: input.bosses,
      lootType: input.lootType ?? "UNSAVED",
      desiredTankCount: tanks,
      desiredHealerCount: healers,
      desiredDpsCount: dps,
      desiredLootbuddyCount: lootbuddies,
    }),
  );
  return created.id;
}

async function runSnapshot(runId: string) {
  const run = (await orm.Run.where({ id: runId }).first()) as Record<string, unknown>;
  const contents = (await orm.RunRaidContent.where({ runId }).all()) as Array<Record<string, unknown>>;
  return {
    status: run.status,
    archivedAt: run.archivedAt,
    scheduledStartAt: String(run.scheduledStartAt),
    raidLeadId: run.raidLeadId,
    title: run.title,
    lootType: run.lootType,
    composition: [run.desiredTankCount, run.desiredHealerCount, run.desiredDpsCount, run.desiredLootbuddyCount],
    updatedAt: String(run.updatedAt),
    contents: contents.map((row) => `${row.raidId}:${row.sortOrder}:${row.plannedBossCount}`).sort(),
  };
}

async function testTemplates() {
  return ((await orm.RunTemplate.all()) as Array<{ id: string; createdById: string }>).filter((row) =>
    testUserIds.has(row.createdById),
  );
}

async function setupA() {
  return runTemplateRepository.create({
    name: "CSA Setup A",
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 6 }],
    desiredTankCount: 2,
    desiredHealerCount: 3,
    desiredDpsCount: 13,
    desiredLootbuddyCount: 1,
    notes: null,
    createdById: ids.admin,
    updatedById: ids.admin,
  });
}

async function candidateFor(runId: string, start?: { mode: "SKIP_FIRST" | "IMMEDIATE" }) {
  const candidates = await communityScheduleOccurrenceService.listAdoptionCandidates(admin, { now: OCC_NOW, start });
  return candidates.find((row) => row.runId === runId) ?? null;
}

function planFromRun(runId: string, slot: { weekday: "FRIDAY"; localStartTime: string }, extra: Record<string, unknown> = {}) {
  return communityScheduleService.createSchedulePlan(
    admin,
    {
      // No runSetup / raidLeadId: the server adopts both from the first existing-Run occurrence.
      slots: [{ ...slot, runMode: "INHOUSE", attachRunId: runId }],
      autoCreateRun: true,
      notes: null,
      ...extra,
    } as never,
    OCC_NOW,
  );
}

beforeAll(async () => {
  await upsertUser(lead);
  await upsertUser(otherLead);
  await upsertUser(admin);
  await raidRepository.ensureReferenceRaids();
  await cleanup();
});
beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  for (const id of Object.values(ids)) await orm.User.where({ id }).delete().catch(() => {});
});

describe("Create Schedule from an existing Run (adoption)", () => {
  it("equivalent Run Setup is adopted exactly (no duplicate); Raid Lead, weekday and time from the Run", async () => {
    const templateA = await setupA();
    const runId = await manualRun({ scheduledStartAt: NEXT_FRIDAY_2000, bosses: 6, composition: [2, 3, 13, 1] });
    const before = await runSnapshot(runId);

    const candidate = await candidateFor(runId);
    expect(candidate).toMatchObject({
      weekday: "FRIDAY",
      localStartTime: "20:00",
      raidLeadId: ids.lead,
      windowStartAt: NEXT_WINDOW,
      runSetup: { mode: "existing", templateId: templateA, templateName: "CSA Setup A" },
    });

    const plan = await planFromRun(runId, { weekday: "FRIDAY", localStartTime: "20:00" });
    expect(plan.templateId).toBe(templateA);
    expect((await testTemplates()).map((row) => row.id)).toEqual([templateA]);
    const slot = (await communityScheduleRepository.findById(plan.slotIds[0]!))!;
    expect(slot).toMatchObject({ runTemplateId: templateA, raidLeadId: ids.lead, weekday: "FRIDAY", localStartTime: "20:00" });

    const link = (await communityScheduleRunRepository.findByRunId(runId))!;
    expect(link).toMatchObject({ origin: "ATTACHED", scheduleSlotId: slot.id, windowStartAt: NEXT_WINDOW });
    expect(await runSnapshot(runId)).toEqual(before);
  });

  it("manual Run without a matching setup: one new Run Setup snapshotted from RunRaidContent + planned composition", async () => {
    const runId = await manualRun({
      scheduledStartAt: NEXT_FRIDAY_2000,
      bosses: 5,
      composition: [3, 3, 12, 2],
      lootType: "VIP",
    });
    const before = await runSnapshot(runId);
    const candidate = (await candidateFor(runId))!;
    expect(candidate.runSetup.mode).toBe("fromRun");

    const plan = await planFromRun(runId, { weekday: "FRIDAY", localStartTime: "20:00" });
    const created = (await runTemplateRepository.findById(plan.templateId))!;
    expect(created).toMatchObject({
      name: candidate.runSetup.templateName,
      difficulty: "HEROIC",
      lootType: "VIP",
      desiredTankCount: 3,
      desiredHealerCount: 3,
      desiredDpsCount: 12,
      desiredLootbuddyCount: 2,
      isActive: true,
    });
    expect(created.contents.map((row) => `${row.raidId}:${row.sortOrder}:${row.plannedBossCount}`)).toEqual([
      `${VENOMOUS_ABYSS_RAID_ID}:1:5`,
    ]);
    expect(await testTemplates()).toHaveLength(1);
    expect(await runSnapshot(runId)).toEqual(before);

    // One-time copy: editing the Run afterwards changes neither the Setup nor the Schedule.
    const run = (await runRepository.findById(runId))!;
    await runService.updateRun(
      lead,
      venomousUpdateInput(runId, run, { venomousPlannedBossCount: 7, scheduledStartAt: "2027-01-22T19:30:00.000Z" }),
    );
    const setupAfter = (await runTemplateRepository.findById(plan.templateId))!;
    expect(setupAfter.contents[0]!.plannedBossCount).toBe(5);
    expect((await communityScheduleRepository.findById(plan.slotIds[0]!))?.localStartTime).toBe("20:00");

    // A second identical Run reuses the snapshot instead of creating another setup.
    const twin = await manualRun({
      scheduledStartAt: "2027-01-23T19:00:00.000Z",
      bosses: 5,
      composition: [3, 3, 12, 2],
      lootType: "VIP",
    });
    expect((await candidateFor(twin))?.runSetup).toMatchObject({ mode: "existing", templateId: plan.templateId });
  });

  it("future occurrences follow the adopted Setup / Raid Lead / weekday-time; Monday release unchanged, no eager create", async () => {
    await setupA();
    const runId = await manualRun({ scheduledStartAt: NEXT_FRIDAY_2000, bosses: 6, composition: [2, 3, 13, 1] });
    const plan = await planFromRun(runId, { weekday: "FRIDAY", localStartTime: "20:00" });
    const slotId = plan.slotIds[0]!;
    expect(await communityScheduleRunRepository.listBySlotIds([slotId])).toHaveLength(1);

    // The release for the attached raid ID treats it as fulfilled.
    const forAttached = await communityScheduleMaterializationService.runPass(new Date("2027-01-18T11:00:00.000Z"));
    expect(forAttached.status === "COMPLETED" && forAttached.created).toBe(0);
    expect(await communityScheduleRunRepository.listBySlotIds([slotId])).toHaveLength(1);

    const release = await communityScheduleMaterializationService.runPass(RELEASE_27_JAN);
    expect(release.status === "COMPLETED" && release.created).toBe(1);
    const next = (await communityScheduleRunRepository.listBySlotIds([slotId])).find((link) => link.origin === "MATERIALIZED")!;
    const nextRun = (await runRepository.findById(next.runId))!;
    expect(nextRun.raidLeadId).toBe(ids.lead);
    expect(Date.parse(nextRun.scheduledStartAt)).toBe(Date.parse("2027-01-29T19:00:00.000Z"));
    expect(nextRun.contents.map((row) => row.plannedBossCount)).toEqual([6]);
    expect([nextRun.desiredTankCount, nextRun.desiredHealerCount, nextRun.desiredDpsCount, nextRun.desiredLootbuddyCount]).toEqual([2, 3, 13, 1]);
  });

  it("changing the Schedule afterwards (Raid Lead, time, Run Setup) or deleting it never touches the attached Run", async () => {
    await setupA();
    const runId = await manualRun({ scheduledStartAt: NEXT_FRIDAY_2000, bosses: 6, composition: [2, 3, 13, 1] });
    const before = await runSnapshot(runId);
    const plan = await planFromRun(runId, { weekday: "FRIDAY", localStartTime: "20:00" });
    const slotId = plan.slotIds[0]!;
    const other = await runTemplateRepository.create({
      name: "CSA Other Setup",
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

    const edited = await communityScheduleService.updateSlot(
      admin,
      {
        slotId,
        weekday: "FRIDAY",
        localStartTime: "20:30",
        label: "Changed",
        raidLeadId: ids.otherLead,
        notes: null,
        runTemplateId: other,
        autoCreateRun: true,
        runMode: "INHOUSE",
      },
      OCC_NOW,
    );
    expect(edited.cleanup).toEqual({ retiredDrafts: 0, protectedRuns: 0, attachedRuns: 1 });
    expect(await runSnapshot(runId)).toEqual(before);
    expect((await communityScheduleRunRepository.findByRunId(runId))?.scheduleSlotId).toBe(slotId);

    // ATTACHED Draft: deleting the Schedule keeps it (never archived).
    const deleted = await communityScheduleService.deleteSlot(admin, slotId, OCC_NOW);
    expect(deleted.cleanup.retiredDrafts).toBe(0);
    expect(await runSnapshot(runId)).toEqual(before);
  });

  it("start boundary: a Run before Starts is not listed and creating with it is refused atomically", async () => {
    const runId = await manualRun({ scheduledStartAt: "2027-01-15T19:00:00.000Z", bosses: 5, composition: [3, 3, 12, 2] });
    expect((await candidateFor(runId))?.windowStartAt).toBe(CURRENT_WINDOW);
    expect(await candidateFor(runId, { mode: "SKIP_FIRST" })).toBeNull();

    await expectCode(
      planFromRun(runId, { weekday: "FRIDAY", localStartTime: "20:00" }, { start: { mode: "SKIP_FIRST" } }),
      "COMMUNITY_SCHEDULE_NOT_STARTED",
    );
    // Nothing partial: no setup snapshot, no slot, no link.
    expect(await testTemplates()).toHaveLength(0);
    expect(await orm.CommunityScheduleSlot.where({ raidLeadId: ids.lead }).all()).toHaveLength(0);
    expect(await communityScheduleRunRepository.findByRunId(runId)).toBeNull();
  });

  it("a Run already attached elsewhere is not listed and is refused without partial writes", async () => {
    const runId = await manualRun({ scheduledStartAt: NEXT_FRIDAY_2000, bosses: 5, composition: [3, 3, 12, 2] });
    await planFromRun(runId, { weekday: "FRIDAY", localStartTime: "20:00" });
    const templatesBefore = (await testTemplates()).length;
    expect(await candidateFor(runId)).toBeNull();

    await expectCode(
      communityScheduleService.createSchedulePlan(
        admin,
        {
          raidLeadId: ids.otherLead,
          slots: [{ weekday: "FRIDAY", localStartTime: "20:00", runMode: "INHOUSE", attachRunId: runId }],
          autoCreateRun: false,
          notes: null,
        } as never,
        OCC_NOW,
      ),
      "COMMUNITY_SCHEDULE_RUN_ALREADY_ATTACHED",
    );
    expect(await testTemplates()).toHaveLength(templatesBefore);
    expect(await orm.CommunityScheduleSlot.where({ raidLeadId: ids.otherLead }).all()).toHaveLength(0);
  });

  it("an occurrence that is already fulfilled cannot take a second existing Run", async () => {
    const first = await manualRun({ scheduledStartAt: NEXT_FRIDAY_2000, bosses: 5, composition: [3, 3, 12, 2] });
    const second = await manualRun({ scheduledStartAt: "2027-01-22T20:00:00.000Z", bosses: 5, composition: [3, 3, 12, 2] });
    const plan = await planFromRun(first, { weekday: "FRIDAY", localStartTime: "20:00" });
    await expectCode(
      communityScheduleOccurrenceService.attachExistingRun(admin, { scheduleSlotId: plan.slotIds[0]!, runId: second, now: OCC_NOW }),
      "COMMUNITY_SCHEDULE_OCCURRENCE_FULFILLED",
    );
  });

  it("transaction failure after the setup snapshot leaves no setup, slot or attachment behind", async () => {
    const runId = await manualRun({ scheduledStartAt: NEXT_FRIDAY_2000, bosses: 5, composition: [3, 3, 12, 2] });
    const spy = vi.spyOn(communityScheduleRunRepository, "create").mockRejectedValueOnce(new Error("injected failure"));
    try {
      await expect(planFromRun(runId, { weekday: "FRIDAY", localStartTime: "20:00" })).rejects.toThrow("injected failure");
    } finally {
      spy.mockRestore();
    }
    expect(await testTemplates()).toHaveLength(0);
    expect(await orm.CommunityScheduleSlot.where({ raidLeadId: ids.lead }).all()).toHaveLength(0);
    expect(await communityScheduleRunRepository.findByRunId(runId)).toBeNull();
  });

  it("without a Run Setup or an existing first-occurrence Run the plan is refused", async () => {
    await expectCode(
      communityScheduleService.createSchedulePlan(
        admin,
        {
          raidLeadId: ids.lead,
          slots: [{ weekday: "FRIDAY", localStartTime: "20:00", runMode: "INHOUSE" }],
          autoCreateRun: false,
          notes: null,
        } as never,
        OCC_NOW,
      ),
      "VALIDATION_FAILED",
    );
  });

  it("future Raid Lead / time chosen before save win; the Run stays as it is", async () => {
    await setupA();
    const runId = await manualRun({ scheduledStartAt: NEXT_FRIDAY_2000, bosses: 6, composition: [2, 3, 13, 1] });
    const before = await runSnapshot(runId);
    const plan = await planFromRun(runId, { weekday: "FRIDAY", localStartTime: "20:30" }, { raidLeadId: ids.otherLead });
    const slot = (await communityScheduleRepository.findById(plan.slotIds[0]!))!;
    expect(slot).toMatchObject({ raidLeadId: ids.otherLead, localStartTime: "20:30" });
    expect((await communityScheduleRunRepository.findByRunId(runId))?.windowStartAt).toBe(NEXT_WINDOW);
    expect(await runSnapshot(runId)).toEqual(before);

    const release = await communityScheduleMaterializationService.runPass(RELEASE_27_JAN);
    expect(release.status === "COMPLETED" && release.created).toBe(1);
    const next = (await communityScheduleRunRepository.listBySlotIds([slot.id])).find((link) => link.origin === "MATERIALIZED")!;
    const nextRun = (await runRepository.findById(next.runId))!;
    expect(nextRun.raidLeadId).toBe(ids.otherLead);
    expect(Date.parse(nextRun.scheduledStartAt)).toBe(Date.parse("2027-01-29T19:30:00.000Z"));
  });

  it("an explicit Run Setup overrides the adoption; the Run is still attached", async () => {
    await setupA();
    const runId = await manualRun({ scheduledStartAt: NEXT_FRIDAY_2000, bosses: 6, composition: [2, 3, 13, 1] });
    const other = await runTemplateRepository.create({
      name: "CSA Explicit Setup",
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
    const plan = await planFromRun(runId, { weekday: "FRIDAY", localStartTime: "20:00" }, {
      runSetup: { mode: "existing", templateId: other },
    });
    expect(plan.templateId).toBe(other);
    expect((await communityScheduleRunRepository.findByRunId(runId))?.origin).toBe("ATTACHED");
  });

  it("the first time using an existing Run is the configuration source", async () => {
    await setupA();
    const first = await manualRun({ scheduledStartAt: NEXT_FRIDAY_2000, bosses: 6, composition: [2, 3, 13, 1] });
    const second = await manualRun({
      scheduledStartAt: "2027-01-23T19:00:00.000Z",
      bosses: 5,
      composition: [3, 3, 12, 2],
      raidLead: otherLead,
    });
    const plan = await communityScheduleService.createSchedulePlan(
      admin,
      {
        slots: [
          { weekday: "THURSDAY", localStartTime: "20:00", runMode: "INHOUSE" },
          { weekday: "FRIDAY", localStartTime: "20:00", runMode: "INHOUSE", attachRunId: first },
          { weekday: "SATURDAY", localStartTime: "20:00", runMode: "INHOUSE", attachRunId: second },
        ],
        autoCreateRun: false,
        notes: null,
      } as never,
      OCC_NOW,
    );
    const slots = await Promise.all(plan.slotIds.map((id) => communityScheduleRepository.findById(id)));
    expect(new Set(slots.map((slot) => slot!.runTemplateId))).toEqual(new Set([plan.templateId]));
    expect((await runTemplateRepository.findById(plan.templateId))?.name).toBe("CSA Setup A");
    expect(new Set(slots.map((slot) => slot!.raidLeadId))).toEqual(new Set([ids.lead]));
    expect((await communityScheduleRunRepository.findByRunId(second))?.origin).toBe("ATTACHED");
  });

  it("a Raid Lead who is no longer eligible is not adopted (user must choose)", async () => {
    const runId = await manualRun({
      scheduledStartAt: NEXT_FRIDAY_2000,
      bosses: 5,
      composition: [3, 3, 12, 2],
      raidLead: otherLead,
    });
    await orm.User.where({ id: ids.otherLead }).update({ accountRole: "USER" });
    try {
      const candidate = (await candidateFor(runId))!;
      expect(candidate.raidLeadId).toBeNull();
      expect(candidate.raidLeadName).toBe("CSA Other Lead");
      expect(candidate.runSetup.mode).toBe("fromRun");

      // Without a chosen Raid Lead the server refuses; the Setup is still adopted once one is chosen.
      await expectCode(planFromRun(runId, { weekday: "FRIDAY", localStartTime: "20:00" }), "COMMUNITY_SCHEDULE_RAID_LEAD_INVALID");
      expect(await testTemplates()).toHaveLength(0);
      const plan = await planFromRun(runId, { weekday: "FRIDAY", localStartTime: "20:00" }, { raidLeadId: ids.lead });
      expect((await runTemplateRepository.findById(plan.templateId))?.contents.map((row) => row.plannedBossCount)).toEqual([5]);
      expect((await communityScheduleRepository.findById(plan.slotIds[0]!))?.raidLeadId).toBe(ids.lead);
    } finally {
      await orm.User.where({ id: ids.otherLead }).update({ accountRole: "RAID_LEAD" });
    }
  });
});

describe("draft-slot picker (create dialogs)", () => {
  it("names the selected Raid Lead in the Raid Lead warning", async () => {
    const runId = await manualRun({ scheduledStartAt: NEXT_FRIDAY_2000, bosses: 5, composition: [3, 3, 12, 2] });
    const candidates = await communityScheduleOccurrenceService.listAttachCandidates(admin, {
      slot: { weekday: "FRIDAY", localStartTime: "20:00", raidLeadId: ids.otherLead, runTemplateId: null },
      now: OCC_NOW,
    });
    const warning = candidates.find((row) => row.runId === runId)?.warnings.find((row) => row.code === "RAID_LEAD");
    expect(warning?.message).toBe("Raid Lead CSA Lead differs from the schedule's CSA Other Lead.");
  });
});

describe("Add times with an existing Run", () => {
  it("adopts weekday / time only — the group's Run Setup and Raid Lead stay authoritative", async () => {
    const templateA = await setupA();
    const runId = await manualRun({
      scheduledStartAt: NEXT_FRIDAY_2000,
      bosses: 5,
      composition: [3, 3, 12, 2],
      raidLead: otherLead,
    });
    const before = await runSnapshot(runId);
    const added = await communityScheduleService.addTimesToSetup(
      admin,
      {
        raidLeadId: ids.lead,
        runTemplateId: templateA,
        slots: [{ weekday: "FRIDAY", localStartTime: "20:00", runMode: "INHOUSE", attachRunId: runId }],
        autoCreateRun: false,
        notes: null,
      },
      OCC_NOW,
    );
    const slot = (await communityScheduleRepository.findById(added.slotIds[0]!))!;
    expect(slot).toMatchObject({ runTemplateId: templateA, raidLeadId: ids.lead });
    expect((await communityScheduleRunRepository.findByRunId(runId))?.origin).toBe("ATTACHED");
    expect((await testTemplates()).map((row) => row.id)).toEqual([templateA]);
    expect(await runSnapshot(runId)).toEqual(before);
  });
});

describe("Use existing Run on an existing Schedule", () => {
  async function scheduleWithOtherSetup() {
    const other = await runTemplateRepository.create({
      name: "CSA Existing Setup",
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
      {
        raidLeadId: ids.otherLead,
        runSetup: { mode: "existing", templateId: other },
        slots: [{ weekday: "FRIDAY", localStartTime: "21:00", runMode: "INHOUSE" }],
        autoCreateRun: false,
        notes: null,
      },
      OCC_NOW,
    );
    return { other, slotId: plan.slotIds[0]! };
  }

  it("attaches only by default — Setup, Raid Lead and time stay", async () => {
    const { other, slotId } = await scheduleWithOtherSetup();
    const runId = await manualRun({ scheduledStartAt: NEXT_FRIDAY_2000, bosses: 5, composition: [3, 3, 12, 2] });
    await communityScheduleOccurrenceService.attachExistingRun(admin, { scheduleSlotId: slotId, runId, now: OCC_NOW });
    const slot = (await communityScheduleRepository.findById(slotId))!;
    expect(slot).toMatchObject({ runTemplateId: other, raidLeadId: ids.otherLead, localStartTime: "21:00" });
    expect(await testTemplates()).toHaveLength(1);
  });

  it("explicit 'use this Run's setup' switches only the Run Setup; the Run stays unchanged", async () => {
    const { other, slotId } = await scheduleWithOtherSetup();
    const runId = await manualRun({ scheduledStartAt: NEXT_FRIDAY_2000, bosses: 5, composition: [3, 3, 12, 2] });
    const before = await runSnapshot(runId);
    await communityScheduleOccurrenceService.attachExistingRun(admin, {
      scheduleSlotId: slotId,
      runId,
      adoptSetup: true,
      now: OCC_NOW,
    });
    const slot = (await communityScheduleRepository.findById(slotId))!;
    expect(slot.runTemplateId).not.toBe(other);
    expect(slot).toMatchObject({ raidLeadId: ids.otherLead, localStartTime: "21:00", weekday: "FRIDAY" });
    const adopted = (await runTemplateRepository.findById(slot.runTemplateId!))!;
    expect(adopted.contents.map((row) => row.plannedBossCount)).toEqual([5]);
    expect(await runSnapshot(runId)).toEqual(before);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
