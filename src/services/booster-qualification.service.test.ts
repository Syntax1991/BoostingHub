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

  it("grants one account-level approval without a character or difficulty", async () => {
    const granted = await boosterQualificationService.grant(admin, {
      userId: ids.owner,
      notes: "Ticket #9",
    });
    expect(granted.status).toBe("APPROVED");
    expect(granted).not.toHaveProperty("difficulty");
    expect(granted.grantedById).toBe(ids.admin);
    expect(granted.notes).toBe("Ticket #9");
    expect(await orm.BoosterQualification.where({ userId: ids.owner }).all()).toHaveLength(1);
  });

  it("rejects a second grant for an already-approved booster (no duplicate row)", async () => {
    await boosterQualificationService.grant(admin, { userId: ids.owner });
    await expect(boosterQualificationService.grant(admin, { userId: ids.owner })).rejects.toMatchObject({
      code: "BOOSTER_ACCESS_ALREADY_APPROVED",
    });
    expect(await orm.BoosterQualification.where({ userId: ids.owner }).all()).toHaveLength(1);
  });

  it("enforces one qualification row per User at the database level", async () => {
    await boosterQualificationService.grant(admin, { userId: ids.owner });
    const now = new Date().toISOString();
    await expect(
      orm.BoosterQualification.create({
        id: crypto.randomUUID(),
        userId: ids.owner,
        status: "REVOKED",
        notes: null,
        grantedAt: null,
        grantedById: null,
        revokedAt: now,
        revokedById: null,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow();
  });

  it("reuses the single per-user row on re-grant after revoke", async () => {
    const first = await boosterQualificationService.grant(admin, {
      userId: ids.owner,
    });
    const revoked = await boosterQualificationService.revoke(admin, first.id, "Break");
    expect(revoked.status).toBe("REVOKED");
    expect(boosterQualificationService.isApprovedBooster(revoked)).toBe(false);
    const second = await boosterQualificationService.grant(admin, {
      userId: ids.owner,
    });
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("APPROVED");
    expect(second.revokedAt).toBeNull();
    expect(await orm.BoosterQualification.where({ userId: ids.owner }).all()).toHaveLength(1);
  });

  it("is approved by status alone — no difficulty argument exists", () => {
    expect(boosterQualificationService.isApprovedBooster({ status: "APPROVED" })).toBe(true);
    expect(boosterQualificationService.isApprovedBooster({ status: "REVOKED" })).toBe(false);
    expect(boosterQualificationService.isApprovedBooster(null)).toBe(false);
  });

  it("bridges legacy approve into the account qualification and resolves every PENDING request of the user", async () => {
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
    const mythicDps = await createPending(ids.owner, character.id, "PALADIN", "DPS", "MYTHIC");
    await boosterAccessService.approveAccess(admin, healer);

    for (const id of [healer, tank, mythicDps]) {
      const row = await orm.BoosterAccess.where({ id }).first();
      expect(String(row?.status)).toBe("APPROVED");
      // Historical request difficulty is preserved as-is.
      expect(["HEROIC", "MYTHIC"]).toContain(String(row?.difficulty));
    }

    const qualification = await boosterQualificationRepository.findByUserId(ids.owner);
    expect(qualification?.status).toBe("APPROVED");
    expect(await orm.BoosterQualification.where({ userId: ids.owner }).all()).toHaveLength(1);

    const again = await boosterQualificationService.ensureApproved(admin, {
      userId: ids.owner,
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
    expect(await boosterQualificationRepository.findByUserId(ids.owner)).toBeNull();
  });

  it("does not auto-approve ADMIN accounts without a qualification row", async () => {
    expect(await boosterQualificationRepository.findByUserId(adminWithoutAccess.id)).toBeNull();
    expect(boosterQualificationService.isApprovedBooster(null)).toBe(false);
  });
});

describe("boosterQualificationRepository.listByUserIds", () => {
  const admin = asUser(ids.admin, "Aelira Nightwatch", "ADMIN");

  it("batches the single qualification of multiple users in one call", async () => {
    await boosterQualificationService.grant(admin, { userId: ids.owner });
    const other = await boosterQualificationService.grant(admin, { userId: ids.adminUser });
    await boosterQualificationService.revoke(admin, other.id);

    const rows = await boosterQualificationRepository.listByUserIds([ids.owner, ids.adminUser]);

    const ownerRows = rows.filter((row) => row.userId === ids.owner);
    const adminUserRows = rows.filter((row) => row.userId === ids.adminUser);
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0]?.status).toBe("APPROVED");
    expect(adminUserRows).toHaveLength(1);
    expect(adminUserRows[0]?.status).toBe("REVOKED");
  });

  it("de-duplicates repeated user ids and returns [] for an empty input", async () => {
    await boosterQualificationService.grant(admin, { userId: ids.owner });

    const rows = await boosterQualificationRepository.listByUserIds([ids.owner, ids.owner]);
    expect(rows).toHaveLength(1);

    expect(await boosterQualificationRepository.listByUserIds([])).toEqual([]);
  });
});
