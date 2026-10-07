import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import type { AccountRole, CharacterRole, WowClass } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { rosterBuilderService } from "@/services/roster-builder.service";

const ids = {
  admin: "bbbbbbbb-bbbb-4bbb-8bbb-rb0000000001",
  lead: "bbbbbbbb-bbbb-4bbb-8bbb-rb0000000002",
  boosterA: "bbbbbbbb-bbbb-4bbb-8bbb-rb0000000003",
  boosterB: "bbbbbbbb-bbbb-4bbb-8bbb-rb0000000004",
  user: "bbbbbbbb-bbbb-4bbb-8bbb-rb0000000005",
  run: "bbbbbbbb-bbbb-4bbb-8bbb-rbr000000001",
  charHealer: "bbbbbbbb-bbbb-4bbb-8bbb-rbc000000001",
  charMelee: "bbbbbbbb-bbbb-4bbb-8bbb-rbc000000002",
  charRanged: "bbbbbbbb-bbbb-4bbb-8bbb-rbc000000003",
  signupHealer: "bbbbbbbb-bbbb-4bbb-8bbb-rbs000000001",
  signupMelee: "bbbbbbbb-bbbb-4bbb-8bbb-rbs000000002",
  signupRanged: "bbbbbbbb-bbbb-4bbb-8bbb-rbs000000003",
};

function asUser(id: string, name: string, accountRole: AccountRole): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@rb.boostting.local`,
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
  extras: { isBooster?: boolean } = {},
) {
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name,
    email: `${id}@rb.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
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
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function createSignup(input: {
  id: string;
  userId: string;
  characterId: string;
  roles: CharacterRole[];
}) {
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id: input.id,
    runId: ids.run,
    userId: input.userId,
    characterId: input.characterId,
    participationType: "BOOSTER",
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    createdAt: now,
    updatedAt: now,
  });
  for (const role of input.roles) {
    await orm.RunSignupRole.create({
      id: crypto.randomUUID(),
      signupId: input.id,
      role,
      createdAt: now,
    });
  }
}

async function cleanup() {
  const roster = (await orm.RunRoster.where({ runId: ids.run }).first()) as { id: string } | null;
  if (roster) {
    await orm.RunRosterEntry.where({ rosterId: roster.id }).delete().catch(() => {});
    await orm.RunRoster.where({ id: roster.id }).delete().catch(() => {});
  }
  for (const signupId of [ids.signupHealer, ids.signupMelee, ids.signupRanged]) {
    await orm.RunSignupRole.where({ signupId }).delete().catch(() => {});
    await orm.RunSignup.where({ id: signupId }).delete().catch(() => {});
  }
  await orm.RunRaidContent.where({ runId: ids.run }).delete().catch(() => {});
  await orm.Run.where({ id: ids.run }).delete().catch(() => {});
  for (const id of [ids.charHealer, ids.charMelee, ids.charRanged]) {
    await orm.Character.where({ id }).delete().catch(() => {});
  }
  for (const id of [ids.admin, ids.lead, ids.boosterA, ids.boosterB, ids.user]) {
    await orm.User.where({ id }).delete().catch(() => {});
  }
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
  const now = new Date().toISOString();
  await createUser(ids.admin, "RB Admin", "ADMIN");
  await createUser(ids.lead, "RB Lead", "RAID_LEAD", { isBooster: true });
  await createUser(ids.boosterA, "RB Booster A", "USER", { isBooster: true });
  await createUser(ids.boosterB, "RB Booster B", "USER", { isBooster: true });
  await createUser(ids.user, "RB User", "USER", { isBooster: false });
  await createCharacter({
    id: ids.charHealer,
    userId: ids.boosterA,
    name: "RbHealer",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
    itemLevel: 334,
  });
  await createCharacter({
    id: ids.charMelee,
    userId: ids.boosterB,
    name: "RbMelee",
    wowClass: "WARRIOR",
    specialization: "Arms",
    primaryRole: "MELEE_DPS",
    itemLevel: 333,
  });
  await createCharacter({
    id: ids.charRanged,
    userId: ids.lead,
    name: "RbRanged",
    wowClass: "MAGE",
    specialization: "Fire",
    primaryRole: "RANGED_DPS",
    itemLevel: 331,
  });
  await orm.Run.create({
    id: ids.run,
    title: "RB Test Run",
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    scheduledStartAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    status: "OPEN",
    signupsOpen: true,
    desiredTankCount: 0,
    desiredHealerCount: 1,
    desiredDpsCount: 2,
    desiredLootbuddyCount: 0,
    raidLeadId: ids.lead,
    notes: null,
    createdAt: now,
    updatedAt: now,
  });
  await orm.RunRaidContent.create({
    id: crypto.randomUUID(),
    runId: ids.run,
    raidId: VENOMOUS_ABYSS_RAID_ID,
    sortOrder: 1,
    plannedBossCount: 8,
    createdAt: now,
  });
  await createSignup({
    id: ids.signupHealer,
    userId: ids.boosterA,
    characterId: ids.charHealer,
    roles: ["HEALER"],
  });
  await createSignup({
    id: ids.signupMelee,
    userId: ids.boosterB,
    characterId: ids.charMelee,
    roles: ["MELEE_DPS"],
  });
  await createSignup({
    id: ids.signupRanged,
    userId: ids.lead,
    characterId: ids.charRanged,
    roles: ["RANGED_DPS"],
  });
});

