import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import type { AccountRole } from "@/models/enums";
import { userRepository } from "@/repositories/user.repository";
import { boostingRoleService, isApprovedBooster } from "@/services/boosting-role.service";
import { characterService } from "@/services/character.service";
import { signupService } from "@/services/signup.service";
import { userManagementService } from "@/services/user-management.service";

/**
 * Boosting Roles (User.isBooster / User.isLootbuddy): account-level operational
 * capabilities, independent of each other and of accountRole. Booster is never
 * scoped by raid difficulty.
 */
const ids = {
  target: "aaaaaaaa-aaaa-4aaa-8aaa-bb0000000001",
  adminTarget: "aaaaaaaa-aaaa-4aaa-8aaa-bb0000000002",
  ownerTarget: "aaaaaaaa-aaaa-4aaa-8aaa-bb0000000003",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-bb0000000004",
  admin: "44444444-4444-4444-8444-444444444444",
  heroicOpen: "r1111111-1111-4111-8111-111111111111",
  mythicOpen: "r2222222-2222-4222-8222-222222222222",
  normalOpen: "r4444444-4444-4444-8444-444444444444",
};
const TEST_USER_IDS = [ids.target, ids.adminTarget, ids.ownerTarget, ids.lead];
const RUNS = [ids.normalOpen, ids.heroicOpen, ids.mythicOpen];

function asUser(id: string, name: string, accountRole: AccountRole = "USER"): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@brtest.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");
const owner = asUser(ids.ownerTarget, "Roles Owner", "OWNER");
const lead = asUser(ids.lead, "Roles Lead", "RAID_LEAD");
const target = asUser(ids.target, "Roles Target");

