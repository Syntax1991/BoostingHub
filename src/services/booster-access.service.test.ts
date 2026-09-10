import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import type { CharacterRole, RaidDifficulty, WowClass } from "@/models/enums";
import { boosterAccessService } from "@/services/booster-access.service";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import { canTransitionBoosterAccess, canRequestFromStatus } from "@/services/booster-access-state";
import { signupService } from "@/services/signup.service";
import { characterService } from "@/services/character.service";
import { rolesForClass } from "@/lib/wow-specializations";
import { boosterQualificationRepository } from "@/repositories/booster-qualification.repository";

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
const createdQualificationIds: string[] = [];

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
    // Already gone.
  }
}

async function cleanupOwnerDomain() {
  paladinSerial = 0;
  createdSignupIds.length = 0;
  createdAccessIds.length = 0;
  createdQualificationIds.length = 0;
  createdCharacterIds.length = 0;
  for (const id of [ids.owner, ids.other, ids.lead]) {
    const signups = await orm.RunSignup.where({ userId: id }).all();
    for (const row of signups) {
      await deleteIfPresent("RunSignup", String(row.id));
    }
    const quals = await orm.BoosterQualification.where({ userId: id }).all();
    for (const row of quals) {
      await deleteIfPresent("BoosterQualification", String(row.id));
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
  const adminQuals = await orm.BoosterQualification.where({ userId: ids.admin }).all();
  void adminQuals;
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

async function createShamanHealer(owner: AuthenticatedUser, name: string) {
  const character = await characterService.createCharacter(owner, {
    name,
    realm: "Area 52",
    region: "US",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    itemLevel: 640,
  });
  createdCharacterIds.push(character.id);
  return character;
}

async function createShamanDps(owner: AuthenticatedUser, name: string) {
  const character = await characterService.createCharacter(owner, {
    name,
    realm: "Area 52",
    region: "US",
    wowClass: "SHAMAN",
    specialization: "Enhancement",
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

  it("disables self-service requests after ownership check", async () => {
    const character = await createPaladin(owner);
    await expectDomainCode(
      boosterAccessService.requestAccess(owner, {
        characterId: character.id,
        role: "HEALER",
        difficulty: "HEROIC",
      }),
      "BOOSTER_ACCESS_SELF_REQUEST_DISABLED",
    );
  });

  it("rejects another user's character before the disabled gate", async () => {
    const character = await createPaladin(owner);
    await expectDomainCode(
      boosterAccessService.requestAccess(other, {
        characterId: character.id,
        role: "HEALER",
        difficulty: "HEROIC",
      }),
      "CHARACTER_NOT_OWNED",
    );
  });
});

describe("boosterAccessService grantAccess", () => {
  const lead = asUser(ids.lead, "Access Lead", "RAID_LEAD");
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("lets ADMIN grant new APPROVED qualification with granter metadata", async () => {
    const granted = await boosterAccessService.grantAccess(admin, {
      userId: ids.owner,
      difficulty: "HEROIC",
      notes: "Reviewed in Discord ticket #12",
    });
    createdQualificationIds.push(granted.id);
    expect(granted.status).toBe("APPROVED");
    expect(granted.difficulty).toBe("HEROIC");
    expect(granted.userId).toBe(ids.owner);
    expect(granted.notes).toBe("Reviewed in Discord ticket #12");
    expect(granted.grantedById).toBe(ids.admin);
    expect(granted.grantedAt).toBeTruthy();
  });

  it("rejects duplicate APPROVED grants", async () => {
    const first = await boosterAccessService.grantAccess(admin, {
      userId: ids.owner,
      difficulty: "NORMAL",
    });
    createdQualificationIds.push(first.id);
    await expectDomainCode(
      boosterAccessService.grantAccess(admin, {
        userId: ids.owner,
        difficulty: "NORMAL",
      }),
      "BOOSTER_ACCESS_ALREADY_APPROVED",
    );
  });

  it("does not let RAID_LEAD grant access", async () => {
    await expectDomainCode(
      boosterAccessService.grantAccess(lead, {
        userId: ids.owner,
        difficulty: "HEROIC",
      }),
      "NOT_AUTHORIZED",
    );
  });
});

describe("boosterAccessService admin authorization", () => {
  const owner = asUser(ids.owner, "Access Owner");
  const lead = asUser(ids.lead, "Access Lead", "RAID_LEAD");
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("lets only ADMIN approve, reject, and revoke", async () => {
    const character = await createPaladin(owner);
    const pendingId = await createPendingAccess(ids.owner, character.id, "PALADIN", "TANK", "NORMAL");

    await expectDomainCode(boosterAccessService.approveAccess(owner, pendingId), "NOT_AUTHORIZED");
    await expectDomainCode(boosterAccessService.approveAccess(lead, pendingId), "NOT_AUTHORIZED");
    await expectDomainCode(boosterAccessService.rejectAccess(lead, pendingId), "NOT_AUTHORIZED");
    await boosterAccessService.approveAccess(admin, pendingId);
    const qualification = await boosterQualificationRepository.findExact(ids.owner, "NORMAL");
    expect(qualification?.status).toBe("APPROVED");
    createdQualificationIds.push(qualification!.id);
    await expectDomainCode(boosterAccessService.revokeAccess(lead, qualification!.id), "NOT_AUTHORIZED");
    await boosterAccessService.revokeAccess(admin, qualification!.id, "No longer boosting.");
  });
});

describe("boosterAccessService approval and signup", () => {
  const owner = asUser(ids.owner, "Access Owner");
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("approves pending access, bridges qualification, and unlocks all class roles", async () => {
    const character = await createPaladin(owner);
    const pendingId = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "HEROIC");
    await boosterAccessService.approveAccess(admin, pendingId);

    const listed = await boosterAccessService.listAdminAccessRequests(admin, {
      view: "qualifications",
      status: "APPROVED",
      userId: ids.owner,
    });
    expect(listed.qualifications.some((row) => row.difficulty === "HEROIC" && row.status === "APPROVED")).toBe(
      true,
    );

    const options = await signupService.getSignupOptions(owner, ids.heroicOpen);
    expect(options.booster.eligible.some((item) => item.characterId === character.id && item.role === "HEALER")).toBe(
      true,
    );
    expect(options.booster.eligible.some((item) => item.characterId === character.id && item.role === "TANK")).toBe(
      true,
    );
    expect(options.booster.eligible.some((item) => item.characterId === character.id && item.role === "DPS")).toBe(
      true,
    );

    const mythicOpen = "r2222222-2222-4222-8222-222222222222";
    const mythicOptions = await signupService.getSignupOptions(owner, mythicOpen);
    expect(mythicOptions.booster.eligible.some((item) => item.characterId === character.id)).toBe(false);
    await expectDomainCode(
      boosterAccessService.grantAccess(admin, {
        userId: ids.owner,
        difficulty: "HEROIC",
      }),
      "BOOSTER_ACCESS_ALREADY_APPROVED",
    );
  });

  it("shares account-level difficulty approval across characters and roles", async () => {
    const first = await createShamanHealer(owner, "Shaa");
    const second = await createShamanHealer(owner, "Shab");
    const dps = await createShamanDps(owner, "Shac");
    const paladin = await createPaladin(owner);
    const other = asUser(ids.other, "Access Other");
    const otherShaman = await createShamanHealer(other, "Othera");

    const pendingId = await createPendingAccess(ids.owner, first.id, "SHAMAN", "HEALER", "HEROIC");
    await boosterAccessService.approveAccess(admin, pendingId);

    const accessRows = await orm.BoosterAccess.where({ userId: ids.owner }).all();
    expect(accessRows).toHaveLength(1);
    const quals = await orm.BoosterQualification.where({ userId: ids.owner }).all();
    expect(quals).toHaveLength(1);

    const options = await signupService.getSignupOptions(owner, ids.heroicOpen);
    expect(options.booster.eligible.some((item) => item.characterId === first.id && item.role === "HEALER")).toBe(true);
    expect(options.booster.eligible.some((item) => item.characterId === second.id && item.role === "HEALER")).toBe(
      true,
    );
    expect(options.booster.eligible.some((item) => item.characterId === dps.id && item.role === "DPS")).toBe(true);
    expect(options.booster.eligible.some((item) => item.characterId === paladin.id)).toBe(true);

    const otherOptions = await signupService.getSignupOptions(other, ids.heroicOpen);
    expect(otherOptions.booster.eligible.some((item) => item.characterId === otherShaman.id)).toBe(false);

    await characterService.deactivateCharacter(owner, first.id);
    const still = await orm.BoosterAccess.where({ id: pendingId }).first();
    expect(String(still?.status)).toBe("APPROVED");
    const afterDeactivate = await signupService.getSignupOptions(owner, ids.heroicOpen);
    expect(afterDeactivate.booster.eligible.some((item) => item.characterId === second.id)).toBe(true);
    expect(afterDeactivate.booster.eligible.some((item) => item.characterId === first.id)).toBe(false);

    const mythicOpen = "r2222222-2222-4222-8222-222222222222";
    const mythicOptions = await signupService.getSignupOptions(owner, mythicOpen);
    expect(mythicOptions.booster.eligible.some((item) => item.characterId === second.id)).toBe(false);
  });

  it("resolves all PENDING siblings for the same user and difficulty", async () => {
    const character = await createPaladin(owner);
    const healer = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "MYTHIC");
    const tank = await createPendingAccess(ids.owner, character.id, "PALADIN", "TANK", "MYTHIC");
    await boosterAccessService.approveAccess(admin, healer);

    const healerRow = await orm.BoosterAccess.where({ id: healer }).first();
    const tankRow = await orm.BoosterAccess.where({ id: tank }).first();
    expect(String(healerRow?.status)).toBe("APPROVED");
    expect(String(tankRow?.status)).toBe("APPROVED");
    const qualification = await boosterQualificationRepository.findExact(ids.owner, "MYTHIC");
    expect(qualification?.status).toBe("APPROVED");
  });
});

describe("boosterAccessService rejection, revocation, lootbuddy", () => {
  const owner = asUser(ids.owner, "Access Owner");
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("rejects without creating a qualification and allows later admin grant", async () => {
    const character = await createPaladin(owner);
    const pendingId = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "NORMAL");
    await boosterAccessService.rejectAccess(admin, pendingId, "Need more experience.");
    const quals = await orm.BoosterQualification.where({ userId: ids.owner }).all();
    expect(quals).toHaveLength(0);
    const options = await signupService.getSignupOptions(owner, ids.heroicOpen);
    expect(options.booster.eligible.some((item) => item.characterId === character.id)).toBe(false);
    const again = await boosterAccessService.grantAccess(admin, {
      userId: ids.owner,
      difficulty: "NORMAL",
      notes: "Re-reviewed",
    });
    createdQualificationIds.push(again.id);
    expect(again.status).toBe("APPROVED");
    expect(again.notes).toBe("Re-reviewed");
  });

  it("revokes approved qualification without deleting existing signups, and lootbuddy still works", async () => {
    const character = await createPaladin(owner);
    const pendingId = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "HEROIC");
    await boosterAccessService.approveAccess(admin, pendingId);
    const qualification = await boosterQualificationRepository.findExact(ids.owner, "HEROIC");
    expect(qualification).toBeTruthy();

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

    await boosterAccessService.revokeAccess(admin, qualification!.id, "Break.");
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

describe("boosterAccessService qualifications vs legacy requests", () => {
  const owner = asUser(ids.owner, "Access Owner");
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("lists qualifications separately from legacy PENDING requests", async () => {
    const character = await createPaladin(owner);
    const pendingId = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "HEROIC");
    const approved = await boosterAccessService.grantAccess(admin, {
      userId: ids.owner,
      difficulty: "NORMAL",
    });
    createdQualificationIds.push(approved.id);

    const rejectedId = await createPendingAccess(ids.owner, character.id, "PALADIN", "DPS", "MYTHIC");
    await boosterAccessService.rejectAccess(admin, rejectedId, "Not yet.");

    const beforeLegacyCount = (
      await boosterAccessService.listAdminAccessRequests(admin, { view: "legacy" })
    ).legacyPendingCount;

    const qualifications = await boosterAccessService.listAdminAccessRequests(admin, {
      view: "qualifications",
      userId: ids.owner,
    });
    expect(qualifications.view).toBe("qualifications");
    expect(qualifications.qualifications.every((row) => row.status === "APPROVED" || row.status === "REVOKED")).toBe(
      true,
    );
    expect(qualifications.qualifications.some((row) => row.id === approved.id)).toBe(true);
    expect(qualifications.legacyRequests).toHaveLength(0);

    const legacy = await boosterAccessService.listAdminAccessRequests(admin, {
      view: "legacy",
      userId: ids.owner,
    });
    expect(legacy.view).toBe("legacy");
    expect(legacy.legacyPendingCount).toBe(beforeLegacyCount);
    expect(legacy.legacyRequests.every((row) => row.status === "PENDING")).toBe(true);
    expect(legacy.legacyRequests.some((row) => row.id === pendingId)).toBe(true);
    expect(legacy.legacyRequests.some((row) => row.id === rejectedId)).toBe(false);
  });

  it("removes PENDING from legacy after approve or reject while preserving the row", async () => {
    const character = await createPaladin(owner);
    const approveId = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "HEROIC");
    const rejectId = await createPendingAccess(ids.owner, character.id, "PALADIN", "TANK", "NORMAL");
    const beforeCount = (
      await boosterAccessService.listAdminAccessRequests(admin, { view: "legacy" })
    ).legacyPendingCount;

    await boosterAccessService.approveAccess(admin, approveId);
    let legacy = await boosterAccessService.listAdminAccessRequests(admin, { view: "legacy" });
    expect(legacy.legacyRequests.some((row) => row.id === approveId)).toBe(false);
    expect(legacy.legacyPendingCount).toBe(beforeCount - 1);

    const preservedApproved = await orm.BoosterAccess.where({ id: approveId }).first();
    expect(String(preservedApproved?.status)).toBe("APPROVED");

    await boosterAccessService.rejectAccess(admin, rejectId, "Declined.");
    legacy = await boosterAccessService.listAdminAccessRequests(admin, { view: "legacy" });
    expect(legacy.legacyRequests.some((row) => row.id === rejectId)).toBe(false);
    expect(legacy.legacyPendingCount).toBe(beforeCount - 2);

    const qualifications = await boosterAccessService.listAdminAccessRequests(admin, {
      view: "qualifications",
      status: "ALL",
      userId: ids.owner,
    });
    expect(qualifications.qualifications.some((row) => row.difficulty === "HEROIC")).toBe(true);
    expect(qualifications.qualifications.some((row) => row.difficulty === "NORMAL")).toBe(false);
  });

  it("lets ADMIN grant without a Character and still rejects USER self-request", async () => {
    const granted = await boosterAccessService.grantAccess(admin, {
      userId: ids.owner,
      difficulty: "HEROIC",
    });
    createdQualificationIds.push(granted.id);
    expect(granted.status).toBe("APPROVED");
    expect(granted.grantedById).toBe(ids.admin);

    const character = await createPaladin(owner);
    await expectDomainCode(
      boosterAccessService.requestAccess(owner, {
        characterId: character.id,
        role: "HEALER",
        difficulty: "MYTHIC",
      }),
      "BOOSTER_ACCESS_SELF_REQUEST_DISABLED",
    );
  });
});

describe("boosterQualificationService helpers used by access flows", () => {
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("reactivates a REVOKED qualification on re-grant", async () => {
    const granted = await boosterQualificationService.grant(admin, {
      userId: ids.owner,
      difficulty: "MYTHIC",
    });
    await boosterQualificationService.revoke(admin, granted.id, "Break");
    const again = await boosterQualificationService.grant(admin, {
      userId: ids.owner,
      difficulty: "MYTHIC",
      notes: "Reinstated",
    });
    expect(again.id).toBe(granted.id);
    expect(again.status).toBe("APPROVED");
    expect(again.notes).toBe("Reinstated");
  });
});
