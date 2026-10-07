import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { userManagementService } from "@/services/user-management.service";
import { parseAdminUserFilters } from "@/validators/user-management";

const ids = {
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-umap00000001",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-umap00000002",
  alice: "aaaaaaaa-aaaa-4aaa-8aaa-umap00000003",
  bob: "aaaaaaaa-aaaa-4aaa-8aaa-umap00000004",
};

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"],
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@umap.boostting.local`,
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
  accountRole: AuthenticatedUser["accountRole"],
  extras: { isBooster?: boolean; accountStatus?: "ACTIVE" | "DISABLED" } = {},
) {
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name,
    email: `${id}@umap.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: extras.accountStatus ?? "ACTIVE",
    isBooster: extras.isBooster ?? false,
    isLootbuddy: false,
    createdAt: now,
    updatedAt: now,
  });
}

async function createPending(userId: string, role: "HEALER" | "TANK" | "MELEE_DPS", difficulty: "HEROIC" | "MYTHIC") {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.BoosterAccess.create({
    id,
    userId,
    characterId: null,
    wowClass: "PALADIN",
    role,
    difficulty,
    status: "PENDING",
    notes: null,
    approvedAt: null,
    approvedById: null,
    reviewedAt: null,
    reviewedById: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createCharacter(input: {
  id: string;
  userId: string;
  name: string;
  wowClass: "PRIEST" | "WARRIOR" | "MAGE";
  specialization: string;
  primaryRole: "HEALER" | "TANK" | "MELEE_DPS" | "RANGED_DPS";
  isActive?: boolean;
  playableSpecs?: string[];
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
    itemLevel: 640,
    isActive: input.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  });
  for (const specialization of input.playableSpecs ?? []) {
    await orm.CharacterPlayableSpec.create({
      id: crypto.randomUUID(),
      characterId: input.id,
      specialization,
      createdAt: now,
    });
  }
}

async function cleanup() {
  for (const userId of Object.values(ids)) {
    for (const row of await orm.BoosterAccess.where({ userId }).all()) {
      await orm.BoosterAccess.where({ id: String(row.id) }).delete().catch(() => {});
    }
    const characters = (await orm.Character.where({ userId }).all()) as Array<{ id: string }>;
    for (const character of characters) {
      await orm.CharacterPlayableSpec.where({ characterId: character.id }).delete().catch(() => {});
      await orm.Character.where({ id: character.id }).delete().catch(() => {});
    }
    await orm.User.where({ id: userId }).delete().catch(() => {});
  }
}

beforeAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
  await createUser(ids.admin, "UMAP Admin", "ADMIN");
  await createUser(ids.lead, "UMAP Lead", "RAID_LEAD");
  await createUser(ids.alice, "Alice Boost", "USER", { isBooster: false });
  await createUser(ids.bob, "Bob Boost", "USER", { isBooster: true });
});

afterAll(async () => {
  await cleanup();
});

