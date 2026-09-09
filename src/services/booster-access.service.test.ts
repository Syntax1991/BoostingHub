import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { boosterAccessService } from "@/services/booster-access.service";
import { canTransitionBoosterAccess, canRequestFromStatus } from "@/services/booster-access-state";
import { signupService } from "@/services/signup.service";
import { characterService } from "@/services/character.service";
import { rolesForClass } from "@/lib/wow-specializations";

const ids = {
  owner: "aaaaaaaa-aaaa-4aaa-8aaa-ba0000000001",
  other: "aaaaaaaa-aaaa-4aaa-8aaa-ba0000000002",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-ba0000000003",
  admin: "44444444-4444-4444-8444-444444444444",
  heroicOpen: "r1111111-1111-4111-8111-111111111111",
};

const createdCharacterIds: string[] = [];
const createdSignupIds: string[] = [];
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
    if (table === "User") {
      await orm.User.where({ id }).delete();
      return;
    }
    if (table === "Character") {
      await orm.Character.where({ id }).delete();
      return;
    }
    if (table === "RunSignup") {
      await orm.RunSignup.where({ id }).delete();
      return;
    }
    await orm.BoosterAccess.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

async function cleanupOwnerDomain() {
  paladinSerial = 0;
  createdSignupIds.length = 0;
  createdAccessIds.length = 0;
  createdCharacterIds.length = 0;
  for (const id of [ids.owner, ids.other, ids.lead]) {
    const signups = await orm.RunSignup.where({ userId: id }).all();
    for (const row of signups) {
      await deleteIfPresent("RunSignup", String(row.id));
    }
    const access = await orm.BoosterAccess.where({ userId: id }).all();
    for (const row of access) {
      await deleteIfPresent("BoosterAccess", String(row.id));
    }
    const characters = await orm.Character.where({ userId: id }).all();
    for (const row of characters) {
      await deleteIfPresent("Character", String(row.id));
    }
  }
}

async function cleanupGeneratedRows() {
  await cleanupOwnerDomain();
  await deleteIfPresent("User", ids.owner);
  await deleteIfPresent("User", ids.other);
  await deleteIfPresent("User", ids.lead);
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
    expect(rolesForClass("MAGE")).toEqual(["DPS"]);
    expect(rolesForClass("PALADIN").sort()).toEqual(["DPS", "HEALER", "TANK"].sort());
  });
});

describe("boosterAccessService request", () => {
  const owner = asUser(ids.owner, "Access Owner");
  const other = asUser(ids.other, "Access Other");

  it("creates a pending request from the session character class, not a client class", async () => {
    const character = await createPaladin(owner);
    const requested = await boosterAccessService.requestAccess(owner, {
      characterId: character.id,
      role: "HEALER",
      difficulty: "HEROIC",
    });
    createdAccessIds.push(requested.id);
    expect(requested.status).toBe("PENDING");
    expect(requested.wowClass).toBe("PALADIN");
    expect(requested.userId).toBe(ids.owner);
  });

  it("rejects another user's character, inactive characters, and invalid roles", async () => {
    const character = await createPaladin(owner);
    await expectDomainCode(
      boosterAccessService.requestAccess(other, {
        characterId: character.id,
        role: "HEALER",
        difficulty: "HEROIC",
      }),
      "CHARACTER_NOT_OWNED",
    );
    await characterService.deactivateCharacter(owner, character.id);
    await expectDomainCode(
      boosterAccessService.requestAccess(owner, {
        characterId: character.id,
        role: "TANK",
        difficulty: "NORMAL",
      }),
      "CHARACTER_INACTIVE",
    );
    await characterService.reactivateCharacter(owner, character.id);
    const mage = await characterService.createCharacter(owner, {
      name: "Frostlab",
      realm: "Area 52",
      region: "US",
      wowClass: "MAGE",
      specialization: "Frost",
      itemLevel: 620,
    });
    createdCharacterIds.push(mage.id);
    await expectDomainCode(
      boosterAccessService.requestAccess(owner, {
        characterId: mage.id,
        role: "TANK",
        difficulty: "HEROIC",
      }),
      "BOOSTER_ACCESS_ROLE_INVALID",
    );
  });

  it("rejects duplicate pending/approved and allows a different role or difficulty", async () => {
    const character = await createPaladin(owner);
    const first = await boosterAccessService.requestAccess(owner, {
      characterId: character.id,
      role: "HEALER",
      difficulty: "HEROIC",
    });
    createdAccessIds.push(first.id);
    await expectDomainCode(
      boosterAccessService.requestAccess(owner, {
        characterId: character.id,
        role: "HEALER",
        difficulty: "HEROIC",
      }),
      "BOOSTER_ACCESS_ALREADY_PENDING",
    );
    const dps = await boosterAccessService.requestAccess(owner, {
      characterId: character.id,
      role: "DPS",
      difficulty: "HEROIC",
    });
    createdAccessIds.push(dps.id);
    const mythic = await boosterAccessService.requestAccess(owner, {
      characterId: character.id,
      role: "HEALER",
      difficulty: "MYTHIC",
    });
    createdAccessIds.push(mythic.id);
    expect(dps.id).not.toBe(first.id);
    expect(mythic.difficulty).toBe("MYTHIC");
  });
});

