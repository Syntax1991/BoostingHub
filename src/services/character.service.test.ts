import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { characterRepository } from "@/repositories/character.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { characterService } from "@/services/character.service";
import { signupService } from "@/services/signup.service";

const ids = {
  owner: "aaaaaaaa-aaaa-4aaa-8aaa-cm0000000001",
  other: "aaaaaaaa-aaaa-4aaa-8aaa-cm0000000002",
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
    email: `${id}@cmtest.boostting.local`,
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

async function createTestUser(id: string, name: string) {
  await orm.User.create({
    id,
    name,
    email: `${id}@cmtest.boostting.local`,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function deleteIfPresent(
  table: "User" | "Character" | "RunSignup" | "BoosterAccess" | "BoosterQualification",
  id: string,
) {
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
    if (table === "BoosterQualification") {
      await orm.BoosterQualification.where({ id }).delete();
      return;
    }
    await orm.BoosterAccess.where({ id }).delete();
  } catch {
    // Already gone from a previous isolated run.
  }
}

async function cleanupGeneratedRows() {
  for (const id of createdSignupIds) {
    await deleteIfPresent("RunSignup", id);
  }
  const ownerSignups = await orm.RunSignup.where({ userId: ids.owner }).all();
  for (const row of ownerSignups) {
    await deleteIfPresent("RunSignup", String(row.id));
  }
  for (const id of createdAccessIds) {
    await deleteIfPresent("BoosterQualification", id);
  }
  const ownerQualifications = await orm.BoosterQualification.where({ userId: ids.owner }).all();
  for (const row of ownerQualifications) {
    await deleteIfPresent("BoosterQualification", String(row.id));
  }
  const ownerAccess = await orm.BoosterAccess.where({ userId: ids.owner }).all();
  for (const row of ownerAccess) {
    await deleteIfPresent("BoosterAccess", String(row.id));
  }
  for (const id of createdCharacterIds) {
    await deleteIfPresent("Character", id);
  }
  const leftover = await orm.Character.where({ userId: ids.owner }).all();
  for (const row of leftover) {
    await deleteIfPresent("Character", String(row.id));
  }
  const leftoverOther = await orm.Character.where({ userId: ids.other }).all();
  for (const row of leftoverOther) {
    await deleteIfPresent("Character", String(row.id));
  }
  await deleteIfPresent("User", ids.owner);
  await deleteIfPresent("User", ids.other);
}

beforeAll(async () => {
  await cleanupGeneratedRows();
  await createTestUser(ids.owner, "Character Owner");
  await createTestUser(ids.other, "Character Other");
});

afterAll(async () => {
  await cleanupGeneratedRows();
});

describe("characterService empty user", () => {
  it("returns zero counts for a user with no characters", async () => {
    const page = await characterService.getCharacterPage(asUser("bbbbbbbb-bbbb-4bbb-8bbb-cmempty00001", "Empty"));
    expect(page.totalCharacters).toBe(0);
    expect(page.activeCharacters).toBe(0);
    expect(page.characters).toEqual([]);
  });
});

describe("characterService create", () => {
  const owner = asUser(ids.owner, "Character Owner");
  const other = asUser(ids.other, "Character Other");

  it("creates EU and US characters for the session user, not a client-supplied owner", async () => {
    const eu = await characterService.createCharacter(owner, {
      name: "Cmtestone",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 640,
    });
    createdCharacterIds.push(eu.id);
    expect(eu.userId).toBe(ids.owner);
    expect(eu.isActive).toBe(true);
    expect(eu.primaryRole).toBe("HEALER");
    expect(eu.region).toBe("EU");

    const us = await characterService.createCharacter(owner, {
      name: "Cmtestone",
      realm: "Area 52",
      region: "US",
      wowClass: "HUNTER",
      specialization: "Beast Mastery",
      itemLevel: 620,
    });
    createdCharacterIds.push(us.id);
    expect(us.region).toBe("US");
    expect(us.userId).toBe(ids.owner);
  });

  it("accepts an accented character name", async () => {
    const created = await characterService.createCharacter(owner, {
      name: "Éowyn",
      realm: "Silvermoon",
      region: "EU",
      wowClass: "PRIEST",
      specialization: "Holy",
      itemLevel: 600,
    });
    createdCharacterIds.push(created.id);
    expect(created.name).toBe("Éowyn");
  });

  it("rejects a duplicate identity including case-only differences", async () => {
    const first = await characterService.createCharacter(owner, {
      name: "Synblast",
      realm: "Tarren Mill",
      region: "EU",
      wowClass: "WARRIOR",
      specialization: "Arms",
      itemLevel: 500,
    });
    createdCharacterIds.push(first.id);

    await expectDomainCode(
      characterService.createCharacter(owner, {
        name: "synblast",
        realm: "tarren mill",
        region: "EU",
        wowClass: "WARRIOR",
        specialization: "Fury",
        itemLevel: 501,
      }),
      "CHARACTER_ALREADY_EXISTS",
    );
  });

  it("allows the same name on a different realm or region, and another user to own the same identity", async () => {
    const original = await characterService.createCharacter(owner, {
      name: "Twinname",
      realm: "Draenor",
      region: "EU",
      wowClass: "MAGE",
      specialization: "Frost",
      itemLevel: 580,
    });
    createdCharacterIds.push(original.id);

    const otherRealm = await characterService.createCharacter(owner, {
      name: "Twinname",
      realm: "Kazzak",
      region: "EU",
      wowClass: "MAGE",
      specialization: "Fire",
      itemLevel: 581,
    });
    createdCharacterIds.push(otherRealm.id);

    const otherRegion = await characterService.createCharacter(owner, {
      name: "Twinname",
      realm: "Draenor",
      region: "US",
      wowClass: "MAGE",
      specialization: "Arcane",
      itemLevel: 582,
    });
    createdCharacterIds.push(otherRegion.id);

    const otherUser = await characterService.createCharacter(other, {
      name: "Twinname",
      realm: "Draenor",
      region: "EU",
      wowClass: "MAGE",
      specialization: "Frost",
      itemLevel: 583,
    });
    createdCharacterIds.push(otherUser.id);
    expect(otherUser.userId).toBe(ids.other);
  });

  it("rejects invalid class/spec combinations", async () => {
    await expectDomainCode(
      characterService.createCharacter(owner, {
        name: "Badspecial",
        realm: "Draenor",
        region: "EU",
        wowClass: "WARRIOR",
        specialization: "Restoration",
        itemLevel: 400,
      }),
      "INVALID_CLASS_SPECIALIZATION",
    );
  });
});

describe("characterService ownership and update", () => {
  const owner = asUser(ids.owner, "Character Owner");
  const other = asUser(ids.other, "Character Other");
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("lets the owner update fields, keeps class immutable, and rejects rename collisions", async () => {
    const first = await characterService.createCharacter(owner, {
      name: "Editone",
      realm: "Ravencrest",
      region: "EU",
      wowClass: "PALADIN",
      specialization: "Holy",
      itemLevel: 650,
    });
    const second = await characterService.createCharacter(owner, {
      name: "Edittwo",
      realm: "Ravencrest",
      region: "EU",
      wowClass: "PALADIN",
      specialization: "Protection",
      itemLevel: 651,
    });
    createdCharacterIds.push(first.id, second.id);

    const updated = await characterService.updateCharacter(owner, first.id, {
      name: "Editone",
      realm: "Ravencrest",
      region: "EU",
      specialization: "Retribution",
    });
    expect(updated.wowClass).toBe("PALADIN");
    expect(updated.specialization).toBe("Retribution");
    expect(updated.primaryRole).toBe("DPS");
    // Item level is Blizzard-authoritative and untouched by edits.
    expect(updated.itemLevel).toBe(650);

    await expectDomainCode(
      characterService.updateCharacter(owner, first.id, {
        name: "Edittwo",
        realm: "Ravencrest",
        region: "EU",
        specialization: "Retribution",
      }),
      "CHARACTER_ALREADY_EXISTS",
    );

    await expectDomainCode(
      characterService.updateCharacter(owner, "cccccccc-cccc-4ccc-8ccc-missing00001", {
        name: "Missing",
        realm: "Draenor",
        region: "EU",
        specialization: "Arms",
      }),
      "CHARACTER_NOT_FOUND",
    );
  });

  it("rejects cross-user detail, update, deactivate, and reactivate, including admin", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Ownedonly",
      realm: "Kazzak",
      region: "EU",
      wowClass: "ROGUE",
      specialization: "Assassination",
      itemLevel: 610,
    });
    createdCharacterIds.push(character.id);

    await expectDomainCode(characterService.getCharacterDetails(other, character.id), "CHARACTER_NOT_OWNED");
    await expectDomainCode(characterService.getCharacterDetails(admin, character.id), "CHARACTER_NOT_OWNED");
    await expectDomainCode(
      characterService.updateCharacter(other, character.id, {
        name: "Ownedonly",
        realm: "Kazzak",
        region: "EU",
        specialization: "Outlaw",
      }),
      "CHARACTER_NOT_OWNED",
    );
    await expectDomainCode(characterService.deactivateCharacter(other, character.id), "CHARACTER_NOT_OWNED");
    await expectDomainCode(characterService.reactivateCharacter(admin, character.id), "CHARACTER_NOT_OWNED");
  });
});