async function expectDomainCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected domain error ${code}`);
  } catch (error) {
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

// OWNER is a single-row role (partial unique index); this suite only needs an
// OWNER-shaped actor, so the stored row stays ADMIN and the actor object carries OWNER.
async function createTestUser(id: string, name: string, accountRole: AccountRole) {
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name,
    email: `${id}@brtest.boostting.local`,
    emailVerified: true,
    accountRole: accountRole === "OWNER" ? "ADMIN" : accountRole,
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
}

async function cleanup() {
  for (const id of TEST_USER_IDS) {
    for (const row of await orm.RunSignup.where({ userId: id }).all()) {
      await orm.RunSignup.where({ id: String(row.id) }).delete().catch(() => {});
    }
    for (const row of await orm.Character.where({ userId: id }).all()) {
      await orm.Character.where({ id: String(row.id) }).delete().catch(() => {});
    }
    await orm.User.where({ id }).delete().catch(() => {});
  }
}

async function roles(userId: string) {
  return userRepository.findBoostingRoles(userId);
}

async function accountRoleOf(userId: string) {
  const row = await orm.User.where({ id: userId }).select("accountRole").first();
  return String((row as { accountRole?: string } | null)?.accountRole);
}

beforeAll(async () => {
  await cleanup();
  await createTestUser(ids.target, "Roles Target", "USER");
  await createTestUser(ids.adminTarget, "Roles Admin", "ADMIN");
  await createTestUser(ids.ownerTarget, "Roles Owner", "OWNER");
  await createTestUser(ids.lead, "Roles Lead", "RAID_LEAD");
});

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  for (const id of TEST_USER_IDS) {
    await orm.User.where({ id }).update({ isBooster: false, isLootbuddy: false });
  }
});

describe("Boosting Roles on User", () => {
  it("default to neither role", async () => {
    expect(await roles(ids.target)).toEqual({ isBooster: false, isLootbuddy: false });
  });

  it("isApprovedBooster reads only the Booster flag", () => {
    expect(isApprovedBooster({ isBooster: true })).toBe(true);
    expect(isApprovedBooster({ isBooster: false })).toBe(false);
    expect(isApprovedBooster(null)).toBe(false);
  });

  it("grants and revokes the Lootbuddy role", async () => {
    const granted = await boostingRoleService.setRole(admin, { userId: ids.target, role: "LOOTBUDDY", enabled: true });
    expect(granted).toMatchObject({ changed: true, roles: { isBooster: false, isLootbuddy: true } });
    expect(await roles(ids.target)).toEqual({ isBooster: false, isLootbuddy: true });

    const revoked = await boostingRoleService.setRole(admin, { userId: ids.target, role: "LOOTBUDDY", enabled: false });
    expect(revoked).toMatchObject({ changed: true, roles: { isLootbuddy: false } });
    expect(await roles(ids.target)).toEqual({ isBooster: false, isLootbuddy: false });
  });

  it("represents all four Booster / Lootbuddy combinations independently", async () => {
    const combos = [
      { isBooster: false, isLootbuddy: false },
      { isBooster: true, isLootbuddy: false },
      { isBooster: false, isLootbuddy: true },
      { isBooster: true, isLootbuddy: true },
    ];
    for (const combo of combos) {
      await boostingRoleService.setRole(admin, { userId: ids.target, role: "BOOSTER", enabled: combo.isBooster });
      await boostingRoleService.setRole(admin, { userId: ids.target, role: "LOOTBUDDY", enabled: combo.isLootbuddy });
      expect(await roles(ids.target)).toEqual(combo);
    }
    // Revoking one role never touches the other.
    await boostingRoleService.setRole(admin, { userId: ids.target, role: "BOOSTER", enabled: false });
    expect(await roles(ids.target)).toEqual({ isBooster: false, isLootbuddy: true });
  });

  it("never changes the account role", async () => {
    await boostingRoleService.setRole(admin, { userId: ids.adminTarget, role: "BOOSTER", enabled: true });
    await boostingRoleService.setRole(admin, { userId: ids.adminTarget, role: "LOOTBUDDY", enabled: true });
    expect(await roles(ids.adminTarget)).toEqual({ isBooster: true, isLootbuddy: true });
    expect(await accountRoleOf(ids.adminTarget)).toBe("ADMIN");

    await boostingRoleService.setRole(admin, { userId: ids.target, role: "BOOSTER", enabled: true });
    expect(await accountRoleOf(ids.target)).toBe("USER");
  });

  it("lets OWNER manage roles, including on an OWNER-level account with both roles", async () => {
    await boostingRoleService.setRole(owner, { userId: ids.ownerTarget, role: "BOOSTER", enabled: true });
    await boostingRoleService.setRole(owner, { userId: ids.ownerTarget, role: "LOOTBUDDY", enabled: true });
    expect(await roles(ids.ownerTarget)).toEqual({ isBooster: true, isLootbuddy: true });
  });

  it("is a no-op (no write, no audit event) when the role is already in that state", async () => {
    const before = await orm.ActivityEvent.where({ userId: ids.admin }).all();
    const result = await boostingRoleService.setRole(admin, { userId: ids.target, role: "BOOSTER", enabled: false });
    expect(result.changed).toBe(false);
    const after = await orm.ActivityEvent.where({ userId: ids.admin }).all();
    expect(after.length).toBe(before.length);
  });

  it("refuses USER and RAID_LEAD, and unknown users", async () => {
    await expectDomainCode(
      boostingRoleService.setRole(target, { userId: ids.target, role: "BOOSTER", enabled: true }),
      "NOT_AUTHORIZED",
    );
    await expectDomainCode(
      boostingRoleService.setRole(lead, { userId: ids.target, role: "LOOTBUDDY", enabled: true }),
      "NOT_AUTHORIZED",
    );
    await expectDomainCode(
      boostingRoleService.setRole(admin, {
        userId: "aaaaaaaa-aaaa-4aaa-8aaa-bbffffffffff",
        role: "BOOSTER",
        enabled: true,
      }),
      "USER_NOT_FOUND",
    );
    expect(await roles(ids.target)).toEqual({ isBooster: false, isLootbuddy: false });
  });

  it("records BOOSTER_* / LOOTBUDDY_* audit events on the target's user detail, without a difficulty", async () => {
    await boostingRoleService.setRole(admin, { userId: ids.target, role: "BOOSTER", enabled: true, reason: "Discord ticket 42" });
    await boostingRoleService.setRole(admin, { userId: ids.target, role: "BOOSTER", enabled: false });
    await boostingRoleService.setRole(admin, { userId: ids.target, role: "LOOTBUDDY", enabled: true });
    await boostingRoleService.setRole(admin, { userId: ids.target, role: "LOOTBUDDY", enabled: false });

    const detail = await userManagementService.getUserDetail(admin, ids.target);
    const types = detail.audit.map((event) => event.type);
    for (const type of ["BOOSTER_GRANTED", "BOOSTER_REVOKED", "LOOTBUDDY_GRANTED", "LOOTBUDDY_REVOKED"]) {
      expect(types).toContain(type);
    }
    const boosterEvents = detail.audit.filter((event) => event.type.startsWith("BOOSTER_"));
    expect(boosterEvents.some((event) => event.message.includes("Discord ticket 42"))).toBe(true);
    for (const event of boosterEvents) {
      expect(event.message).not.toMatch(/normal|heroic|mythic|difficulty/i);
    }
    expect(detail.boostingRoles).toEqual({ isBooster: false, isLootbuddy: false });
  });

  it("filters the admin user directory by Boosting Role", async () => {
    await boostingRoleService.setRole(admin, { userId: ids.target, role: "BOOSTER", enabled: true });
    await boostingRoleService.setRole(admin, { userId: ids.adminTarget, role: "LOOTBUDDY", enabled: true });

    const boosters = await userManagementService.listUsers(admin, { boostingRole: "BOOSTER" });
    expect(boosters.some((row) => row.id === ids.target)).toBe(true);
    expect(boosters.some((row) => row.id === ids.adminTarget)).toBe(false);

    const lootbuddies = await userManagementService.listUsers(admin, { boostingRole: "LOOTBUDDY" });
    expect(lootbuddies.some((row) => row.id === ids.adminTarget)).toBe(true);
    expect(lootbuddies.some((row) => row.id === ids.target)).toBe(false);

    const neither = await userManagementService.listUsers(admin, { boostingRole: "NONE" });
    expect(neither.some((row) => row.id === ids.lead)).toBe(true);
    expect(neither.some((row) => row.id === ids.target || row.id === ids.adminTarget)).toBe(false);
  });
});

describe("Booster eligibility follows User.isBooster on every difficulty", () => {
  let characterId: string;

  beforeAll(async () => {
    const character = await characterService.createCharacter(target, {
      name: "Rolesham",
      realm: "Area 52",
      region: "US",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 640,
    });
    characterId = character.id;
  });

  async function eligibleOn(runId: string) {
    const options = await signupService.getSignupOptions(target, runId);
    return {
      eligible: options.booster.eligible.some((item) => item.characterId === characterId),
      reason: options.booster.ineligible.find((item) => item.characterId === characterId)?.reason ?? null,
    };
  }

  it("a non-Booster is rejected on Normal, Heroic and Mythic with an account-level reason", async () => {
    for (const runId of RUNS) {
      expect(await eligibleOn(runId)).toEqual({ eligible: false, reason: "NO_BOOSTER_ACCESS" });
      await expectDomainCode(
        signupService.createBoosterSignup(target, { runId, characterId, role: "HEALER", isBackup: false }),
        "BOOSTER_ACCESS_REQUIRED",
      );
    }
  });

  it("granting the Booster role immediately unlocks Normal, Heroic and Mythic", async () => {
    await boostingRoleService.setRole(admin, { userId: ids.target, role: "BOOSTER", enabled: true });
    for (const runId of RUNS) {
      expect(await eligibleOn(runId)).toEqual({ eligible: true, reason: null });
    }
  });

  it("revoking the Booster role immediately fails the Booster-access check again", async () => {
    await boostingRoleService.setRole(admin, { userId: ids.target, role: "BOOSTER", enabled: true });
    expect((await eligibleOn(ids.heroicOpen)).eligible).toBe(true);
    await boostingRoleService.setRole(admin, { userId: ids.target, role: "BOOSTER", enabled: false });
    for (const runId of RUNS) {
      expect(await eligibleOn(runId)).toEqual({ eligible: false, reason: "NO_BOOSTER_ACCESS" });
    }
  });

  it("the Lootbuddy role neither grants Booster access nor gates Lootbuddy signups", async () => {
    await boostingRoleService.setRole(admin, { userId: ids.target, role: "LOOTBUDDY", enabled: true });
    expect((await eligibleOn(ids.heroicOpen)).eligible).toBe(false);

    // Without the Lootbuddy role a User can still sign up as a Lootbuddy (no gate exists).
    await boostingRoleService.setRole(admin, { userId: ids.target, role: "LOOTBUDDY", enabled: false });
    const result = await signupService.setLootbuddies(target, {
      runId: ids.heroicOpen,
      lootbuddies: [{ wowClass: "SHAMAN", mode: "LOOT_ONLY", verification: "NONE" }],
    });
    expect(result.created).toBe(1);
  });
});
