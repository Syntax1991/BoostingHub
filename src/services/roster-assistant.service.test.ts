import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import type { AccountRole, CharacterRole, RaidDifficulty, WowClass } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { characterWeeklyAvailabilityService } from "@/services/character-weekly-availability.service";
import { lockoutService } from "@/services/lockout.service";
import { rosterAssistantService } from "@/services/roster-assistant.service";

const ids = {
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-ra0000000001",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-ra0000000002",
  boosterA: "aaaaaaaa-aaaa-4aaa-8aaa-ra0000000003",
  boosterB: "aaaaaaaa-aaaa-4aaa-8aaa-ra0000000004",
  nonBooster: "aaaaaaaa-aaaa-4aaa-8aaa-ra0000000005",
  inactiveUser: "aaaaaaaa-aaaa-4aaa-8aaa-ra0000000006",
  run: "aaaaaaaa-aaaa-4aaa-8aaa-rar000000001",
  otherRun: "aaaaaaaa-aaaa-4aaa-8aaa-rar000000002",
  charHealer: "aaaaaaaa-aaaa-4aaa-8aaa-rac000000001",
  charMelee: "aaaaaaaa-aaaa-4aaa-8aaa-rac000000002",
  charRanged: "aaaaaaaa-aaaa-4aaa-8aaa-rac000000003",
  charInactive: "aaaaaaaa-aaaa-4aaa-8aaa-rac000000004",
  charNonBooster: "aaaaaaaa-aaaa-4aaa-8aaa-rac000000005",
  charInactiveOwner: "aaaaaaaa-aaaa-4aaa-8aaa-rac000000006",
};

function asUser(id: string, name: string, accountRole: AccountRole): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@ra.boostting.local`,
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
  extras: { isBooster?: boolean; accountStatus?: "ACTIVE" | "DISABLED" } = {},
) {
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name,
    email: `${id}@ra.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: extras.accountStatus ?? "ACTIVE",
    isBooster: extras.isBooster ?? false,
    isLootbuddy: false,
    createdAt: now,
    updatedAt: now,
  });
}

async function createCharacter(input: {
  id: string;
  userId: string;
  name: string;
  wowClass: WowClass;
  specialization: string;
  primaryRole: CharacterRole;
  isActive?: boolean;
  itemLevel?: number;
}) {
  const now = new Date().toISOString();
  await orm.Character.create({
    id: input.id,
    userId: input.userId,
    name: input.name,
    realm: "Blackrock",
    region: "EU",
    normalizedName: input.name.toLowerCase(),
    normalizedRealm: "blackrock",
    wowClass: input.wowClass,
    specialization: input.specialization,
    primaryRole: input.primaryRole,
    itemLevel: input.itemLevel ?? 330,
    isActive: input.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  });
}

async function createRun(input: {
  id?: string;
  desiredTankCount?: number;
  desiredHealerCount?: number;
  desiredDpsCount?: number;
  desiredLootbuddyCount?: number;
  difficulty?: RaidDifficulty;
  status?: "DRAFT" | "OPEN" | "ROSTERING" | "PUBLISHED";
  scheduledStartAt?: string;
}) {
  const now = new Date().toISOString();
  const runId = input.id ?? ids.run;
  await orm.Run.create({
    id: runId,
    title: runId === ids.run ? "RA Test Run" : "RA Other Run",
    difficulty: input.difficulty ?? "HEROIC",
    lootType: "UNSAVED",
    scheduledStartAt:
      input.scheduledStartAt ?? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    status: input.status ?? "DRAFT",
    signupsOpen: false,
    desiredTankCount: input.desiredTankCount ?? 0,
    desiredHealerCount: input.desiredHealerCount ?? 1,
    desiredDpsCount: input.desiredDpsCount ?? 2,
    desiredLootbuddyCount: input.desiredLootbuddyCount ?? 0,
    raidLeadId: ids.lead,
    notes: null,
    createdAt: now,
    updatedAt: now,
  });
  await orm.RunRaidContent.create({
    id: crypto.randomUUID(),
    runId,
    raidId: VENOMOUS_ABYSS_RAID_ID,
    sortOrder: 1,
    plannedBossCount: 8,
    createdAt: now,
  });
}