describe("characterService lifecycle and signup eligibility", () => {
  const owner = asUser(ids.owner, "Character Owner");

  it("deactivates without rewriting history or booster access, and blocks new signups until reactivation", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Lifecycle",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "DRUID",
      specialization: "Restoration",
      itemLevel: 630,
    });
    createdCharacterIds.push(character.id);

    const beforeAccess = await signupService.getSignupOptions(owner, ids.heroicOpen);
    expect(beforeAccess.booster.eligible.some((item) => item.characterId === character.id)).toBe(false);
    await expectDomainCode(
      signupService.createBoosterSignup(owner, {
        runId: ids.heroicOpen,
        characterId: character.id,
        role: "HEALER",
        isBackup: false,
      }),
      "BOOSTER_ACCESS_REQUIRED",
    );

    const qualificationId = crypto.randomUUID();
    const now = new Date().toISOString();
    await orm.BoosterQualification.create({
      id: qualificationId,
      userId: ids.owner,
      difficulty: "HEROIC",
      status: "APPROVED",
      notes: "Test grant",
      grantedAt: now,
      grantedById: ids.admin,
      revokedAt: null,
      revokedById: null,
      createdAt: now,
      updatedAt: now,
    });
    createdAccessIds.push(qualificationId);

    const withAccess = await signupService.getSignupOptions(owner, ids.heroicOpen);
    expect(
      withAccess.booster.eligible.some((item) => item.characterId === character.id && item.defaultRole === "HEALER"),
    ).toBe(true);

    const signup = await signupService.createBoosterSignup(owner, {
      runId: ids.heroicOpen,
      characterId: character.id,
      role: "HEALER",
      isBackup: false,
    });
    createdSignupIds.push(signup.id);

    await characterService.deactivateCharacter(owner, character.id);
    const stored = await characterRepository.findById(character.id);
    expect(stored?.isActive).toBe(false);

    const historical = await signupRepository.findById(signup.id);
    expect(historical?.status).toBe("PENDING");

    const qualifications = await orm.BoosterQualification.where({ userId: ids.owner }).all();
    expect(
      qualifications.some(
        (row) =>
          (row as { difficulty: string; status: string }).difficulty === "HEROIC" &&
          (row as { difficulty: string; status: string }).status === "APPROVED",
      ),
    ).toBe(true);

    const inactiveOptions = await signupService.getSignupOptions(owner, ids.heroicOpen);
    expect(inactiveOptions.booster.eligible.some((item) => item.characterId === character.id)).toBe(false);
    await expectDomainCode(
      signupService.createBoosterSignup(owner, {
        runId: ids.heroicOpen,
        characterId: character.id,
        role: "HEALER",
        isBackup: false,
      }),
      "CHARACTER_INACTIVE",
    );

    await characterService.reactivateCharacter(owner, character.id);
    const reactivated = await characterRepository.findById(character.id);
    expect(reactivated?.isActive).toBe(true);

    const activeOptions = await signupService.getSignupOptions(owner, ids.heroicOpen);
    expect(
      activeOptions.booster.eligible.some((item) => item.characterId === character.id && item.defaultRole === "HEALER"),
    ).toBe(true);
  });
});
