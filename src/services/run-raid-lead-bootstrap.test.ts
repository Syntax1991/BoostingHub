import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { db, orm } from "@/lib/prisma";
import { seededProductSelection, venomousCreateInput } from "@/lib/test-run-input";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import type { CharacterRole, WowClass } from "@/models/enums";
import { communityScheduleRepository } from "@/repositories/community-schedule.repository";
import { insertInitialBoosterSignupsInTx } from "@/repositories/run.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { runTemplateRepository } from "@/repositories/run-template.repository";
import { communityScheduleMaterializationService } from "@/services/community-schedule-materialization.service";
import { communityScheduleOccurrenceService } from "@/services/community-schedule-occurrence.service";
import { planRaidLeadBoosterSignups } from "@/services/run-raid-lead-bootstrap.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import { freezeSystemTime, restoreSystemTime, SCHEDULE_TEST_CLOCK } from "@/test/time";

/**
 * A NEW concrete Run starts with PENDING Booster signups for every eligible
 * Character of its Raid Lead (Run.raidLeadId) — never the creator's — across
 * manual, mass / Run Setup and Schedule creation; attaching an existing Run or
 * changing the Raid Lead later adds nothing.
 */

const ids = {
  lead: "b0075000-0000-4000-8000-000000000001",
  admin: "b0075000-0000-4000-8000-000000000002",
  other: "b0075000-0000-4000-8000-000000000003",
  lead2: "b0075000-0000-4000-8000-000000000004",
  plainLead: "b0075000-0000-4000-8000-000000000005",
};

function actor(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]): AuthenticatedUser {
  return { id, name, email: `${id}@boot.local`, image: null, discordUserId: null, discordUsername: null, accountRole, accountStatus: "ACTIVE" };
}
const lead = actor(ids.lead, "Nyxara", "RAID_LEAD");
const admin = actor(ids.admin, "Boot Admin", "ADMIN");
const lead2 = actor(ids.lead2, "Boot Lead Two", "RAID_LEAD");
const plainLead = actor(ids.plainLead, "Boot Plain Lead", "RAID_LEAD");

const chars: Record<string, string> = {};
const createdRunIds: string[] = [];
let templateId = "";

async function character(key: string, userId: string, wowClass: WowClass, specialization: string, primaryRole: CharacterRole, opts: { active?: boolean; playable?: string[] } = {}) {
  const id = crypto.randomUUID();
  chars[key] = id;
  const now = new Date().toISOString();
  await orm.Character.create({
    id,
    userId,
    name: `Boot${key}`,
    realm: "Bootstrap",
    normalizedName: normalizeCharacterIdentity(`Boot${key}`),
    normalizedRealm: normalizeCharacterIdentity("Bootstrap"),
    region: "EU",
    wowClass,
    specialization,
    primaryRole,
    itemLevel: 700,
    isActive: opts.active ?? true,
    createdAt: now,
    updatedAt: now,
  });
  for (const spec of opts.playable ?? []) {
    await orm.CharacterPlayableSpec.create({ id: crypto.randomUUID(), characterId: id, specialization: spec, createdAt: now });
  }
}

async function signupsOf(runId: string) {
  const rows = (await orm.RunSignup.where({ runId }).all()) as Array<{
    id: string;
    userId: string;
    characterId: string | null;
    participationType: string;
    status: string;
    isBackup: boolean;
    publishedRole: string | null;
  }>;
  const out = [];
  for (const row of rows) {
    const roles = ((await orm.RunSignupRole.where({ signupId: row.id }).all()) as Array<{ role: string }>).map((r) => r.role).sort();
    out.push({ ...row, roles });
  }
  return out;
}

