import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import type { CharacterRole, RaidDifficulty, WowClass } from "@/models/enums";
import { userRepository } from "@/repositories/user.repository";
import { boosterAccessService } from "@/services/booster-access.service";
import { canTransitionBoosterAccess, canRequestFromStatus } from "@/domain/booster-access-state";
import { signupService } from "@/services/signup.service";
import { characterService } from "@/services/character.service";
import { rolesForClass } from "@/lib/wow-specializations";
import { SEED_IDS } from "@/prisma/seed-ids";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows } from "@/test/db-fixtures";
import { expectDomainError } from "@/test/domain-error";

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
 * Legacy BoosterAccess = HISTORICAL request records. They never determine
 * current eligibility (that is User.isBooster — see boosting-role.service.test.ts);
 * approving one grants the account-level Booster role, and the request row keeps
 * the difficulty that was requested at the time.
 */
/** The seeded open Runs, one per difficulty, only read for eligibility. */
const NORMAL_OPEN = SEED_IDS.runs.normalOpen;
const HEROIC_OPEN = SEED_IDS.runs.heroicOpen;
const MYTHIC_OPEN = SEED_IDS.runs.mythicOpen;

/** Access requests and Characters cascade with their User. */
const created = { userIds: [] as string[] };
let other: AuthenticatedUser;
let lead: AuthenticatedUser;
let admin: AuthenticatedUser;
/** Fresh per test, since tests grant the Booster role and add requests and Characters. */
let owner: AuthenticatedUser;

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
  return character;
}

async function isBooster(userId: string) {
  return (await userRepository.findBoostingRoles(userId))?.isBooster ?? false;
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  const otherId = await createTestUser({ name: "Access Other" });
  const leadId = await createTestUser({ name: "Access Lead", accountRole: "RAID_LEAD" });
  const adminId = await createTestUser({ name: "Access Admin", accountRole: "ADMIN" });
  created.userIds.push(otherId, leadId, adminId);
  other = testActor(otherId);
  lead = testActor(leadId, "RAID_LEAD");
  admin = testActor(adminId, "ADMIN");
});

beforeEach(async () => {
  paladinSerial = 0;
  const ownerId = await createTestUser({ name: "Access Owner" });
  created.userIds.push(ownerId);
  owner = testActor(ownerId);
});

afterAll(() => deleteCreatedRows(created));

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
  it("disables self-service requests after ownership check", async () => {
    const character = await createPaladin(owner);
    await expectDomainError(
      boosterAccessService.requestAccess(owner, {
        characterId: character.id,
      }),
      "BOOSTER_ACCESS_SELF_REQUEST_DISABLED",
    );
  });

  it("rejects another user's character before the disabled gate", async () => {
    const character = await createPaladin(owner);
    await expectDomainError(
      boosterAccessService.requestAccess(other, {
        characterId: character.id,
      }),
      "CHARACTER_NOT_OWNED",
    );
  });
});

describe("boosterAccessService legacy review authorization", () => {
  it("lets only ADMIN approve or reject historical requests", async () => {
    const character = await createPaladin(owner);
    const pendingId = await createPendingAccess(owner.id, character.id, "PALADIN", "TANK", "NORMAL");

    await expectDomainError(boosterAccessService.approveAccess(owner, pendingId), "NOT_AUTHORIZED");
    await expectDomainError(boosterAccessService.approveAccess(lead, pendingId), "NOT_AUTHORIZED");
    await expectDomainError(boosterAccessService.rejectAccess(lead, pendingId), "NOT_AUTHORIZED");
    await expectDomainError(boosterAccessService.listLegacyRequests(lead), "NOT_AUTHORIZED");
    expect(await isBooster(owner.id)).toBe(false);
    await boosterAccessService.approveAccess(admin, pendingId);
    expect(await isBooster(owner.id)).toBe(true);
  });
});

