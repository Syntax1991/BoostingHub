import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { anyContentRunInput } from "@tests/fixtures/test-run-input";
import { characterRepository } from "@/repositories/character.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { characterService } from "@/services/character.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows } from "@tests/fixtures/db-fixtures";
import { expectDomainError } from "@tests/helpers/domain-error";
import { offerCharacter } from "@tests/helpers/signup-offers";

// Warcraft Logs auto-link enrichment runs after Character writes/syncs; keep it
// offline (a real WARCRAFT_LOGS_* in .env would otherwise hit the live API).
vi.mock("@/integrations/warcraft-logs/warcraft-logs-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/warcraft-logs/warcraft-logs-api-client")>()),
  warcraftLogsApiClient: {
    isConfigured: () => true,
    findCharacter: async () => ({ status: "NOT_FOUND" as const }),
  },
}));

/** Characters go with their owners: Character.userId cascades. */
const created = { runIds: [] as string[], userIds: [] as string[] };
let owner: AuthenticatedUser;
let other: AuthenticatedUser;
/** An Admin caller; ownership checks never look the caller's row up. */
const admin = testActor(crypto.randomUUID(), "ADMIN");
let heroicOpenRunId: string;

async function createUser(name: string, accountRole: AuthenticatedUser["accountRole"] = "USER") {
  const id = await createTestUser({ name, accountRole });
  created.userIds.push(id);
  return testActor(id, accountRole, { name });
}

async function lockoutRaidIds() {
  return (await raidRepository.loadCatalog()).lockoutRaids.map((raid) => raid.id).sort();
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  owner = await createUser("Character Owner");
  other = await createUser("Character Other");
  const lead = await createUser("Character Lead", "RAID_LEAD");
  const run = await runService.createRun(lead, anyContentRunInput());
  created.runIds.push(run.id);
  await runService.openRun(lead, run.id);
  heroicOpenRunId = run.id;
});

afterAll(async () => {
  await deleteCreatedRows(created);
});

describe("characterService empty user", () => {
  it("returns zero counts for a user with no characters", async () => {
    const page = await characterService.getCharacterPage(testActor(crypto.randomUUID()));
    expect(page.totalCharacters).toBe(0);
    expect(page.activeCharacters).toBe(0);
    expect(page.characters).toEqual([]);
  });

  it("exposes every catalog lockout raid as plural currentLockoutRaids — no singular currentLockoutRaid", async () => {
    const page = await characterService.getCharacterPage(owner);
    expect(page.currentLockoutRaids.map((raid) => raid.id).sort()).toEqual(await lockoutRaidIds());
    expect(page).not.toHaveProperty("currentLockoutRaid");
  });

  it("exposes warcraftLogsId on the character page when linked, otherwise null", async () => {
    const linked = await characterService.createCharacter(owner, {
      name: "Wclpage",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "MAGE",
      specialization: "Frost",
      itemLevel: 600,
    });
    const unlinked = await characterService.createCharacter(owner, {
      name: "Nowcl",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "WARLOCK",
      specialization: "Affliction",
      itemLevel: 601,
    });
    await orm.Character.where({ id: linked.id }).update({ warcraftLogsId: "42424242" });

    const page = await characterService.getCharacterPage(owner);
    const linkedRow = page.characters.find((row) => row.id === linked.id);
    const unlinkedRow = page.characters.find((row) => row.id === unlinked.id);
    expect(linkedRow?.warcraftLogsId).toBe("42424242");
    expect(linkedRow?.warcraftLogsLinked).toBe(true);
    expect(unlinkedRow?.warcraftLogsId).toBeNull();
    expect(unlinkedRow?.warcraftLogsLinked).toBe(false);
  });
});