async function cleanup() {
  const runIds = new Set(createdRunIds.splice(0));
  for (const userId of Object.values(ids)) {
    for (const row of (await orm.Run.where({ raidLeadId: userId }).select("id").all()) as Array<{ id: string }>) runIds.add(row.id);
  }
  for (const runId of runIds) {
    await orm.CommunityScheduleRun.where({ runId }).delete().catch(() => {});
    await orm.Run.where({ id: runId }).delete().catch(() => {});
  }
  for (const userId of Object.values(ids)) {
    await orm.CommunityScheduleSlot.where({ raidLeadId: userId }).delete().catch(() => {});
  }
  if (templateId) await orm.RunTemplate.where({ id: templateId }).delete().catch(() => {});
  for (const userId of Object.values(ids)) {
    await orm.Character.where({ userId }).delete().catch(() => {});
    await orm.ActivityEvent.where({ userId }).delete().catch(() => {});
    await orm.User.where({ id: userId }).delete().catch(() => {});
  }
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanup();
  const now = new Date().toISOString();
  for (const [u, isBooster] of [[lead, true], [admin, true], [actor(ids.other, "Boot Other", "USER"), true], [lead2, true], [plainLead, false]] as const) {
    await orm.User.create({
      id: u.id, name: u.name, email: u.email, emailVerified: true, accountRole: u.accountRole, accountStatus: "ACTIVE",
      isBooster, discordRunChannelNickname: u.id === ids.lead ? "Alantra" : null, createdAt: now, updatedAt: now,
    });
  }
  await character("LeadTank", ids.lead, "PALADIN", "Protection", "TANK", { playable: ["Retribution"] });
  await character("LeadHeal", ids.lead, "PRIEST", "Holy", "HEALER", { playable: ["Shadow"] });
  await character("LeadDps", ids.lead, "HUNTER", "Beast Mastery", "RANGED_DPS");
  await character("LeadRetired", ids.lead, "MAGE", "Frost", "RANGED_DPS", { active: false });
  await character("AdminChar", ids.admin, "ROGUE", "Assassination", "MELEE_DPS");
  await character("OtherChar", ids.other, "WARRIOR", "Arms", "MELEE_DPS");
  await character("Lead2Char", ids.lead2, "DRUID", "Restoration", "HEALER");
  await character("PlainChar", ids.plainLead, "SHAMAN", "Restoration", "HEALER");
  templateId = await runTemplateRepository.create({
    name: "Bootstrap Setup", difficulty: "HEROIC", lootType: "UNSAVED",
    contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 }],
    desiredTankCount: 2, desiredHealerCount: 4, desiredDpsCount: 14, notes: null, createdById: ids.admin, updatedById: ids.admin,
  });
});

afterAll(cleanup);
beforeEach(() => freezeSystemTime(SCHEDULE_TEST_CLOCK, { advance: true }));
afterEach(() => restoreSystemTime());

const leadChars = () => [chars.LeadTank, chars.LeadHeal, chars.LeadDps].sort();

