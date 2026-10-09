import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import type { CharacterRole, RaidDifficulty, WowClass } from "@/models/enums";
import { userRepository } from "@/repositories/user.repository";
import { boosterAccessService } from "@/services/booster-access.service";
import { canTransitionBoosterAccess, canRequestFromStatus } from "@/services/booster-access-state";
import { signupService } from "@/services/signup.service";
import { characterService } from "@/services/character.service";
import { rolesForClass } from "@/lib/wow-specializations";

/**
 * Legacy BoosterAccess = HISTORICAL request records. They never determine
 * current eligibility (that is User.isBooster — see boosting-role.service.test.ts);
 * approving one grants the account-level Booster role, and the request row keeps
 * the difficulty that was requested at the time.
 */
const ids = {
  owner: "aaaaaaaa-aaaa-4aaa-8aaa-ba0000000001",
  other: "aaaaaaaa-aaaa-4aaa-8aaa-ba0000000002",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-ba0000000003",
  admin: "44444444-4444-4444-8444-444444444444",
  heroicOpen: "r1111111-1111-4111-8111-111111111111",
  mythicOpen: "r2222222-2222-4222-8222-222222222222",
  normalOpen: "r4444444-4444-4444-8444-444444444444",
};

const createdCharacterIds: string[] = [];
const createdAccessIds: string[] = [];

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@batest.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function expectDomainCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected domain error ${code}`);
  } catch (error) {
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

async function createTestUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"] = "USER") {
  await orm.User.create({
    id,
    name,
    email: `${id}@batest.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function deleteIfPresent(table: "User" | "Character" | "RunSignup" | "BoosterAccess", id: string) {
  try {
    if (table === "User") await orm.User.where({ id }).delete();
    else if (table === "Character") await orm.Character.where({ id }).delete();
    else if (table === "RunSignup") await orm.RunSignup.where({ id }).delete();
    else await orm.BoosterAccess.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

async function cleanupOwnerDomain() {
  paladinSerial = 0;
  createdAccessIds.length = 0;
  createdCharacterIds.length = 0;
  for (const id of [ids.owner, ids.other, ids.lead]) {
    for (const row of await orm.RunSignup.where({ userId: id }).all()) {
      await deleteIfPresent("RunSignup", String(row.id));
    }
    for (const row of await orm.BoosterAccess.where({ userId: id }).all()) {
      await deleteIfPresent("BoosterAccess", String(row.id));
    }
    for (const row of await orm.Character.where({ userId: id }).all()) {
      await deleteIfPresent("Character", String(row.id));
    }
    await orm.User.where({ id }).update({ isBooster: false, isLootbuddy: false }).catch(() => {});
  }
}

async function cleanupGeneratedRows() {
  await cleanupOwnerDomain();
  await deleteIfPresent("User", ids.owner);
  await deleteIfPresent("User", ids.other);
  await deleteIfPresent("User", ids.lead);
}

async function createPendingAccess(
  userId: string,
  characterId: string | null,
  wowClass: WowClass,
  role: CharacterRole,
  difficulty: RaidDifficulty,
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.BoosterAccess.create({
    id,
    userId,
    characterId,
    wowClass,
    role,
    difficulty,
    status: "PENDING",
    createdAt: now,
    updatedAt: now,
  });
  createdAccessIds.push(id);
  return id;
}

let paladinSerial = 0;

async function createPaladin(owner: AuthenticatedUser) {
  paladinSerial += 1;
  const suffix = "abcdefghijklmnop"[paladinSerial - 1] ?? "z";
  const character = await characterService.createCharacter(owner, {
    name: `Pally${suffix}`,
    realm: "Area 52",
    region: "US",
    wowClass: "PALADIN",
    specialization: "Holy",
    itemLevel: 640,
  });
  createdCharacterIds.push(character.id);
  return character;
}

async function isBooster(userId: string) {
  return (await userRepository.findBoostingRoles(userId))?.isBooster ?? false;
}

beforeAll(async () => {
  await cleanupGeneratedRows();
  await createTestUser(ids.owner, "Access Owner");
  await createTestUser(ids.other, "Access Other");
  await createTestUser(ids.lead, "Access Lead", "RAID_LEAD");
});

afterAll(async () => {
  await cleanupGeneratedRows();
});

beforeEach(async () => {
  await cleanupOwnerDomain();
});

describe("booster access transitions", () => {
  it("allows pending to approve/reject, approved to revoke, and re-request from reject/revoke", () => {
    expect(canTransitionBoosterAccess("PENDING", "APPROVED")).toBe(true);
    expect(canTransitionBoosterAccess("PENDING", "REJECTED")).toBe(true);
    expect(canTransitionBoosterAccess("APPROVED", "REVOKED")).toBe(true);
    expect(canTransitionBoosterAccess("REJECTED", "PENDING")).toBe(true);
    expect(canTransitionBoosterAccess("REVOKED", "PENDING")).toBe(true);
    expect(canTransitionBoosterAccess("APPROVED", "PENDING")).toBe(false);
    expect(canRequestFromStatus(null)).toBe(true);
    expect(canRequestFromStatus("PENDING")).toBe(false);
    expect(canRequestFromStatus("APPROVED")).toBe(false);
  });

  it("does not treat mage as a tank class", () => {
    expect(rolesForClass("MAGE")).toEqual(["RANGED_DPS"]);
    expect(rolesForClass("PALADIN").sort()).toEqual(["HEALER", "MELEE_DPS", "TANK"].sort());
  });
});

describe("boosterAccessService request", () => {
  const owner = asUser(ids.owner, "Access Owner");
  const other = asUser(ids.other, "Access Other");

  it("disables self-service requests after ownership check", async () => {
    const character = await createPaladin(owner);
    await expectDomainCode(
      boosterAccessService.requestAccess(owner, {
        characterId: character.id,
      }),
      "BOOSTER_ACCESS_SELF_REQUEST_DISABLED",
    );
  });

  it("rejects another user's character before the disabled gate", async () => {
    const character = await createPaladin(owner);
    await expectDomainCode(
      boosterAccessService.requestAccess(other, {
        characterId: character.id,
      }),
      "CHARACTER_NOT_OWNED",
    );
  });
});

describe("boosterAccessService legacy review authorization", () => {
  const owner = asUser(ids.owner, "Access Owner");
  const lead = asUser(ids.lead, "Access Lead", "RAID_LEAD");
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("lets only ADMIN approve or reject historical requests", async () => {
    const character = await createPaladin(owner);
    const pendingId = await createPendingAccess(ids.owner, character.id, "PALADIN", "TANK", "NORMAL");

    await expectDomainCode(boosterAccessService.approveAccess(owner, pendingId), "NOT_AUTHORIZED");
    await expectDomainCode(boosterAccessService.approveAccess(lead, pendingId), "NOT_AUTHORIZED");
    await expectDomainCode(boosterAccessService.rejectAccess(lead, pendingId), "NOT_AUTHORIZED");
    await expectDomainCode(boosterAccessService.listLegacyRequests(lead), "NOT_AUTHORIZED");
    expect(await isBooster(ids.owner)).toBe(false);
    await boosterAccessService.approveAccess(admin, pendingId);
    expect(await isBooster(ids.owner)).toBe(true);
  });
});

describe("boosterAccessService approving a historical request", () => {
  const owner = asUser(ids.owner, "Access Owner");
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("grants the account-level Booster role, valid on every difficulty", async () => {
    const character = await createPaladin(owner); // specced Holy → HEALER
    const pendingId = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "HEROIC");
    await boosterAccessService.approveAccess(admin, pendingId);

    expect(await userRepository.findBoostingRoles(ids.owner)).toEqual({
      isBooster: true,
      isLootbuddy: false,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
    // A legacy request that named HEROIC unlocks Normal, Heroic and Mythic Runs alike;
    // the Character's specialization only determines the signup DEFAULT role.
    for (const runId of [ids.normalOpen, ids.heroicOpen, ids.mythicOpen]) {
      const options = await signupService.getSignupOptions(owner, runId);
      expect(
        options.booster.eligible.some((item) => item.characterId === character.id && item.defaultRole === "HEALER"),
      ).toBe(true);
      expect(options.booster.ineligible.some((item) => item.characterId === character.id)).toBe(false);
    }
  });

  it("resolves every PENDING sibling and keeps each request's historical difficulty", async () => {
    const character = await createPaladin(owner);
    const healer = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "MYTHIC");
    const tank = await createPendingAccess(ids.owner, character.id, "PALADIN", "TANK", "MYTHIC");
    const normalDps = await createPendingAccess(ids.owner, character.id, "PALADIN", "DPS", "NORMAL");
    await boosterAccessService.approveAccess(admin, healer);

    const expected = [
      [healer, "MYTHIC"],
      [tank, "MYTHIC"],
      [normalDps, "NORMAL"],
    ] as const;
    for (const [id, difficulty] of expected) {
      const row = await orm.BoosterAccess.where({ id }).first();
      expect(String(row?.status)).toBe("APPROVED");
      expect(String(row?.difficulty)).toBe(difficulty);
    }
    expect(await isBooster(ids.owner)).toBe(true);
  });

  it("is idempotent for a User who already holds the Booster role", async () => {
    await orm.User.where({ id: ids.owner }).update({ isBooster: true });
    const character = await createPaladin(owner);
    const pendingId = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "NORMAL");
    await boosterAccessService.approveAccess(admin, pendingId);
    expect(await isBooster(ids.owner)).toBe(true);
    expect(String((await orm.BoosterAccess.where({ id: pendingId }).first())?.status)).toBe("APPROVED");
  });
});

describe("boosterAccessService rejecting and listing historical requests", () => {
  const owner = asUser(ids.owner, "Access Owner");
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("rejecting grants nothing and never changes Boosting Roles", async () => {
    const character = await createPaladin(owner);
    const pendingId = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "NORMAL");
    await boosterAccessService.rejectAccess(admin, pendingId, "Need more experience.");
    expect(await userRepository.findBoostingRoles(ids.owner)).toEqual({
      isBooster: false,
      isLootbuddy: false,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
    const options = await signupService.getSignupOptions(owner, ids.heroicOpen);
    expect(options.booster.eligible.some((item) => item.characterId === character.id)).toBe(false);
  });

  it("lists only PENDING requests and removes them once reviewed, preserving the rows", async () => {
    const character = await createPaladin(owner);
    const approveId = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "HEROIC");
    const rejectId = await createPendingAccess(ids.owner, character.id, "PALADIN", "TANK", "NORMAL");
    const before = await boosterAccessService.listLegacyRequests(admin);
    const mine = await boosterAccessService.listLegacyRequests(admin, { userId: ids.owner });
    expect(mine.requests.map((row) => row.id).sort()).toEqual([approveId, rejectId].sort());
    expect(mine.requests.every((row) => row.status === "PENDING")).toBe(true);

    await boosterAccessService.rejectAccess(admin, rejectId, "Declined.");
    let legacy = await boosterAccessService.listLegacyRequests(admin);
    expect(legacy.requests.some((row) => row.id === rejectId)).toBe(false);
    expect(legacy.pendingCount).toBe(before.pendingCount - 1);

    await boosterAccessService.approveAccess(admin, approveId);
    legacy = await boosterAccessService.listLegacyRequests(admin);
    expect(legacy.requests.some((row) => row.id === approveId)).toBe(false);
    expect(legacy.pendingCount).toBe(before.pendingCount - 2);

    expect(String((await orm.BoosterAccess.where({ id: approveId }).first())?.status)).toBe("APPROVED");
    // A reviewed (REJECTED) historical row is not rewritten by a later approval.
    const rejected = await orm.BoosterAccess.where({ id: rejectId }).first();
    expect(String(rejected?.status)).toBe("REJECTED");
    expect(String(rejected?.difficulty)).toBe("NORMAL");
  });

  it("filters historical requests by what was requested", async () => {
    const character = await createPaladin(owner);
    const heroic = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "HEROIC");
    await createPendingAccess(ids.owner, character.id, "PALADIN", "TANK", "MYTHIC");
    const filtered = await boosterAccessService.listLegacyRequests(admin, {
      userId: ids.owner,
      difficulty: "HEROIC",
      role: "HEALER",
    });
    expect(filtered.requests.map((row) => row.id)).toEqual([heroic]);
  });

  it("current eligibility never reads historical requests", async () => {
    const character = await createPaladin(owner);
    // An APPROVED historical row alone does not make the User a Booster.
    const id = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "HEROIC");
    await orm.BoosterAccess.where({ id }).update({ status: "APPROVED" });
    expect(await isBooster(ids.owner)).toBe(false);
    const options = await signupService.getSignupOptions(owner, ids.heroicOpen);
    expect(options.booster.ineligible.find((item) => item.characterId === character.id)?.reason).toBe(
      "NO_BOOSTER_ACCESS",
    );
  });
});
