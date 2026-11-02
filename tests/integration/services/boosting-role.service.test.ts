import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import type { AccountRole } from "@/models/enums";
import { userRepository } from "@/repositories/user.repository";
import { isApprovedBooster } from "@/domain/boosting-access";
import { boostingRoleService } from "@/services/boosting-role.service";
import { characterService } from "@/services/character.service";
import { signupService } from "@/services/signup.service";
import { userManagementService } from "@/services/user-management.service";
import { SEED_IDS } from "@/prisma/seed-ids";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows } from "@tests/fixtures/db-fixtures";
import { expectDomainError } from "@tests/helpers/domain-error";
import { offerCharacter } from "@tests/helpers/signup-offers";

// Warcraft Logs auto-link enrichment runs after Character writes/syncs; keep it
// offline (a real WARCRAFT_LOGS_* in .env would otherwise hit the live API).
vi.mock("@/integrations/warcraft-logs/warcraft-logs-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/warcraft-logs/warcraft-logs-api-client")>()),
  warcraftLogsApiClient: {
    isConfigured: () => true,
    findCharacter: async () => ({ status: "NOT_FOUND" as const }),
  },
}));

/**
 * Boosting Roles (User.isBooster / User.isLootbuddy): account-level operational
 * capabilities, independent of each other and of accountRole. Booster is never
 * scoped by raid difficulty.
 */
/** The seeded open Runs, one per difficulty, used only to read eligibility and sign up a Lootbuddy. */
const RUNS = [SEED_IDS.runs.normalOpen, SEED_IDS.runs.heroicOpen, SEED_IDS.runs.mythicOpen];
const HEROIC_OPEN = SEED_IDS.runs.heroicOpen;

/** Characters and signups (also on the seeded Runs) cascade with their User. */
const created = { userIds: [] as string[] };
const ids = { target: "", adminTarget: "", ownerTarget: "", lead: "", admin: "" };
let admin: AuthenticatedUser;
let owner: AuthenticatedUser;
let lead: AuthenticatedUser;
let target: AuthenticatedUser;

async function createUser(name: string, accountRole: AccountRole) {
  const id = await createTestUser({ name, accountRole });
  created.userIds.push(id);
  return id;
}

async function roles(userId: string) {
  return userRepository.findBoostingRoles(userId);
}

async function accountRoleOf(userId: string) {
  const row = await orm.User.where({ id: userId }).select("accountRole").first();
  return String((row as { accountRole?: string } | null)?.accountRole);
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  ids.target = await createUser("Roles Target", "USER");
  ids.adminTarget = await createUser("Roles Admin", "ADMIN");
  // OWNER is a single-row role: the stored row stays ADMIN and only the actor carries OWNER.
  ids.ownerTarget = await createUser("Roles Owner", "ADMIN");
  ids.lead = await createUser("Roles Lead", "RAID_LEAD");
  ids.admin = await createUser("Roles Acting Admin", "ADMIN");
  admin = testActor(ids.admin, "ADMIN");
  owner = testActor(ids.ownerTarget, "OWNER");
  lead = testActor(ids.lead, "RAID_LEAD");
  target = testActor(ids.target);
});

afterAll(() => deleteCreatedRows(created));

beforeEach(async () => {
  for (const id of [ids.target, ids.adminTarget, ids.ownerTarget, ids.lead]) {
    await orm.User.where({ id }).update({ isBooster: false, isLootbuddy: false });
  }
});