describe("Raid Lead Character bootstrap on Run creation", () => {
  it("manual Run by an Admin for another Raid Lead: exactly the Raid Lead's active Characters, PENDING Booster, nothing selected or notified", async () => {
    const run = await runService.createRun(admin, venomousCreateInput({ raidLeadId: ids.lead }));
    createdRunIds.push(run.id);

    const rows = await signupsOf(run.id);
    expect(rows.map((row) => row.characterId).sort()).toEqual(leadChars());
    for (const row of rows) {
      expect(row).toMatchObject({ userId: ids.lead, participationType: "BOOSTER", status: "PENDING", isBackup: false, publishedRole: null });
    }
    // Retired Character, the creator's and another User's Characters: none.
    expect(rows.some((row) => row.characterId === chars.LeadRetired)).toBe(false);
    expect(rows.some((row) => row.userId === ids.admin || row.userId === ids.other)).toBe(false);

    // Nothing selected / rostered; no notification rows, no signup audit events.
    const roster = (await orm.RunRoster.where({ runId: run.id }).first()) as { id: string };
    expect(await orm.RunRosterEntry.where({ rosterId: roster.id }).all()).toHaveLength(0);
    expect(await orm.UserNotification.where({ runId: run.id }).all()).toHaveLength(0);
    const events = (await orm.RunDomainEvent.where({ runId: run.id }).all()) as Array<{ type: string }>;
    expect(events.map((event) => event.type)).toEqual(["RUN_CREATED"]);

    // Title uses the Raid Lead nickname.
    expect((await orm.Run.where({ id: run.id }).first() as { title: string }).title.endsWith(" Alantra")).toBe(true);
  });

  it("offers exactly the roles a normal signup of that Character could offer (offspecs included)", async () => {
    const run = await runService.createRun(lead, venomousCreateInput());
    createdRunIds.push(run.id);
    await runService.openRun(lead, run.id);
    const normal = (await signupService.getSignupOptions(lead, run.id)).booster.eligible;
    const rows = await signupsOf(run.id);
    for (const option of normal) {
      expect(rows.find((row) => row.characterId === option.characterId)?.roles).toEqual([...option.roles].sort());
    }
    expect(rows.find((row) => row.characterId === chars.LeadTank)?.roles).toEqual(["MELEE_DPS", "TANK"]);
    expect(rows.find((row) => row.characterId === chars.LeadHeal)?.roles).toEqual(["HEALER", "RANGED_DPS"]);
    expect(rows.find((row) => row.characterId === chars.LeadDps)?.roles).toEqual(["RANGED_DPS"]);
  });

  it("repeated bootstrap creates no duplicates", async () => {
    const run = await runService.createRun(lead, venomousCreateInput());
    createdRunIds.push(run.id);
    const plan = await planRaidLeadBoosterSignups({
      raidLeadId: ids.lead, difficulty: "HEROIC", lootType: "UNSAVED", scheduledStartAt: new Date(Date.now() + 9 * 864e5).toISOString(),
      contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 }],
    });
    expect(plan).toHaveLength(3);
    const inserted = await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: typeof orm }).public ?? (tx.orm as unknown as typeof orm)) as typeof orm;
      return insertInitialBoosterSignupsInTx(txOrm, run.id, plan, new Date().toISOString());
    });
    expect(inserted).toBe(0);
    expect(await signupsOf(run.id)).toHaveLength(3);
  });

  it("mass create / Run Setup rows each start with the final Raid Lead's Characters", async () => {
    const { ids: runIds } = await runService.createManyRuns(admin, {
      defaults: {
        ...seededProductSelection("VENOMOUS_ABYSS", 8), difficulty: "HEROIC", lootType: "UNSAVED", raidLeadId: ids.lead,
        notes: null, desiredTankCount: 2, desiredHealerCount: 4, desiredDpsCount: 14,
      },
      runs: [
        { scheduledStartAt: new Date(Date.now() + 10 * 864e5).toISOString() },
        { scheduledStartAt: new Date(Date.now() + 11 * 864e5).toISOString(), overrides: { raidLeadId: ids.lead2 } },
      ],
    } as never);
    createdRunIds.push(...runIds);
    expect((await signupsOf(runIds[0]!)).map((row) => row.characterId).sort()).toEqual(leadChars());
    expect((await signupsOf(runIds[1]!)).map((row) => row.characterId)).toEqual([chars.Lead2Char]);
  });

  it("Schedule materialization signs up the slot Raid Lead's Characters; attaching an existing Run adds none", async () => {
    const slot = await communityScheduleRepository.create({
      weekday: "FRIDAY", localStartTime: "19:45", label: "Bootstrap", notes: null, raidLeadId: ids.lead,
      runTemplateId: templateId, autoCreateRun: false, runMode: "INHOUSE", createdById: ids.admin, updatedById: ids.admin,
    });
    const materialized = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "SYSTEM" },
      { scheduleSlotId: slot.id, window: "NEXT", now: new Date("2027-01-15T12:00:00.000Z") },
    );
    createdRunIds.push(materialized.runId);
    expect((await signupsOf(materialized.runId)).map((row) => row.characterId).sort()).toEqual(leadChars());

    // Existing Run (Raid Lead lead2) attached to a lead2 slot: its signups stay exactly as they were.
    const existing = await runService.createRun(admin, venomousCreateInput({ raidLeadId: ids.lead2, scheduledStartAt: "2027-01-29T18:45:00.000Z" }));
    createdRunIds.push(existing.id);
    const before = await signupsOf(existing.id);
    const slot2 = await communityScheduleRepository.create({
      weekday: "FRIDAY", localStartTime: "19:45", label: "Bootstrap attach", notes: null, raidLeadId: ids.lead2,
      runTemplateId: templateId, autoCreateRun: false, runMode: "INHOUSE", createdById: ids.admin, updatedById: ids.admin,
    });
    await communityScheduleOccurrenceService.attachExistingRun(admin, {
      scheduleSlotId: slot2.id, runId: existing.id, now: new Date("2027-01-22T12:00:00.000Z"),
    });
    expect(await signupsOf(existing.id)).toEqual(before);
  });

  it("changing the Raid Lead later rewrites no signups", async () => {
    const run = await runService.createRun(admin, venomousCreateInput({ raidLeadId: ids.lead }));
    createdRunIds.push(run.id);
    const before = await signupsOf(run.id);
    const current = (await orm.Run.where({ id: run.id }).first()) as { scheduledStartAt: string };
    await runService.updateRun(admin, {
      runId: run.id, raidLeadId: ids.lead2, difficulty: "HEROIC", lootType: "UNSAVED", scheduledStartAt: current.scheduledStartAt,
      desiredTankCount: 2, desiredHealerCount: 4, desiredDpsCount: 14, notes: null, ...seededProductSelection("VENOMOUS_ABYSS", 8),
    });
    expect((await orm.Run.where({ id: run.id }).first() as { raidLeadId: string }).raidLeadId).toBe(ids.lead2);
    expect(await signupsOf(run.id)).toEqual(before);
  });

  it("a Raid Lead without the Booster role gets no Booster signups (booster invariant)", async () => {
    const run = await runService.createRun(plainLead, venomousCreateInput());
    createdRunIds.push(run.id);
    expect(await signupsOf(run.id)).toHaveLength(0);
  });
});