afterAll(async () => {
  await cleanup();
});

describe("rosterBuilderService", () => {
  const admin = asUser(ids.admin, "RB Admin", "ADMIN");
  const lead = asUser(ids.lead, "RB Lead", "RAID_LEAD");
  const plainUser = asUser(ids.user, "RB User", "USER");

  it("proposes only from Run signups and fills aggregate DPS", async () => {
    const result = await rosterBuilderService.proposeRoster(admin, ids.run);
    expect(result.fullyStaffed).toBe(false);
    expect(result.shortages).toMatchObject({ healers: 1, dps: 2 });
    const newIds = result.applySelections.map((row) => row.signupId).sort();
    expect(newIds).toEqual(
      [ids.signupHealer, ids.signupMelee, ids.signupRanged].sort(),
    );
    expect(result.applySelections.some((row) => row.selectedRole === "MELEE_DPS")).toBe(true);
    expect(result.applySelections.some((row) => row.selectedRole === "RANGED_DPS")).toBe(true);
  });

  it("keeps existing draft picks locked and only fills remaining", async () => {
    const roster = await rosterRepository.ensure(ids.run);
    await rosterRepository.replaceSelectedSignupIds(roster.id, roster.version, [
      { signupId: ids.signupHealer, selectedRole: "HEALER" },
    ]);
    const result = await rosterBuilderService.proposeRoster(admin, ids.run);
    expect(result.shortages.healers).toBe(0);
    expect(result.shortages.dps).toBe(2);
    expect(result.proposed.some((row) => row.signupId === ids.signupHealer && row.locked)).toBe(
      true,
    );
    expect(result.applySelections.map((row) => row.signupId).sort()).toEqual(
      [ids.signupMelee, ids.signupRanged].sort(),
    );
    expect(result.applySelections.some((row) => row.signupId === ids.signupHealer)).toBe(false);
  });

  it("applies proposal through saveDraftSelection and revalidates stale input", async () => {
    const proposal = await rosterBuilderService.proposeRoster(lead, ids.run);
    expect(proposal.applySelections.length).toBe(3);

    await rosterBuilderService.applyRosterProposal(lead, {
      runId: ids.run,
      expectedVersion: proposal.rosterVersion,
      selections: proposal.applySelections,
    });

    const roster = await rosterRepository.findByRunId(ids.run);
    expect(roster?.selectedSignupIds.sort()).toEqual(
      [ids.signupHealer, ids.signupMelee, ids.signupRanged].sort(),
    );

    await expect(
      rosterBuilderService.applyRosterProposal(lead, {
        runId: ids.run,
        expectedVersion: proposal.rosterVersion,
        selections: proposal.applySelections,
      }),
    ).rejects.toMatchObject({ code: "ROSTER_ALREADY_CHANGED" });
  });

  it("blocks USER from proposing", async () => {
    await expect(rosterBuilderService.proposeRoster(plainUser, ids.run)).rejects.toMatchObject({
      code: "RUN_NOT_MANAGEABLE",
    });
  });
});