async function cleanup() {
  for (const runId of [ids.run, ids.otherRun]) {
    const roster = (await orm.RunRoster.where({ runId }).first()) as { id: string } | null;
    if (roster) {
      await orm.RunRosterEntry.where({ rosterId: roster.id }).delete().catch(() => {});
      await orm.RunRoster.where({ id: roster.id }).delete().catch(() => {});
    }
    const signups = (await orm.RunSignup.where({ runId }).all()) as Array<{ id: string }>;
    for (const signup of signups) {
      await orm.RunSignupRole.where({ signupId: signup.id }).delete().catch(() => {});
      await orm.RunSignup.where({ id: signup.id }).delete().catch(() => {});
    }
    await orm.RunRaidContent.where({ runId }).delete().catch(() => {});
    await orm.Run.where({ id: runId }).delete().catch(() => {});
  }
  for (const characterId of [
    ids.charHealer,
    ids.charMelee,
    ids.charRanged,
    ids.charInactive,
    ids.charNonBooster,
    ids.charInactiveOwner,
  ]) {
    await orm.CharacterWeeklyUnavailability.where({ characterId }).delete().catch(() => {});
    await orm.Character.where({ id: characterId }).delete().catch(() => {});
  }
  for (const id of [
    ids.admin,
    ids.lead,
    ids.boosterA,
    ids.boosterB,
    ids.nonBooster,
    ids.inactiveUser,
  ]) {
    await orm.User.where({ id }).delete().catch(() => {});
  }
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
  await createUser(ids.admin, "RA Admin", "ADMIN");
  await createUser(ids.lead, "RA Lead", "RAID_LEAD", { isBooster: true });
  await createUser(ids.boosterA, "RA Booster A", "USER", { isBooster: true });
  await createUser(ids.boosterB, "RA Booster B", "USER", { isBooster: true });
  await createUser(ids.nonBooster, "RA Non Booster", "USER", { isBooster: false });
  await createUser(ids.inactiveUser, "RA Inactive", "USER", {
    isBooster: true,
    accountStatus: "DISABLED",
  });
  await createCharacter({
    id: ids.charHealer,
    userId: ids.boosterA,
    name: "Synlight",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
    itemLevel: 334,
  });
  await createCharacter({
    id: ids.charMelee,
    userId: ids.boosterB,
    name: "Synblade",
    wowClass: "WARRIOR",
    specialization: "Arms",
    primaryRole: "MELEE_DPS",
    itemLevel: 333,
  });
  await createCharacter({
    id: ids.charRanged,
    userId: ids.lead,
    name: "Synvoid",
    wowClass: "PRIEST",
    specialization: "Shadow",
    primaryRole: "RANGED_DPS",
    itemLevel: 330,
  });
  await createCharacter({
    id: ids.charInactive,
    userId: ids.boosterA,
    name: "Retired",
    wowClass: "MONK",
    specialization: "Mistweaver",
    primaryRole: "HEALER",
    isActive: false,
  });
  await createCharacter({
    id: ids.charNonBooster,
    userId: ids.nonBooster,
    name: "NoBoost",
    wowClass: "MAGE",
    specialization: "Fire",
    primaryRole: "RANGED_DPS",
  });
  await createCharacter({
    id: ids.charInactiveOwner,
    userId: ids.inactiveUser,
    name: "DeadOwner",
    wowClass: "MAGE",
    specialization: "Fire",
    primaryRole: "RANGED_DPS",
  });
  await createRun({});
});

afterAll(async () => {
  await cleanup();
});

