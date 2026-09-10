import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import type { CharacterRole, RaidDifficulty, WowClass } from "@/models/enums";
import { boosterAccessService } from "@/services/booster-access.service";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import { boosterQualificationRepository } from "@/repositories/booster-qualification.repository";
import { characterService } from "@/services/character.service";

const ids = {
  owner: "bbbbbbbb-bbbb-4bbb-8bbb-ba0000000001",
  adminUser: "bbbbbbbb-bbbb-4bbb-8bbb-ba0000000002",
  admin: "44444444-4444-4444-8444-444444444444",
};

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@bqtest.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createTestUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"] = "USER") {
  await orm.User.create({
    id,
    name,
    email: `${id}@bqtest.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function cleanup() {
  for (const userId of [ids.owner, ids.adminUser]) {
    const quals = await orm.BoosterQualification.where({ userId }).all();
    for (const row of quals) {
      await orm.BoosterQualification.where({ id: row.id }).delete();
    }
    const access = await orm.BoosterAccess.where({ userId }).all();
    for (const row of access) {
      await orm.BoosterAccess.where({ id: row.id }).delete();
    }
    const characters = await orm.Character.where({ userId }).all();
    for (const row of characters) {
      await orm.Character.where({ id: row.id }).delete();
    }
  }
  try {
    await orm.User.where({ id: ids.owner }).delete();
  } catch {
    // gone
  }
  try {
    await orm.User.where({ id: ids.adminUser }).delete();
  } catch {
    // gone
  }
}

async function createPending(
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
  return id;
}

beforeAll(async () => {
  await cleanup();
  await createTestUser(ids.owner, "Qual Owner");
  await createTestUser(ids.adminUser, "Admin Without Access", "ADMIN");
});

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  for (const userId of [ids.owner, ids.adminUser]) {
    const quals = await orm.BoosterQualification.where({ userId }).all();
    for (const row of quals) {
      await orm.BoosterQualification.where({ id: row.id }).delete();
    }
    const access = await orm.BoosterAccess.where({ userId }).all();
    for (const row of access) {
      await orm.BoosterAccess.where({ id: row.id }).delete();
    }
    const characters = await orm.Character.where({ userId }).all();
    for (const row of characters) {
      await orm.Character.where({ id: row.id }).delete();
    }
  }
});

describe("boosterQualificationService", () => {
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");
  const adminWithoutAccess = asUser(ids.adminUser, "Admin Without Access", "ADMIN");
  const owner = asUser(ids.owner, "Qual Owner");

  it("grants without requiring a character", async () => {
    const granted = await boosterQualificationService.grant(admin, {
      userId: ids.owner,
      difficulty: "HEROIC",
      notes: "Ticket #9",
    });
    expect(granted.status).toBe("APPROVED");
    expect(granted.difficulty).toBe("HEROIC");
    expect(granted.grantedById).toBe(ids.admin);
    expect(granted.notes).toBe("Ticket #9");
  });

  it("reuses the unique user+difficulty row on re-grant after revoke", async () => {
    const first = await boosterQualificationService.grant(admin, {
      userId: ids.owner,
      difficulty: "MYTHIC",
    });
    await boosterQualificationService.revoke(admin, first.id, "Break");
    const second = await boosterQualificationService.grant(admin, {
      userId: ids.owner,
      difficulty: "MYTHIC",
    });
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("APPROVED");
    expect(second.revokedAt).toBeNull();
  });

  it("matches difficulty exactly", () => {
    const records = [
      { difficulty: "HEROIC" as const, status: "APPROVED" as const },
      { difficulty: "NORMAL" as const, status: "REVOKED" as const },
    ];
    expect(boosterQualificationService.isApprovedFor(records, "HEROIC")).toBe(true);
    expect(boosterQualificationService.isApprovedFor(records, "MYTHIC")).toBe(false);
    expect(boosterQualificationService.isApprovedFor(records, "NORMAL")).toBe(false);
  });

  it("bridges legacy approve into a qualification and resolves siblings", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Bridgea",
      realm: "Area 52",
      region: "US",
      wowClass: "PALADIN",
      specialization: "Holy",
      itemLevel: 640,
    });
    const healer = await createPending(ids.owner, character.id, "PALADIN", "HEALER", "HEROIC");
    const tank = await createPending(ids.owner, character.id, "PALADIN", "TANK", "HEROIC");
    await boosterAccessService.approveAccess(admin, healer);

    const healerRow = await orm.BoosterAccess.where({ id: healer }).first();
    const tankRow = await orm.BoosterAccess.where({ id: tank }).first();
    expect(String(healerRow?.status)).toBe("APPROVED");
    expect(String(tankRow?.status)).toBe("APPROVED");

    const qualification = await boosterQualificationRepository.findExact(ids.owner, "HEROIC");
    expect(qualification?.status).toBe("APPROVED");

    const again = await boosterQualificationService.ensureApproved(admin, {
      userId: ids.owner,
      difficulty: "HEROIC",
    });
    expect(again.id).toBe(qualification!.id);
  });

  it("does not create a qualification on reject", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Rejecta",
      realm: "Area 52",
      region: "US",
      wowClass: "WARRIOR",
      specialization: "Protection",
      itemLevel: 640,
    });
    const pending = await createPending(ids.owner, character.id, "WARRIOR", "TANK", "NORMAL");
    await boosterAccessService.rejectAccess(admin, pending, "No.");
    const quals = await boosterQualificationRepository.listByUserId(ids.owner);
    expect(quals).toHaveLength(0);
  });

  it("does not auto-approve ADMIN accounts without a qualification row", () => {
    expect(boosterQualificationService.isApprovedFor([], "HEROIC")).toBe(false);
    expect(
      boosterQualificationService.isApprovedFor(
        [{ difficulty: "MYTHIC", status: "REVOKED" }],
        "MYTHIC",
      ),
    ).toBe(false);
    void adminWithoutAccess;
  });
});

describe("boosterQualificationRepository.listByUserIds", () => {
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("batches qualifications for multiple users in one call, grouped correctly per user", async () => {
    await boosterQualificationService.grant(admin, { userId: ids.owner, difficulty: "HEROIC" });
    await boosterQualificationService.grant(admin, { userId: ids.adminUser, difficulty: "MYTHIC" });

    const rows = await boosterQualificationRepository.listByUserIds([ids.owner, ids.adminUser]);

    const ownerRows = rows.filter((row) => row.userId === ids.owner);
    const adminUserRows = rows.filter((row) => row.userId === ids.adminUser);
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0]?.difficulty).toBe("HEROIC");
    expect(adminUserRows).toHaveLength(1);
    expect(adminUserRows[0]?.difficulty).toBe("MYTHIC");
  });

  it("de-duplicates repeated user ids and returns [] for an empty input", async () => {
    await boosterQualificationService.grant(admin, { userId: ids.owner, difficulty: "NORMAL" });

    const rows = await boosterQualificationRepository.listByUserIds([ids.owner, ids.owner]);
    expect(rows.filter((row) => row.difficulty === "NORMAL")).toHaveLength(1);

    expect(await boosterQualificationRepository.listByUserIds([])).toEqual([]);
  });
});
