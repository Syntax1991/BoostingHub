import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import type { CharacterRole, RaidDifficulty, WowClass } from "@/models/enums";
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

  it("builds a read-only access panel with Discord CTA flags", async () => {
    const character = await createPaladin(owner);
    const panel = boosterAccessService.buildCharacterAccessPanel({
      wowClass: character.wowClass,
      isActive: true,
      boosterAccess: [],
    });
    expect(panel.canSubmitRequests).toBe(false);
    expect(panel.selfRequestDisabled).toBe(true);
    expect(panel.cells.every((cell) => cell.canRequest === false)).toBe(true);
    expect("discordTicketUrl" in panel).toBe(true);
  });
});

describe("boosterAccessService grantAccess", () => {
  const owner = asUser(ids.owner, "Access Owner");
  const lead = asUser(ids.lead, "Access Lead", "RAID_LEAD");
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("lets ADMIN grant new APPROVED access with reviewer metadata", async () => {
    const granted = await boosterAccessService.grantAccess(admin, {
      userId: ids.owner,
      wowClass: "PALADIN",
      role: "HEALER",
      difficulty: "HEROIC",
      notes: "Reviewed in Discord ticket #12",
    });
    createdAccessIds.push(granted.id);
    expect(granted.status).toBe("APPROVED");
    expect(granted.wowClass).toBe("PALADIN");
    expect(granted.userId).toBe(ids.owner);
    expect(granted.notes).toBe("Reviewed in Discord ticket #12");
    expect(granted.approvedById).toBe(ids.admin);
    expect(granted.reviewedById).toBe(ids.admin);
    expect(granted.approvedAt).toBeTruthy();
    expect(granted.reviewedAt).toBeTruthy();
  });

  it("rejects duplicate APPROVED grants", async () => {
    const first = await boosterAccessService.grantAccess(admin, {
      userId: ids.owner,
      wowClass: "PALADIN",
      role: "TANK",
      difficulty: "NORMAL",
    });
    createdAccessIds.push(first.id);
    await expectDomainCode(
      boosterAccessService.grantAccess(admin, {
        userId: ids.owner,
        wowClass: "PALADIN",
        role: "TANK",
        difficulty: "NORMAL",
      }),
      "BOOSTER_ACCESS_ALREADY_APPROVED",
    );
  });

  it("approves an existing PENDING row via grant", async () => {
    const character = await createPaladin(owner);
    const pendingId = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "MYTHIC");
    const granted = await boosterAccessService.grantAccess(admin, {
      userId: ids.owner,
      wowClass: "PALADIN",
      role: "HEALER",
      difficulty: "MYTHIC",
      notes: "Ticket approved",
    });
    expect(granted.id).toBe(pendingId);
    expect(granted.status).toBe("APPROVED");
    expect(granted.approvedById).toBe(ids.admin);
    expect(granted.notes).toBe("Ticket approved");
  });

  it("reopens REJECTED and REVOKED rows to APPROVED via grant", async () => {
    const character = await createPaladin(owner);
    const rejectedId = await createPendingAccess(ids.owner, character.id, "PALADIN", "DPS", "HEROIC");
    await boosterAccessService.rejectAccess(admin, rejectedId, "Need logs.");
    const afterReject = await boosterAccessService.grantAccess(admin, {
      userId: ids.owner,
      wowClass: "PALADIN",
      role: "DPS",
      difficulty: "HEROIC",
    });
    expect(afterReject.id).toBe(rejectedId);
    expect(afterReject.status).toBe("APPROVED");

    await boosterAccessService.revokeAccess(admin, rejectedId, "Break.");
    const afterRevoke = await boosterAccessService.grantAccess(admin, {
      userId: ids.owner,
      wowClass: "PALADIN",
      role: "DPS",
      difficulty: "HEROIC",
      notes: "Reinstated",
    });
    expect(afterRevoke.id).toBe(rejectedId);
    expect(afterRevoke.status).toBe("APPROVED");
    expect(afterRevoke.notes).toBe("Reinstated");
  });

  it("does not let RAID_LEAD grant access", async () => {
    await expectDomainCode(
      boosterAccessService.grantAccess(lead, {
        userId: ids.owner,
        wowClass: "PALADIN",
        role: "HEALER",
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
    await expectDomainCode(boosterAccessService.revokeAccess(lead, pendingId), "NOT_AUTHORIZED");
    await boosterAccessService.revokeAccess(admin, pendingId, "No longer boosting.");
  });
});

describe("boosterAccessService approval and signup", () => {
  const owner = asUser(ids.owner, "Access Owner");
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("approves pending access and enables matching booster signup only", async () => {
    const character = await createPaladin(owner);
    const pendingId = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "HEROIC");
    await boosterAccessService.approveAccess(admin, pendingId);
    const stored = await boosterAccessService.listAdminAccessRequests(admin, { status: "APPROVED", query: "Pally" });
    const row = stored.find((item) => item.id === pendingId);
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
      boosterAccessService.grantAccess(admin, {
        userId: ids.owner,
        wowClass: "PALADIN",
        role: "HEALER",
        difficulty: "HEROIC",
      }),
      "BOOSTER_ACCESS_ALREADY_APPROVED",
    );
  });

  it("shares account-level approval across matching Characters and excludes mismatched class/role/user", async () => {
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

    const options = await signupService.getSignupOptions(owner, ids.heroicOpen);
    expect(options.booster.eligible.some((item) => item.characterId === first.id && item.role === "HEALER")).toBe(true);
    expect(options.booster.eligible.some((item) => item.characterId === second.id && item.role === "HEALER")).toBe(
      true,
    );
    // Enhancement Shaman still uses account Shaman+Healer approval when signing as HEALER;
    // Shaman+DPS remains a separate qualification and is not inherited.
    expect(options.booster.eligible.some((item) => item.characterId === dps.id && item.role === "HEALER")).toBe(true);
    expect(options.booster.eligible.some((item) => item.role === "DPS")).toBe(false);
    expect(options.booster.eligible.some((item) => item.characterId === paladin.id)).toBe(false);

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
});

describe("boosterAccessService rejection, revocation, lootbuddy", () => {
  const owner = asUser(ids.owner, "Access Owner");
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("rejects without granting eligibility and allows later admin grant", async () => {
    const character = await createPaladin(owner);
    const pendingId = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "NORMAL");
    await boosterAccessService.rejectAccess(admin, pendingId, "Need more experience.");
    const options = await signupService.getSignupOptions(owner, ids.heroicOpen);
    expect(options.booster.eligible.some((item) => item.characterId === character.id && item.role === "HEALER")).toBe(
      false,
    );
    const again = await boosterAccessService.grantAccess(admin, {
      userId: ids.owner,
      wowClass: "PALADIN",
      role: "HEALER",
      difficulty: "NORMAL",
      notes: "Re-reviewed",
    });
    expect(again.id).toBe(pendingId);
    expect(again.status).toBe("APPROVED");
    expect(again.notes).toBe("Re-reviewed");
  });

  it("revokes approved access without deleting existing signups, and lootbuddy still works", async () => {
    const character = await createPaladin(owner);
    const pendingId = await createPendingAccess(ids.owner, character.id, "PALADIN", "HEALER", "HEROIC");
    await boosterAccessService.approveAccess(admin, pendingId);
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

    await boosterAccessService.revokeAccess(admin, pendingId, "Break.");
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