describe("characterService create", () => {
  it("creates EU and US characters for the session user, not a client-supplied owner", async () => {
    const eu = await characterService.createCharacter(owner, {
      name: "Cmtestone",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 640,
    });
    expect(eu.userId).toBe(owner.id);
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
    expect(us.region).toBe("US");
    expect(us.userId).toBe(owner.id);
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
    expect(created.name).toBe("Éowyn");
  });

  it("rejects a duplicate identity including case-only differences", async () => {
    await characterService.createCharacter(owner, {
      name: "Testblast",
      realm: "Tarren Mill",
      region: "EU",
      wowClass: "WARRIOR",
      specialization: "Arms",
      itemLevel: 500,
    });

    await expectDomainError(
      characterService.createCharacter(owner, {
        name: "testblast",
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

    const otherRealm = await characterService.createCharacter(owner, {
      name: "Twinname",
      realm: "Kazzak",
      region: "EU",
      wowClass: "MAGE",
      specialization: "Fire",
      itemLevel: 581,
    });

    const otherRegion = await characterService.createCharacter(owner, {
      name: "Twinname",
      realm: "Draenor",
      region: "US",
      wowClass: "MAGE",
      specialization: "Arcane",
      itemLevel: 582,
    });

    const otherUser = await characterService.createCharacter(other, {
      name: "Twinname",
      realm: "Draenor",
      region: "EU",
      wowClass: "MAGE",
      specialization: "Frost",
      itemLevel: 583,
    });
    expect([original, otherRealm, otherRegion, otherUser].map((row) => [row.userId, row.realm, row.region])).toEqual([
      [owner.id, "Draenor", "EU"],
      [owner.id, "Kazzak", "EU"],
      [owner.id, "Draenor", "US"],
      [other.id, "Draenor", "EU"],
    ]);
  });

  it("rejects invalid class/spec combinations", async () => {
    await expectDomainError(
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
  it("lets the owner update fields, keeps class immutable, and rejects rename collisions", async () => {
    const first = await characterService.createCharacter(owner, {
      name: "Editone",
      realm: "Ravencrest",
      region: "EU",
      wowClass: "PALADIN",
      specialization: "Holy",
      itemLevel: 650,
    });
    await characterService.createCharacter(owner, {
      name: "Edittwo",
      realm: "Ravencrest",
      region: "EU",
      wowClass: "PALADIN",
      specialization: "Protection",
      itemLevel: 651,
    });

    const details = await characterService.getCharacterDetails(owner, first.id);
    expect(details.currentLockoutRaids.map((raid) => raid.id).sort()).toEqual(await lockoutRaidIds());
    expect(details).not.toHaveProperty("currentLockoutRaid");
    expect(details.warcraftLogsId).toBeNull();
    expect(details.warcraftLogsLinked).toBe(false);

    await orm.Character.where({ id: first.id }).update({ warcraftLogsId: "99887766" });
    const linkedDetails = await characterService.getCharacterDetails(owner, first.id);
    expect(linkedDetails.warcraftLogsId).toBe("99887766");
    expect(linkedDetails.warcraftLogsLinked).toBe(true);

    const updated = await characterService.updateCharacter(owner, first.id, {
      name: "Editone",
      realm: "Ravencrest",
      region: "EU",
      specialization: "Retribution",
    });
    expect(updated.wowClass).toBe("PALADIN");
    expect(updated.specialization).toBe("Retribution");
    expect(updated.primaryRole).toBe("MELEE_DPS");
    // Item level is Blizzard-authoritative and untouched by edits.
    expect(updated.itemLevel).toBe(650);

    await expectDomainError(
      characterService.updateCharacter(owner, first.id, {
        name: "Edittwo",
        realm: "Ravencrest",
        region: "EU",
        specialization: "Retribution",
      }),
      "CHARACTER_ALREADY_EXISTS",
    );

    await expectDomainError(
      characterService.updateCharacter(owner, crypto.randomUUID(), {
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

    await expectDomainError(characterService.getCharacterDetails(other, character.id), "CHARACTER_NOT_OWNED");
    await expectDomainError(characterService.getCharacterDetails(admin, character.id), "CHARACTER_NOT_OWNED");
    await expectDomainError(
      characterService.updateCharacter(other, character.id, {
        name: "Ownedonly",
        realm: "Kazzak",
        region: "EU",
        specialization: "Outlaw",
      }),
      "CHARACTER_NOT_OWNED",
    );
    await expectDomainError(characterService.deactivateCharacter(other, character.id), "CHARACTER_NOT_OWNED");
    await expectDomainError(characterService.reactivateCharacter(admin, character.id), "CHARACTER_NOT_OWNED");
  });
});

describe("characterService lifecycle and signup eligibility", () => {
  it("deactivates without rewriting history or booster access, and blocks new signups until reactivation", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Lifecycle",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "DRUID",
      specialization: "Restoration",
      itemLevel: 630,
    });

    const beforeAccess = await signupService.getSignupOptions(owner, heroicOpenRunId);
    expect(beforeAccess.booster.eligible.some((item) => item.characterId === character.id)).toBe(false);
    await expectDomainError(
      offerCharacter(owner, heroicOpenRunId, character.id, "HEALER"),
      "BOOSTER_ACCESS_REQUIRED",
    );

    await orm.User.where({ id: owner.id }).update({ isBooster: true });

    const withAccess = await signupService.getSignupOptions(owner, heroicOpenRunId);
    expect(
      withAccess.booster.eligible.some((item) => item.characterId === character.id && item.defaultRole === "HEALER"),
    ).toBe(true);

    const signupId = await offerCharacter(owner, heroicOpenRunId, character.id, "HEALER");

    await characterService.deactivateCharacter(owner, character.id);
    const stored = await characterRepository.findById(character.id);
    expect(stored?.isActive).toBe(false);

    const historical = await signupRepository.findById(signupId);
    expect(historical?.status).toBe("PENDING");

    // Deactivating a Character never touches the owner's account-level Booster role.
    const owned = await orm.User.where({ id: owner.id }).select("isBooster").first();
    expect(owned?.isBooster).toBe(true);

    const inactiveOptions = await signupService.getSignupOptions(owner, heroicOpenRunId);
    expect(inactiveOptions.booster.eligible.some((item) => item.characterId === character.id)).toBe(false);
    await expectDomainError(
      offerCharacter(owner, heroicOpenRunId, character.id, "HEALER"),
      "CHARACTER_INACTIVE",
    );

    await characterService.reactivateCharacter(owner, character.id);
    const reactivated = await characterRepository.findById(character.id);
    expect(reactivated?.isActive).toBe(true);

    const activeOptions = await signupService.getSignupOptions(owner, heroicOpenRunId);
    expect(
      activeOptions.booster.eligible.some((item) => item.characterId === character.id && item.defaultRole === "HEALER"),
    ).toBe(true);
  });
});