describe("boosterAccessService admin authorization", () => {
  const owner = asUser(ids.owner, "Access Owner");
  const lead = asUser(ids.lead, "Access Lead", "RAID_LEAD");
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("lets only ADMIN approve, reject, and revoke", async () => {
    const character = await createPaladin(owner);
    const requested = await boosterAccessService.requestAccess(owner, {
      characterId: character.id,
      role: "TANK",
      difficulty: "NORMAL",
    });
    createdAccessIds.push(requested.id);

    await expectDomainCode(boosterAccessService.approveAccess(owner, requested.id), "NOT_AUTHORIZED");
    await expectDomainCode(boosterAccessService.approveAccess(lead, requested.id), "NOT_AUTHORIZED");
    await expectDomainCode(boosterAccessService.rejectAccess(lead, requested.id), "NOT_AUTHORIZED");
    await boosterAccessService.approveAccess(admin, requested.id);
    await expectDomainCode(boosterAccessService.revokeAccess(lead, requested.id), "NOT_AUTHORIZED");
    await boosterAccessService.revokeAccess(admin, requested.id, "No longer boosting.");
  });
});

describe("boosterAccessService approval and signup", () => {
  const owner = asUser(ids.owner, "Access Owner");
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("approves pending access and enables matching booster signup only", async () => {
    const character = await createPaladin(owner);
    const requested = await boosterAccessService.requestAccess(owner, {
      characterId: character.id,
      role: "HEALER",
      difficulty: "HEROIC",
    });
    createdAccessIds.push(requested.id);
    await boosterAccessService.approveAccess(admin, requested.id);
    const stored = await boosterAccessService.listAdminAccessRequests(admin, { status: "APPROVED", query: "Pally" });
    const row = stored.find((item) => item.id === requested.id);
    expect(row?.status).toBe("APPROVED");
    expect(row?.reviewedById).toBe(ids.admin);
    expect(row?.approvedById).toBe(ids.admin);

    const options = await signupService.getSignupOptions(owner, ids.heroicOpen);
    expect(options.booster.eligible.some((item) => item.characterId === character.id && item.role === "HEALER")).toBe(
      true,
    );
    expect(options.booster.eligible.some((item) => item.characterId === character.id && item.role === "TANK")).toBe(
      false,
    );

    const mythicOpen = "r2222222-2222-4222-8222-222222222222";
    const mythicOptions = await signupService.getSignupOptions(owner, mythicOpen);
    expect(mythicOptions.booster.eligible.some((item) => item.characterId === character.id)).toBe(false);
    await expectDomainCode(
      boosterAccessService.requestAccess(owner, {
        characterId: character.id,
        role: "HEALER",
        difficulty: "HEROIC",
      }),
      "BOOSTER_ACCESS_ALREADY_APPROVED",
    );
  });
});

describe("boosterAccessService rejection, revocation, lootbuddy", () => {
  const owner = asUser(ids.owner, "Access Owner");
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("rejects without granting eligibility and allows a later re-request", async () => {
    const character = await createPaladin(owner);
    const requested = await boosterAccessService.requestAccess(owner, {
      characterId: character.id,
      role: "HEALER",
      difficulty: "NORMAL",
    });
    createdAccessIds.push(requested.id);
    await boosterAccessService.rejectAccess(admin, requested.id, "Need more experience.");
    const options = await signupService.getSignupOptions(owner, ids.heroicOpen);
    expect(options.booster.eligible.some((item) => item.characterId === character.id && item.role === "HEALER")).toBe(
      false,
    );
    const again = await boosterAccessService.requestAccess(owner, {
      characterId: character.id,
      role: "HEALER",
      difficulty: "NORMAL",
    });
    expect(again.id).toBe(requested.id);
    expect(again.status).toBe("PENDING");
    expect(again.notes).toBeNull();
  });

  it("revokes approved access without deleting existing signups, and lootbuddy still works", async () => {
    const character = await createPaladin(owner);
    const requested = await boosterAccessService.requestAccess(owner, {
      characterId: character.id,
      role: "HEALER",
      difficulty: "HEROIC",
    });
    createdAccessIds.push(requested.id);
    await boosterAccessService.approveAccess(admin, requested.id);
    const loot = await signupService.createLootbuddySignup(owner, {
      runId: ids.heroicOpen,
      characterId: character.id,
      mode: "PLAYING",
      verification: "NONE",
    });
    createdSignupIds.push(loot.id);
    const booster = await signupService.createBoosterSignup(owner, {
      runId: ids.heroicOpen,
      characterId: character.id,
      role: "HEALER",
      isBackup: true,
    });
    createdSignupIds.push(booster.id);

    await boosterAccessService.revokeAccess(admin, requested.id, "Break.");
    const after = await signupService.getSignupOptions(owner, ids.heroicOpen);
    expect(after.booster.eligible.some((item) => item.characterId === character.id)).toBe(false);
    expect(after.lootbuddy.eligible.some((item) => item.characterId === character.id)).toBe(true);

    const storedBooster = await orm.RunSignup.where({ id: booster.id }).first();
    expect(storedBooster?.status).toBe("PENDING");
    await expectDomainCode(
      signupService.createBoosterSignup(owner, {
        runId: "r7777777-7777-4777-8777-777777777777",
        characterId: character.id,
        role: "HEALER",
        isBackup: false,
      }),
      "BOOSTER_ACCESS_REQUIRED",
    );
  });
});