describe("rosterAssistantService.getRosterAssistant", () => {
  const admin = asUser(ids.admin, "RA Admin", "ADMIN");
  const lead = asUser(ids.lead, "RA Lead", "RAID_LEAD");

  it("recommends eligible healers and both Melee + Ranged for aggregate DPS shortage", async () => {
    const result = await rosterAssistantService.getRosterAssistant(admin, ids.run);
    expect(result.fullyStaffed).toBe(false);
    expect(result.shortages).toMatchObject({ healers: 1, dps: 2 });
    expect(result.candidates.healers.map((row) => row.characterId)).toContain(ids.charHealer);
    expect(result.candidates.healers.map((row) => row.characterId)).not.toContain(ids.charInactive);
    const dpsIds = result.candidates.dps.map((row) => row.characterId);
    expect(dpsIds).toContain(ids.charMelee);
    expect(dpsIds).toContain(ids.charRanged);
    expect(dpsIds).not.toContain(ids.charNonBooster);
    expect(dpsIds).not.toContain(ids.charInactiveOwner);
    const ours = result.candidates.dps.filter((row) =>
      [ids.charMelee, ids.charRanged].includes(row.characterId),
    );
    expect(ours.every((row) => row.concreteRole === "MELEE_DPS" || row.concreteRole === "RANGED_DPS")).toBe(
      true,
    );
  });

  it("excludes non-boosters from the candidate pool and ranks by item level then name", async () => {
    const result = await rosterAssistantService.getRosterAssistant(admin, ids.run);
    const ours = result.candidates.dps.filter((row) =>
      [ids.charMelee, ids.charRanged].includes(row.characterId),
    );
    expect(ours[0]?.characterId).toBe(ids.charMelee);
    expect(ours[1]?.characterId).toBe(ids.charRanged);
    const allIds = [
      ...result.candidates.tanks.map((row) => row.characterId),
      ...result.candidates.healers.map((row) => row.characterId),
      ...result.candidates.dps.map((row) => row.characterId),
      ...result.excluded.map((row) => row.characterId),
    ];
    expect(allIds).not.toContain(ids.charNonBooster);
    expect(allIds).not.toContain(ids.charInactiveOwner);
  });

  it("excludes Characters marked weekly unavailable for the Run difficulty", async () => {
    const run = (await orm.Run.where({ id: ids.run }).first()) as {
      scheduledStartAt: string;
    };
    const resetIdentifier = lockoutService.getResetIdentifierForRun("EU", run.scheduledStartAt);
    await orm.CharacterWeeklyUnavailability.create({
      id: crypto.randomUUID(),
      characterId: ids.charHealer,
      resetIdentifier,
      difficulty: "HEROIC",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = await rosterAssistantService.getRosterAssistant(admin, ids.run);
    expect(result.candidates.healers.map((row) => row.characterId)).not.toContain(ids.charHealer);
    expect(
      result.excluded.some(
        (row) => row.characterId === ids.charHealer && row.reason === "CHARACTER_UNAVAILABLE",
      ),
    ).toBe(true);
  });

  it("still recommends HC when Character is unavailable for Normal only", async () => {
    const run = (await orm.Run.where({ id: ids.run }).first()) as {
      scheduledStartAt: string;
    };
    const resetIdentifier = lockoutService.getResetIdentifierForRun("EU", run.scheduledStartAt);
    await orm.CharacterWeeklyUnavailability.create({
      id: crypto.randomUUID(),
      characterId: ids.charHealer,
      resetIdentifier,
      difficulty: "NORMAL",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = await rosterAssistantService.getRosterAssistant(admin, ids.run);
    expect(result.candidates.healers.map((row) => row.characterId)).toContain(ids.charHealer);
  });

  it("excludes Characters reserved on an overlapping Run", async () => {
    const run = (await orm.Run.where({ id: ids.run }).first()) as {
      scheduledStartAt: string;
    };
    await createRun({
      id: ids.otherRun,
      status: "PUBLISHED",
      scheduledStartAt: run.scheduledStartAt,
      desiredHealerCount: 1,
      desiredDpsCount: 0,
    });
    const now = new Date().toISOString();
    const signupId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: signupId,
      runId: ids.otherRun,
      userId: ids.boosterA,
      characterId: ids.charHealer,
      participationType: "BOOSTER",
      isBackup: false,
      status: "SELECTED",
      publishedRole: "HEALER",
      createdAt: now,
      updatedAt: now,
    });
    await orm.RunSignupRole.create({
      id: crypto.randomUUID(),
      signupId,
      role: "HEALER",
      createdAt: now,
    });
    const result = await rosterAssistantService.getRosterAssistant(admin, ids.run);
    expect(result.candidates.healers.map((row) => row.characterId)).not.toContain(ids.charHealer);
    expect(
      result.excluded.some(
        (row) => row.characterId === ids.charHealer && row.reason === "ALREADY_SELECTED_OTHER_RUN",
      ),
    ).toBe(true);
  });

  it("excludes Characters already selected on this Run", async () => {
    const now = new Date().toISOString();
    const signupId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: signupId,
      runId: ids.run,
      userId: ids.boosterA,
      characterId: ids.charHealer,
      participationType: "BOOSTER",
      isBackup: false,
      status: "PENDING",
      publishedRole: null,
      createdAt: now,
      updatedAt: now,
    });
    await orm.RunSignupRole.create({
      id: crypto.randomUUID(),
      signupId,
      role: "HEALER",
      createdAt: now,
    });
    const rosterId = crypto.randomUUID();
    await orm.RunRoster.create({
      id: rosterId,
      runId: ids.run,
      state: "DRAFT",
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await orm.RunRosterEntry.create({
      id: crypto.randomUUID(),
      rosterId,
      signupId,
      selected: true,
      selectedRole: "HEALER",
      createdAt: now,
      updatedAt: now,
    });
    const result = await rosterAssistantService.getRosterAssistant(admin, ids.run);
    expect(result.candidates.healers.map((row) => row.characterId)).not.toContain(ids.charHealer);
  });

  it("batches reservation and availability queries (no per-character N+1)", async () => {
    const reservationSpy = vi.spyOn(signupRepository, "findReservationConflicts");
    const availabilitySpy = vi.spyOn(characterWeeklyAvailabilityService, "listUnavailableForRun");
    await rosterAssistantService.getRosterAssistant(admin, ids.run);
    expect(reservationSpy).toHaveBeenCalledTimes(1);
    expect(availabilitySpy).toHaveBeenCalledTimes(1);
    reservationSpy.mockRestore();
    availabilitySpy.mockRestore();
  });

  it("returns empty recommendations when fully staffed", async () => {
    await orm.Run.where({ id: ids.run }).update({
      desiredTankCount: 0,
      desiredHealerCount: 0,
      desiredDpsCount: 0,
      desiredLootbuddyCount: 0,
      updatedAt: new Date().toISOString(),
    });
    const result = await rosterAssistantService.getRosterAssistant(admin, ids.run);
    expect(result.fullyStaffed).toBe(true);
    expect(result.candidates.tanks).toEqual([]);
    expect(result.candidates.healers).toEqual([]);
    expect(result.candidates.dps).toEqual([]);
  });

  it("allows RAID_LEAD for own Run and blocks USER", async () => {
    await expect(rosterAssistantService.getRosterAssistant(lead, ids.run)).resolves.toMatchObject({
      run: { id: ids.run },
    });
    const user = asUser(ids.nonBooster, "RA Non Booster", "USER");
    await expect(rosterAssistantService.getRosterAssistant(user, ids.run)).rejects.toMatchObject({
      code: "RUN_NOT_MANAGEABLE",
    });
  });

  it("uses Run snapshot desired composition (not live template edits)", async () => {
    await orm.Run.where({ id: ids.run }).update({
      desiredHealerCount: 2,
      desiredDpsCount: 1,
      updatedAt: new Date().toISOString(),
    });
    const result = await rosterAssistantService.getRosterAssistant(admin, ids.run);
    expect(result.shortages.healers).toBe(2);
    expect(result.shortages.dps).toBe(1);
    expect(result.staffing.desired).toMatchObject({ healers: 2, dps: 1 });
  });
});