describe("boosterAccessService approving a historical request", () => {
  it("grants the account-level Booster role, valid on every difficulty", async () => {
    const character = await createPaladin(owner); // specced Holy → HEALER
    const pendingId = await createPendingAccess(owner.id, character.id, "PALADIN", "HEALER", "HEROIC");
    await boosterAccessService.approveAccess(admin, pendingId);

    expect(await userRepository.findBoostingRoles(owner.id)).toEqual({
      isBooster: true,
      isLootbuddy: false,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
    // A legacy request that named HEROIC unlocks Normal, Heroic and Mythic Runs alike;
    // the Character's specialization only determines the signup DEFAULT role.
    for (const runId of [NORMAL_OPEN, HEROIC_OPEN, MYTHIC_OPEN]) {
      const options = await signupService.getSignupOptions(owner, runId);
      expect(
        options.booster.eligible.some((item) => item.characterId === character.id && item.defaultRole === "HEALER"),
      ).toBe(true);
      expect(options.booster.ineligible.some((item) => item.characterId === character.id)).toBe(false);
    }
  });

  it("resolves every PENDING sibling and keeps each request's historical difficulty", async () => {
    const character = await createPaladin(owner);
    const healer = await createPendingAccess(owner.id, character.id, "PALADIN", "HEALER", "MYTHIC");
    const tank = await createPendingAccess(owner.id, character.id, "PALADIN", "TANK", "MYTHIC");
    const normalDps = await createPendingAccess(owner.id, character.id, "PALADIN", "DPS", "NORMAL");
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
    expect(await isBooster(owner.id)).toBe(true);
  });

  it("is idempotent for a User who already holds the Booster role", async () => {
    await orm.User.where({ id: owner.id }).update({ isBooster: true });
    const character = await createPaladin(owner);
    const pendingId = await createPendingAccess(owner.id, character.id, "PALADIN", "HEALER", "NORMAL");
    await boosterAccessService.approveAccess(admin, pendingId);
    expect(await isBooster(owner.id)).toBe(true);
    expect(String((await orm.BoosterAccess.where({ id: pendingId }).first())?.status)).toBe("APPROVED");
  });
});

describe("boosterAccessService rejecting and listing historical requests", () => {
  it("rejecting grants nothing and never changes Boosting Roles", async () => {
    const character = await createPaladin(owner);
    const pendingId = await createPendingAccess(owner.id, character.id, "PALADIN", "HEALER", "NORMAL");
    await boosterAccessService.rejectAccess(admin, pendingId, "Need more experience.");
    expect(await userRepository.findBoostingRoles(owner.id)).toEqual({
      isBooster: false,
      isLootbuddy: false,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
    const options = await signupService.getSignupOptions(owner, HEROIC_OPEN);
    expect(options.booster.eligible.some((item) => item.characterId === character.id)).toBe(false);
  });

  it("lists only PENDING requests and removes them once reviewed, preserving the rows", async () => {
    const character = await createPaladin(owner);
    const approveId = await createPendingAccess(owner.id, character.id, "PALADIN", "HEALER", "HEROIC");
    const rejectId = await createPendingAccess(owner.id, character.id, "PALADIN", "TANK", "NORMAL");
    const before = await boosterAccessService.listLegacyRequests(admin);
    const mine = await boosterAccessService.listLegacyRequests(admin, { userId: owner.id });
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
    const heroic = await createPendingAccess(owner.id, character.id, "PALADIN", "HEALER", "HEROIC");
    await createPendingAccess(owner.id, character.id, "PALADIN", "TANK", "MYTHIC");
    const filtered = await boosterAccessService.listLegacyRequests(admin, {
      userId: owner.id,
      difficulty: "HEROIC",
      role: "HEALER",
    });
    expect(filtered.requests.map((row) => row.id)).toEqual([heroic]);
  });

  it("current eligibility never reads historical requests", async () => {
    const character = await createPaladin(owner);
    // An APPROVED historical row alone does not make the User a Booster.
    const id = await createPendingAccess(owner.id, character.id, "PALADIN", "HEALER", "HEROIC");
    await orm.BoosterAccess.where({ id }).update({ status: "APPROVED" });
    expect(await isBooster(owner.id)).toBe(false);
    const options = await signupService.getSignupOptions(owner, HEROIC_OPEN);
    expect(options.booster.ineligible.find((item) => item.characterId === character.id)?.reason).toBe(
      "NO_BOOSTER_ACCESS",
    );
  });
});