describe("userManagementService.getUsersAdminPage", () => {
  const admin = asUser(ids.admin, "UMAP Admin", "ADMIN");
  const lead = asUser(ids.lead, "UMAP Lead", "RAID_LEAD");

  it("lists users with batched pending counts and booster status on All Users", async () => {
    await createPending(ids.alice, "HEALER", "HEROIC");
    await createPending(ids.alice, "TANK", "MYTHIC");
    await createPending(ids.bob, "MELEE_DPS", "HEROIC");

    const page = await userManagementService.getUsersAdminPage(
      admin,
      parseAdminUserFilters({ sort: "name" }),
    );

    expect(page.filters.view).toBe("users");
    expect(page.pendingAccessCount).toBeGreaterThanOrEqual(3);
    expect(page.pendingGroups).toEqual([]);

    const alice = page.users.find((row) => row.id === ids.alice)!;
    const bob = page.users.find((row) => row.id === ids.bob)!;
    expect(alice.pendingAccessCount).toBe(2);
    expect(alice.isBooster).toBe(false);
    expect(bob.pendingAccessCount).toBe(1);
    expect(bob.isBooster).toBe(true);
    expect(alice.accountStatus).toBe("ACTIVE");
  });

  it("filters All Users by pending access and account status without N+1 shape", async () => {
    await createPending(ids.alice, "HEALER", "HEROIC");
    await orm.User.where({ id: ids.bob }).update({
      accountStatus: "DISABLED",
      updatedAt: new Date().toISOString(),
    });

    const pendingOnly = await userManagementService.getUsersAdminPage(
      admin,
      parseAdminUserFilters({ pendingAccess: "1" }),
    );
    expect(pendingOnly.users.every((row) => row.pendingAccessCount > 0)).toBe(true);
    expect(pendingOnly.users.some((row) => row.id === ids.alice)).toBe(true);

    const disabled = await userManagementService.getUsersAdminPage(
      admin,
      parseAdminUserFilters({ accountStatus: "DISABLED" }),
    );
    expect(disabled.users.map((row) => row.id)).toEqual([ids.bob]);
  });

  it("groups Pending Boosting Access by user with concrete roles", async () => {
    await createPending(ids.alice, "HEALER", "HEROIC");
    await createPending(ids.alice, "TANK", "MYTHIC");
    await createPending(ids.bob, "MELEE_DPS", "HEROIC");

    const page = await userManagementService.getUsersAdminPage(
      admin,
      parseAdminUserFilters({ view: "boosting-access" }),
    );

    expect(page.filters.view).toBe("boosting-access");
    expect(page.users).toEqual([]);
    expect(page.pendingAccessCount).toBeGreaterThanOrEqual(3);

    const aliceGroup = page.pendingGroups.find((group) => group.userId === ids.alice)!;
    const bobGroup = page.pendingGroups.find((group) => group.userId === ids.bob)!;
    expect(aliceGroup.userName).toBe("Alice Boost");
    expect(aliceGroup.requests).toHaveLength(2);
    expect(aliceGroup.requests.map((row) => row.role).sort()).toEqual(["HEALER", "TANK"]);
    expect(aliceGroup.requests.every((row) => row.status === "PENDING")).toBe(true);
    expect(bobGroup.requests).toHaveLength(1);
    expect(bobGroup.requests[0]?.role).toBe("MELEE_DPS");
  });

  it("blocks RAID_LEAD from the consolidated Users admin page", async () => {
    await expect(
      userManagementService.getUsersAdminPage(lead, parseAdminUserFilters({})),
    ).rejects.toMatchObject({ code: "USER_MANAGEMENT_FORBIDDEN" });
  });

  it("batches Character roles for Access modal context (not a directory column)", async () => {
    const charHealer = "aaaaaaaa-aaaa-4aaa-8aaa-umapc0000001";
    const charTank = "aaaaaaaa-aaaa-4aaa-8aaa-umapc0000002";
    const charInactive = "aaaaaaaa-aaaa-4aaa-8aaa-umapc0000003";
    const charOffspec = "aaaaaaaa-aaaa-4aaa-8aaa-umapc0000004";

    await createCharacter({
      id: charHealer,
      userId: ids.alice,
      name: "Umapheal",
      wowClass: "PRIEST",
      specialization: "Holy",
      primaryRole: "HEALER",
    });
    await createCharacter({
      id: charTank,
      userId: ids.alice,
      name: "Umaptank",
      wowClass: "WARRIOR",
      specialization: "Protection",
      primaryRole: "TANK",
    });
    await createCharacter({
      id: charInactive,
      userId: ids.alice,
      name: "Umapidle",
      wowClass: "MAGE",
      specialization: "Fire",
      primaryRole: "RANGED_DPS",
      isActive: false,
    });
    await createCharacter({
      id: charOffspec,
      userId: ids.bob,
      name: "Umapoff",
      wowClass: "PRIEST",
      specialization: "Holy",
      primaryRole: "HEALER",
      playableSpecs: ["Shadow"],
    });

    const page = await userManagementService.getUsersAdminPage(
      admin,
      parseAdminUserFilters({ sort: "name" }),
    );
    const alice = page.users.find((row) => row.id === ids.alice)!;
    const bob = page.users.find((row) => row.id === ids.bob)!;

    expect(alice.isBooster).toBe(false);
    expect(alice.characterRoles).toEqual(["TANK", "HEALER"]);
    expect(alice.characterCount).toBe(3);

    expect(bob.isBooster).toBe(true);
    expect(bob.characterRoles).toEqual(["HEALER", "RANGED_DPS"]);
  });
});