describe("Boosting Roles on User", () => {
  it("default to neither role", async () => {
    expect(await roles(ids.target)).toEqual({
      isBooster: false,
      isLootbuddy: false,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
  });

  it("isApprovedBooster uses effective Booster access (manual or Discord)", () => {
    expect(isApprovedBooster({ isBooster: true, discordRaidBooster: false })).toBe(true);
    expect(isApprovedBooster({ isBooster: false, discordRaidBooster: true })).toBe(true);
    expect(isApprovedBooster({ isBooster: false, discordRaidBooster: false })).toBe(false);
    expect(isApprovedBooster(null)).toBe(false);
  });

  it("grants and revokes the Lootbuddy role", async () => {
    const granted = await boostingRoleService.setRole(admin, { userId: ids.target, role: "LOOTBUDDY", enabled: true });
    expect(granted).toMatchObject({ changed: true, roles: { isBooster: false, isLootbuddy: true } });
    expect(await roles(ids.target)).toEqual({
      isBooster: false,
      isLootbuddy: true,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });

    const revoked = await boostingRoleService.setRole(admin, { userId: ids.target, role: "LOOTBUDDY", enabled: false });
    expect(revoked).toMatchObject({ changed: true, roles: { isLootbuddy: false } });
    expect(await roles(ids.target)).toEqual({
      isBooster: false,
      isLootbuddy: false,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
  });

  it("represents all four Booster / Lootbuddy combinations independently", async () => {
    const combos = [
      { isBooster: false, isLootbuddy: false, discordRaidBooster: false, discordLootbuddy: false },
      { isBooster: true, isLootbuddy: false, discordRaidBooster: false, discordLootbuddy: false },
      { isBooster: false, isLootbuddy: true, discordRaidBooster: false, discordLootbuddy: false },
      { isBooster: true, isLootbuddy: true, discordRaidBooster: false, discordLootbuddy: false },
    ];
    for (const combo of combos) {
      await boostingRoleService.setRole(admin, { userId: ids.target, role: "BOOSTER", enabled: combo.isBooster });
      await boostingRoleService.setRole(admin, { userId: ids.target, role: "LOOTBUDDY", enabled: combo.isLootbuddy });
      expect(await roles(ids.target)).toEqual(combo);
    }
    // Revoking one role never touches the other.
    await boostingRoleService.setRole(admin, { userId: ids.target, role: "BOOSTER", enabled: false });
    expect(await roles(ids.target)).toEqual({
      isBooster: false,
      isLootbuddy: true,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
  });

  it("never changes the account role", async () => {
    await boostingRoleService.setRole(admin, { userId: ids.adminTarget, role: "BOOSTER", enabled: true });
    await boostingRoleService.setRole(admin, { userId: ids.adminTarget, role: "LOOTBUDDY", enabled: true });
    expect(await roles(ids.adminTarget)).toEqual({
      isBooster: true,
      isLootbuddy: true,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
    expect(await accountRoleOf(ids.adminTarget)).toBe("ADMIN");

    await boostingRoleService.setRole(admin, { userId: ids.target, role: "BOOSTER", enabled: true });
    expect(await accountRoleOf(ids.target)).toBe("USER");
  });

  it("lets OWNER manage roles, including on an OWNER-level account with both roles", async () => {
    await boostingRoleService.setRole(owner, { userId: ids.ownerTarget, role: "BOOSTER", enabled: true });
    await boostingRoleService.setRole(owner, { userId: ids.ownerTarget, role: "LOOTBUDDY", enabled: true });
    expect(await roles(ids.ownerTarget)).toEqual({
      isBooster: true,
      isLootbuddy: true,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
  });

  it("is a no-op (no write, no audit event) when the role is already in that state", async () => {
    const before = await orm.ActivityEvent.where({ userId: ids.admin }).all();
    const result = await boostingRoleService.setRole(admin, { userId: ids.target, role: "BOOSTER", enabled: false });
    expect(result.changed).toBe(false);
    const after = await orm.ActivityEvent.where({ userId: ids.admin }).all();
    expect(after.length).toBe(before.length);
  });

  it("refuses USER and RAID_LEAD, and unknown users", async () => {
    await expectDomainError(
      boostingRoleService.setRole(target, { userId: ids.target, role: "BOOSTER", enabled: true }),
      "NOT_AUTHORIZED",
    );
    await expectDomainError(
      boostingRoleService.setRole(lead, { userId: ids.target, role: "LOOTBUDDY", enabled: true }),
      "NOT_AUTHORIZED",
    );
    await expectDomainError(
      boostingRoleService.setRole(admin, {
        userId: crypto.randomUUID(),
        role: "BOOSTER",
        enabled: true,
      }),
      "USER_NOT_FOUND",
    );
    expect(await roles(ids.target)).toEqual({
      isBooster: false,
      isLootbuddy: false,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
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
    expect(detail.boostingRoles).toEqual({
      isBooster: false,
      isLootbuddy: false,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
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
      await expectDomainError(
        offerCharacter(target, runId, characterId, "HEALER"),
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
    expect((await eligibleOn(HEROIC_OPEN)).eligible).toBe(true);
    await boostingRoleService.setRole(admin, { userId: ids.target, role: "BOOSTER", enabled: false });
    for (const runId of RUNS) {
      expect(await eligibleOn(runId)).toEqual({ eligible: false, reason: "NO_BOOSTER_ACCESS" });
    }
  });

  it("the Lootbuddy role neither grants Booster access nor gates Lootbuddy signups", async () => {
    await boostingRoleService.setRole(admin, { userId: ids.target, role: "LOOTBUDDY", enabled: true });
    expect((await eligibleOn(HEROIC_OPEN)).eligible).toBe(false);

    // Without the Lootbuddy role a User can still sign up as a Lootbuddy (no gate exists).
    await boostingRoleService.setRole(admin, { userId: ids.target, role: "LOOTBUDDY", enabled: false });
    const result = await signupService.setLootbuddies(target, {
      runId: HEROIC_OPEN,
      lootbuddies: [{ wowClass: "SHAMAN", mode: "LOOT_ONLY", verification: "NONE" }],
    });
    expect(result.created).toBe(1);
  });
});
