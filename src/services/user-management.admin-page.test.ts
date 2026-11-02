import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import type { CharacterRole, RaidDifficulty } from "@/models/enums";
import { userManagementService } from "@/services/user-management.service";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase, createTestCharacter, createTestUser, deleteCreatedRows } from "@/test/db-fixtures";
import { expectDomainError } from "@/test/domain-error";
import { parseAdminUserFilters } from "@/validators/user-management";

/** Access requests and Characters cascade with their User. */
const created = { userIds: [] as string[] };
let admin: AuthenticatedUser;
let lead: AuthenticatedUser;
/** Fresh per test, since tests change their requests and status: Alice has no Booster role, Bob has. */
let aliceId = "";
let bobId = "";

async function requestAccess(userId: string, role: CharacterRole, difficulty: RaidDifficulty) {
  const now = new Date().toISOString();
  await orm.BoosterAccess.create({
    id: crypto.randomUUID(),
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
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  const adminId = await createTestUser({ name: "UMAP Admin", accountRole: "ADMIN" });
  const leadId = await createTestUser({ name: "UMAP Lead", accountRole: "RAID_LEAD" });
  created.userIds.push(adminId, leadId);
  admin = testActor(adminId, "ADMIN");
  lead = testActor(leadId, "RAID_LEAD");
});

beforeEach(async () => {
  aliceId = await createTestUser({ name: "Alice Boost" });
  bobId = await createTestUser({ name: "Bob Boost", isBooster: true });
  created.userIds.push(aliceId, bobId);
});

afterAll(() => deleteCreatedRows(created));

describe("userManagementService.getUsersAdminPage", () => {
  it("lists users with batched pending counts and booster status on All Users", async () => {
    await requestAccess(aliceId, "HEALER", "HEROIC");
    await requestAccess(aliceId, "TANK", "MYTHIC");
    await requestAccess(bobId, "MELEE_DPS", "HEROIC");

    const page = await userManagementService.getUsersAdminPage(admin, parseAdminUserFilters({ sort: "name" }));

    expect(page.filters.view).toBe("users");
    // A community-wide total: other users in the shared test database may have requests too.
    expect(page.pendingAccessCount).toBeGreaterThanOrEqual(3);
    expect(page.pendingGroups).toEqual([]);

    const alice = page.users.find((row) => row.id === aliceId)!;
    const bob = page.users.find((row) => row.id === bobId)!;
    expect(alice).toMatchObject({ pendingAccessCount: 2, isBooster: false, accountStatus: "ACTIVE" });
    expect(bob).toMatchObject({ pendingAccessCount: 1, isBooster: true });
  });

  it("filters All Users by pending access and account status without N+1 shape", async () => {
    await requestAccess(aliceId, "HEALER", "HEROIC");
    await orm.User.where({ id: bobId }).update({ accountStatus: "DISABLED", updatedAt: new Date().toISOString() });

    const pendingOnly = await userManagementService.getUsersAdminPage(admin, parseAdminUserFilters({ pendingAccess: "1" }));
    expect(pendingOnly.users.every((row) => row.pendingAccessCount > 0)).toBe(true);
    expect(pendingOnly.users.some((row) => row.id === aliceId)).toBe(true);
    expect(pendingOnly.users.some((row) => row.id === bobId)).toBe(false);

    const disabled = await userManagementService.getUsersAdminPage(admin, parseAdminUserFilters({ accountStatus: "DISABLED" }));
    expect(disabled.users.every((row) => row.accountStatus === "DISABLED")).toBe(true);
    expect(disabled.users.some((row) => row.id === bobId)).toBe(true);
    expect(disabled.users.some((row) => row.id === aliceId)).toBe(false);
  });

  it("groups Pending Boosting Access by user with concrete roles", async () => {
    await requestAccess(aliceId, "HEALER", "HEROIC");
    await requestAccess(aliceId, "TANK", "MYTHIC");
    await requestAccess(bobId, "MELEE_DPS", "HEROIC");

    const page = await userManagementService.getUsersAdminPage(admin, parseAdminUserFilters({ view: "boosting-access" }));

    expect(page.filters.view).toBe("boosting-access");
    expect(page.users).toEqual([]);
    expect(page.pendingAccessCount).toBeGreaterThanOrEqual(3);

    const aliceGroup = page.pendingGroups.find((group) => group.userId === aliceId)!;
    const bobGroup = page.pendingGroups.find((group) => group.userId === bobId)!;
    expect(aliceGroup.userName).toBe("Alice Boost");
    expect(aliceGroup.requests.map((row) => row.role).sort()).toEqual(["HEALER", "TANK"]);
    expect(aliceGroup.requests.every((row) => row.status === "PENDING")).toBe(true);
    expect(bobGroup.requests.map((row) => row.role)).toEqual(["MELEE_DPS"]);
  });

  it("blocks RAID_LEAD from the consolidated Users admin page", async () => {
    await expectDomainError(
      userManagementService.getUsersAdminPage(lead, parseAdminUserFilters({})),
      "USER_MANAGEMENT_FORBIDDEN",
    );
  });

  it("batches Character roles for Access modal context (not a directory column)", async () => {
    const character = (userId: string, name: string, wowClass: "PRIEST" | "WARRIOR" | "MAGE", specialization: string, primaryRole: CharacterRole, isActive = true) =>
      createTestCharacter({ userId, name, realm: "Blackrock", wowClass, specialization, primaryRole, itemLevel: 640, isActive });

    await character(aliceId, "Umapheal", "PRIEST", "Holy", "HEALER");
    await character(aliceId, "Umaptank", "WARRIOR", "Protection", "TANK");
    await character(aliceId, "Umapidle", "MAGE", "Fire", "RANGED_DPS", false);
    const offspecId = await character(bobId, "Umapoff", "PRIEST", "Holy", "HEALER");
    await orm.CharacterPlayableSpec.create({
      id: crypto.randomUUID(),
      characterId: offspecId,
      specialization: "Shadow",
      createdAt: new Date().toISOString(),
    });

    const page = await userManagementService.getUsersAdminPage(admin, parseAdminUserFilters({ sort: "name" }));
    const alice = page.users.find((row) => row.id === aliceId)!;
    const bob = page.users.find((row) => row.id === bobId)!;

    // The retired Mage counts as a Character but adds no role.
    expect(alice).toMatchObject({ isBooster: false, characterRoles: ["TANK", "HEALER"], characterCount: 3 });
    expect(bob).toMatchObject({ isBooster: true, characterRoles: ["HEALER", "RANGED_DPS"] });
  });
});
